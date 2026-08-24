// Authorization Code with PKCE. No client secret, so this is safe in the browser.
// Spotify requires the literal loopback IP for local redirect URIs — never "localhost".

const AUTH = "https://accounts.spotify.com/authorize";
const TOKEN = "https://accounts.spotify.com/api/token";
// Only what the app actually uses. Every extra scope is another line on the consent
// screen a friend has to agree to.
const SCOPES =
  "user-read-currently-playing user-read-playback-state user-modify-playback-state " +
  "user-read-recently-played";

const LS = {
  clientId: "ln.clientId",
  verifier: "ln.verifier",
  access: "ln.access",
  refresh: "ln.refresh",
  expires: "ln.expires",
};

export const redirectUri = () => `${location.origin}/callback`;

export function clientId(): string {
  return (
    localStorage.getItem(LS.clientId) ||
    (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined) ||
    ""
  );
}

export function setClientId(id: string) {
  localStorage.setItem(LS.clientId, id.trim());
}

function randomString(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function login() {
  const verifier = randomString(64);
  localStorage.setItem(LS.verifier, verifier);
  const challenge = base64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: "code",
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
  });
  location.href = `${AUTH}?${params}`;
}

function store(json: any) {
  localStorage.setItem(LS.access, json.access_token);
  if (json.refresh_token) localStorage.setItem(LS.refresh, json.refresh_token);
  localStorage.setItem(LS.expires, String(Date.now() + json.expires_in * 1000 - 30_000));
}

/** Exchanges ?code= for tokens. Returns true if we just completed a login. */
export async function completeLogin(): Promise<boolean> {
  const code = new URLSearchParams(location.search).get("code");
  if (!code) return false;
  const verifier = localStorage.getItem(LS.verifier) ?? "";
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  });
  const json = await res.json();
  history.replaceState({}, "", "/");
  if (!res.ok) throw new Error(json.error_description ?? "Token exchange failed");
  store(json);
  return true;
}

export function isConnected(): boolean {
  return Boolean(localStorage.getItem(LS.access));
}

export function logout() {
  for (const k of [LS.access, LS.refresh, LS.expires]) localStorage.removeItem(k);
}

// Spotify rotates the refresh token on every use, so two refreshes racing each other
// means the second presents a token the first already retired — and the session dies
// for no reason. The app fires several requests at once (poll, queue, album details,
// transport), so this is not hypothetical.
let refreshing: Promise<string> | null = null;

async function accessToken(): Promise<string> {
  const token = localStorage.getItem(LS.access);
  const expires = Number(localStorage.getItem(LS.expires) ?? 0);
  if (token && Date.now() < expires) return token;

  if (refreshing) return refreshing;
  refreshing = refreshToken().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function refreshToken(): Promise<string> {
  const refresh = localStorage.getItem(LS.refresh);
  if (!refresh) throw new Error("not connected");

  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      grant_type: "refresh_token",
      refresh_token: refresh,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    logout();
    throw new Error("session expired");
  }
  store(json);
  return json.access_token;
}

export type Playing = {
  id: string;
  isrc: string;
  albumId: string;
  artistId: string;
  title: string;
  artists: string[];
  album: string;
  released: string;
  art: string;
  durationMs: number;
  progressMs: number;
  isPlaying: boolean;
};

/** null = nothing is playing right now. */
export async function nowPlaying(): Promise<Playing | null> {
  const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { authorization: `Bearer ${await accessToken()}` },
  });
  if (res.status === 204) return null;
  if (res.status === 401) {
    logout();
    throw new Error("session expired");
  }
  if (!res.ok) throw new Error(`Spotify ${res.status}`);

  const json = await res.json();
  const item = json?.item;
  if (!item || item.type !== "track") return null;

  return {
    id: item.id,
    // The recording's global identifier. MusicBrainz can look this up directly, which
    // beats guessing from a title that half a dozen takes and covers also carry.
    isrc: item.external_ids?.isrc ?? "",
    albumId: item.album?.id ?? "",
    artistId: item.artists?.[0]?.id ?? "",
    title: item.name,
    artists: (item.artists ?? []).map((a: any) => a.name),
    album: item.album?.name ?? "",
    released: item.album?.release_date ?? "",
    art: item.album?.images?.[0]?.url ?? "",
    durationMs: item.duration_ms ?? 0,
    progressMs: json.progress_ms ?? 0,
    isPlaying: Boolean(json.is_playing),
  };
}

