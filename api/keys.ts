// Key pool with automatic switching. Keys arrive from two places: whatever the user
// pasted into the app (sent per request, never stored server-side) and the
// GEMINI_API_KEY / _2 … _9 environment slots. User keys are tried first.
//
// A key that reports exhaustion is put on a cooldown so later requests skip it instead
// of paying a round-trip to rediscover it's empty.
//
// The free tier's cap is GenerateRequestsPerDayPerProjectPerModel — per DAY, per model.
// Google still returns a short "retry in 43s" hint for it, which is misleading: waiting
// achieves nothing. The cooldown exists to stop us re-trying a spent key within a
// request, not to wait out a limit that lifts tomorrow. Because the cap is per model,
// the caller falls through to another model, which has its own separate allowance.

let cursor = 0;

/** key → epoch ms until which it is considered spent. Survives warm invocations. */
const cooling = new Map<string, number>();

const MIN_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 20 * 60_000;
const DEFAULT_COOLDOWN_MS = 90_000;

export function keyPool(prefix = "GEMINI", extra: string[] = []): string[] {
  const keys: string[] = extra.map((k) => k.trim()).filter(Boolean);
  const bulk = process.env[`${prefix}_API_KEYS`];
  if (bulk) keys.push(...bulk.split(",").map((k) => k.trim()).filter(Boolean));
  const solo = process.env[`${prefix}_API_KEY`];
  if (solo) keys.push(solo.trim());
  for (let i = 2; i <= 9; i++) {
    const k = process.env[`${prefix}_API_KEY_${i}`];
    if (k) keys.push(k.trim());
  }
  return [...new Set(keys)];
}

/** Model overload, not key exhaustion. Same key, just try again in a moment. */
function isTransient(status: number, message: string): boolean {
  if (status === 500 || status === 503) return true;
  return /high demand|overloaded|unavailable|try again later|internal error/i.test(message);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT_ATTEMPTS = 3;

/** A typo'd paste. Skip it and carry on — one bad key must not take down a working
 *  pool. Until user-supplied keys actually reached this function, it could not happen. */
export function isBadKey(status: number, message: string): boolean {
  return (
    (status === 400 || status === 403) &&
    /api key not valid|api_key_invalid|invalid api key/i.test(message)
  );
}

export function isExhausted(status: number, message: string): boolean {
  if (status === 429) return true;
  if (status === 403 && /quota|permission|disabled/i.test(message)) return true;
  return /quota|exhausted|rate limit/i.test(message);
}

/** Google says "Please retry in 51.05s" — use its number rather than guessing. */
export function cooldownFrom(message: string): number {
  const m = message.match(/retry in ([\d.]+)s/i);
  const ms = m ? Number(m[1]) * 1000 : DEFAULT_COOLDOWN_MS;
  return Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, ms));
}

export function poolStatus(prefix = "GEMINI", extra: string[] = [], scope = "") {
  const now = Date.now();
  return keyPool(prefix, extra).map((k) => {
    const until = cooling.get(`${scope}|${k}`) ?? 0;
    return {
      key: `…${k.slice(-4)}`,
      cooling: until > now,
      readyInSeconds: until > now ? Math.ceil((until - now) / 1000) : 0,
    };
  });
}

/**
 * Calls `fn` with each key in turn, switching automatically when one is spent.
 * Keys on cooldown are skipped on the first sweep and only tried if every key is
 * cooling — a stale cooldown should never make the app claim it has no keys.
 */
export async function withKey<T>(
  prefix: string,
  fn: (key: string) => Promise<T>,
  extra: string[] = [],
  scope = "",
): Promise<T> {
  const keys = keyPool(prefix, extra);
  if (keys.length === 0) {
    throw new Error(
      `No ${prefix} key found. Add one in the app's key panel, or set ${prefix}_API_KEY.`,
    );
  }

  const now = Date.now();
  const fresh = keys.filter((k) => (cooling.get(`${scope}|${k}`) ?? 0) <= now);
  const order = fresh.length > 0 ? fresh : keys;

  const start = cursor++ % order.length;
  let last = "";

  for (let i = 0; i < order.length; i++) {
    const key = order[(start + i) % order.length];

    for (let attempt = 1; attempt <= TRANSIENT_ATTEMPTS; attempt++) {
      try {
        const out = await fn(key);
        cooling.delete(`${scope}|${key}`); // it worked — whatever we thought was wrong
        return out;
      } catch (err) {
        const e = err as Error & { status?: number };
        last = e.message;

        // The model is busy, not the key. Back off and ask the same key again.
        if (isTransient(e.status ?? 0, e.message)) {
          if (attempt < TRANSIENT_ATTEMPTS) {
            await sleep(700 * attempt);
            continue;
          }
          break; // out of patience with this key — try the next one
        }

        if (isBadKey(e.status ?? 0, e.message)) {
          // Not worth retrying this hour, but never worth failing the request over.
          cooling.set(`${scope}|${key}`, Date.now() + MAX_COOLDOWN_MS);
          break;
        }

        if (!isExhausted(e.status ?? 0, e.message)) throw err;
        cooling.set(`${scope}|${key}`, Date.now() + cooldownFrom(e.message));
        break; // spent — switch to the next key
      }
    }
  }

  // The free tier's limit is requests per DAY, per project, per model — Google's
  // "retry in 43s" hint is misleading and waiting it out achieves nothing. The caller
  // falls back to another model instead, which has its own separate daily allowance.
  throw new Error(
    `QUOTA: all ${keys.length} key(s) are out of the daily free-tier allowance for this model. (${last})`,
  );
}
