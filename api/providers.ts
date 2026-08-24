// Two providers, same shape out. Gemini is preferred when its Search grounding
// actually has quota; Groq's compound models carry web search on the free tier and
// are the fallback. Set GROQ_API_KEY to force Groq.

import { keyPool, withKey } from "./keys.js";

export type Grounded = {
  text: string;
  urls: [string, string][];
  queries: string[];
  live: boolean; // false = answered from model knowledge, search was unavailable
};

// Free-tier quota is counted per project PER MODEL, so a second model is a second
// daily allowance rather than a smaller share of the same one. Order matters: the
// first is the one we actually want, the rest are what we fall back to.
export const MODEL_CHAIN = ["gemini-3.6-flash", "gemini-flash-lite-latest"];

// Search grounding is metered separately from generation and runs out first. Once it
// has, every request was still paying for a failed attempt on every key before falling
// back. Remember it and stop asking for a while.
let searchBlockedUntil = 0;
const SEARCH_RETRY_AFTER_MS = 30 * 60_000;

const GEMINI = (m: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
const GROQ = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Groq is a second pool rather than a replacement. It used to be all-or-nothing —
 * setting a Groq key meant Gemini was never tried — which threw away half the daily
 * allowance. Now Gemini goes first and Groq catches what it drops, so the two add up.
 *
 * Set GROQ_FIRST=1 to reverse the order; Groq's compound model carries its own web
 * search, which is worth having while Gemini's grounding is out of quota.
 */
export function provider(): "groq" | "gemini" {
  return process.env.GROQ_FIRST === "1" ? "groq" : "gemini";
}

/** Pull every http(s) URL out of an arbitrary response shape. */
function harvestUrls(node: unknown, out: Map<string, string>, title = ""): void {
  if (Array.isArray(node)) {
    for (const n of node) harvestUrls(n, out, title);
    return;
  }
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    const url = (o.url ?? o.uri ?? o.link) as string | undefined;
    const name = (o.title ?? o.name ?? title) as string | undefined;
    if (typeof url === "string" && /^https?:\/\//.test(url)) {
      out.set(url, typeof name === "string" && name ? name : url);
    }
    for (const v of Object.values(o)) harvestUrls(v, out, typeof name === "string" ? name : title);
  }
}

async function geminiOnce(
  system: string,
  user: string,
  model: string,
  search: boolean,
  extra: string[] = [],
): Promise<any> {
  return withKey(
    "GEMINI",
    async (key) => {
      const res = await fetch(GEMINI(model), {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          ...(search ? { tools: [{ google_search: {} }] } : {}),
          generationConfig: { temperature: 0.3 },
        }),
      });
      const json = (await res.json()) as any;
      if (!res.ok) {
        const e = new Error(json?.error?.message ?? `Gemini ${res.status}`) as Error & {
          status?: number;
        };
        e.status = res.status;
        throw e;
      }
      return json;
    },
    // Keys pasted into the app arrive here. Dropping them meant the key panel could
    // report a key as valid while generation insisted there was none — invisible to
    // anyone whose environment keys covered for it.
    extra,
    // Cooldowns are per key, per model AND per tool. Search grounding has its own free
    // tier allowance, so a 429 from it was marking the key as spent for plain
    // generation on that model too — and pushing every request onto the fallback model
    // for no reason.
    `${model}${search ? "+search" : ""}`,
  );
}

async function geminiCall(
  system: string,
  user: string,
  model: string,
  extra: string[] = [],
): Promise<Grounded> {
  const chain = [model, ...MODEL_CHAIN.filter((m) => m !== model)];
  let last: Error | null = null;

  for (const candidate of chain) {
    try {
      return await geminiOne(system, user, candidate, extra);
    } catch (err) {
      last = err as Error;
      // Only a spent daily allowance is worth trying another model for.
      if (!/^QUOTA:/.test(last.message)) throw err;
    }
  }
  throw last ?? new Error("No Gemini model available");
}

async function geminiOne(
  system: string,
  user: string,
  model: string,
  extra: string[] = [],
): Promise<Grounded> {
  let live = true;
  let data: any;
  try {
    if (Date.now() < searchBlockedUntil) throw new Error("search grounding is out of quota");
    data = await geminiOnce(system, user, model, true, extra);
  } catch (err) {
    // No search quota — answer from model knowledge rather than dying.
    if (!/quota|exhausted|rate limit|search grounding/i.test((err as Error).message)) throw err;
    searchBlockedUntil = Date.now() + SEARCH_RETRY_AFTER_MS;
    live = false;
    data = await geminiOnce(
      `${system}\n\nYou have no live web access. Answer from your own knowledge, and say explicitly when something may have changed since your training cutoff.`,
      user,
      model,
      false,
      extra,
    );
  }

  const meta = data?.candidates?.[0]?.groundingMetadata ?? {};
  const urls = new Map<string, string>();
  for (const c of meta.groundingChunks ?? []) {
    if (c?.web?.uri) urls.set(c.web.uri, c.web.title || c.web.uri);
  }
  return {
    text: (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p: any) => p.text ?? "")
      .join("")
      .trim(),
    urls: [...urls],
    queries: meta.webSearchQueries ?? [],
    live,
  };
}

async function groqCall(system: string, user: string): Promise<Grounded> {
  const data: any = await withKey("GROQ", async (key) => {
    const res = await fetch(GROQ, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "groq/compound",
        temperature: 0.3,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    const json = (await res.json()) as any;
    if (!res.ok) {
      const e = new Error(json?.error?.message ?? `Groq ${res.status}`) as Error & {
        status?: number;
      };
      e.status = res.status;
      throw e;
    }
    return json;
  });

  const msg = data?.choices?.[0]?.message ?? {};
  const urls = new Map<string, string>();
  harvestUrls(msg.executed_tools ?? msg.reasoning ?? [], urls);

  const queries: string[] = [];
  for (const t of msg.executed_tools ?? []) {
    const q = t?.arguments?.query ?? t?.input?.query ?? t?.query;
    if (typeof q === "string") queries.push(q);
    else if (typeof t?.arguments === "string") {
      try {
        const parsed = JSON.parse(t.arguments);
        if (parsed?.query) queries.push(String(parsed.query));
      } catch {
        /* argument shape varies by tool — skip */
      }
    }
  }

  return { text: String(msg.content ?? "").trim(), urls: [...urls], queries, live: true };
}

export async function ground(
  system: string,
  user: string,
  geminiModel: string,
  extra: string[] = [],
): Promise<Grounded> {
  const hasGroq = keyPool("GROQ").length > 0;
  const groqFirst = provider() === "groq" && hasGroq;

  const first = groqFirst
    ? () => groqCall(system, user)
    : () => geminiCall(system, user, geminiModel, extra);
  const second = groqFirst
    ? () => geminiCall(system, user, geminiModel, extra)
    : () => groqCall(system, user);

  try {
    return await first();
  } catch (err) {
    const message = (err as Error).message;
    // Only a spent allowance is worth crossing to the other provider for.
    const spent = /^QUOTA:|out of quota|No GEMINI key|No GROQ key/i.test(message);
    if (!spent) throw err;

    const alternative = groqFirst ? keyPool("GEMINI", extra).length > 0 : hasGroq;
    if (!alternative) throw err;

    return await second();
  }
}