/* ---------- playback control ---------- */

export type ControlResult = "ok" | "premium-required" | "needs-reconnect" | "no-device" | "failed";

async function control(path: string, method: "PUT" | "POST"): Promise<ControlResult> {
  let token: string;
  try {
    token = await accessToken();
  } catch {
    return "needs-reconnect";
  }

  const res = await fetch(`https://api.spotify.com/v1/me/player/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  });

  if (res.status === 204 || res.ok) return "ok";
  if (res.status === 401) {
    logout();
    return "needs-reconnect";
  }
  if (res.status === 404) return "no-device";

  if (res.status === 403) {
    // Two very different problems wear the same status code: a free account, or a
    // token minted before this app asked for permission to control playback.
    let reason = "";
    try {
      const body = await res.json();
      reason = `${body?.error?.reason ?? ""} ${body?.error?.message ?? ""}`;
    } catch {
      /* empty body — fall through to the premium assumption */
    }
    return /scope/i.test(reason) ? "needs-reconnect" : "premium-required";
  }

  return "failed";
}

export const play = () => control("play", "PUT");
export const pause = () => control("pause", "PUT");
export const next = () => control("next", "POST");
export const previous = () => control("previous", "POST");
export const seek = (ms: number) => control(`seek?position_ms=${Math.max(0, Math.round(ms))}`, "PUT");

/* ---------- extra context ---------- */

async function get(path: string): Promise<any> {
  const res = await fetch(`https://api.spotify.com/v1/${path}`, {
    headers: { authorization: `Bearer ${await accessToken()}` },
  });
  if (!res.ok) return null;
  if (res.status === 204) return null;
  return res.json();
}

export type Upcoming = {
  id: string;
  isrc: string;
  art: string;
  albumId: string;
  artistId: string;
  title: string;
  artists: string[];
  album: string;
  released: string;
};

/** The track Spotify will play next, so its notes can be written before it starts. */
export async function queueNext(): Promise<Upcoming | null> {
  const data = await get("me/player/queue").catch(() => null);
  const item = (data?.queue ?? []).find((q: any) => q?.type === "track");
  if (!item?.id) return null;
  return {
    id: item.id,
    isrc: item.external_ids?.isrc ?? "",
    art: item.album?.images?.[0]?.url ?? "",
    albumId: item.album?.id ?? "",
    artistId: item.artists?.[0]?.id ?? "",
    title: item.name,
    artists: (item.artists ?? []).map((a: any) => a.name),
    album: item.album?.name ?? "",
    released: item.album?.release_date ?? "",
  };
}

/** Label and genres — facts the model would otherwise have to guess at. */
export async function trackDetails(
  albumId: string,
  artistId: string,
): Promise<{ label: string; genres: string[] }> {
  const [album, artist] = await Promise.all([
    albumId ? get(`albums/${albumId}`).catch(() => null) : null,
    artistId ? get(`artists/${artistId}`).catch(() => null) : null,
  ]);
  return {
    label: album?.label ?? "",
    genres: (artist?.genres ?? []).slice(0, 5),
  };
}

/** Seeds the session thread, so the first song of a session still connects to something. */
export async function recentlyPlayed(): Promise<string[]> {
  const data = await get("me/player/recently-played?limit=8").catch(() => null);
  const seen = new Set<string>();
  for (const entry of data?.items ?? []) {
    const track = entry?.track;
    if (!track?.name) continue;
    seen.add(`${(track.artists ?? []).map((a: any) => a.name).join(", ")} — ${track.name}`);
  }
  return [...seen];
}
