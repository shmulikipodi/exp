// Authorization Code with PKCE. No client secret, so this is safe in the browser.
// Spotify requires the literal loopback IP for local redirect URIs — never "localhost".

const AUTH = "https://accounts.spotify.com/authorize";
const TOKEN = "https://accounts.spotify.com/api/token";
// Only what the app actually uses. Every extra scope is another line on the consent
// screen a friend has to agree to.
const SCOPES =
  "user-read-currently-playing user-read-playback-state user-modify-playback-state " +
  "user-read-recently-played streaming user-read-email user-read-private";

const LS = {
  clientId: "ln.clientId",
  verifier: "ln.verifier",
  access: "ln.access",
  state: "ln.state",
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
  const state = randomString(16);
  localStorage.setItem(LS.verifier, verifier);
  localStorage.setItem(LS.state, state);
  const challenge = base64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: "code",
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
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
  const params = new URLSearchParams(location.search);

  // Pressing Cancel on Spotify's consent screen sent you back here to a Connect button
  // with no idea why nothing had happened.
  const denied = params.get("error");
  if (denied) {
    history.replaceState({}, "", "/");
    throw new Error(
      denied === "access_denied" ? "Spotify access was declined." : `Spotify: ${denied}`,
    );
  }

  const code = params.get("code");
  if (!code) return false;

  // The state parameter is what stops someone handing you a link that completes an
  // authorisation you did not start.
  const expected = localStorage.getItem(LS.state);
  localStorage.removeItem(LS.state);
  if (expected && params.get("state") !== expected) {
    history.replaceState({}, "", "/");
    throw new Error("Login could not be verified. Try connecting again.");
  }

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

export async function accessToken(): Promise<string> {
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
  /** The album, playlist or radio this track is playing inside, if any. */
  contextUri?: string;
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
    contextUri: json.context?.uri ?? "",
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
  durationMs: number;
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
    durationMs: item.duration_ms ?? 0,
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
): Promise<{ label: string; genres: string[]; copyrights: string[] }> {
  const [album, artist] = await Promise.all([
    albumId ? get(`albums/${albumId}`).catch(() => null) : null,
    artistId ? get(`artists/${artistId}`).catch(() => null) : null,
  ]);
  return {
    label: album?.label ?? "",
    genres: (artist?.genres ?? []).slice(0, 5),
    // The ℗ line names who owns the master and from when — which is how you tell a
    // reissue from an original, and a catalogue that changed hands from one that didn't.
    copyrights: (album?.copyrights ?? [])
      .map((c: any) => `${c.type === "P" ? "℗" : "©"} ${c.text}`)
      .slice(0, 3),
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

/** Hands playback to a device — the in-page player, once it has registered one. */
export async function transferTo(deviceId: string): Promise<ControlResult> {
  try {
    const res = await fetch("https://api.spotify.com/v1/me/player", {
      method: "PUT",
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ device_ids: [deviceId], play: true }),
    });
    if (res.ok || res.status === 204) return "ok";
    if (res.status === 403) return "premium-required";
    if (res.status === 401) return "needs-reconnect";
    return "failed";
  } catch {
    return "failed";
  }
}

/** Finds a track by name and plays it. The reader clicked a song; play the song. */
async function findUri(query: string): Promise<string | null | "needs-reconnect"> {
  const token = await accessToken();
  const found = await fetch(
    `https://api.spotify.com/v1/search?type=track&limit=1&q=${encodeURIComponent(query)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (found.status === 401) {
    logout();
    return "needs-reconnect";
  }
  if (!found.ok) return null;
  return (await found.json())?.tracks?.items?.[0]?.uri ?? null;
}

/**
 * Play something without throwing away what was already lined up.
 *
 * Handing Spotify a bare list of URIs replaces the context outright: the album or
 * playlist you were in stops existing, and when the track ends there is nothing after
 * it. Putting the track in the queue and skipping to it leaves the context alone, so
 * the detour plays and then the record carries on where it was.
 */
export async function playSearch(query: string): Promise<ControlResult> {
  try {
    const uri = await findUri(query);
    if (uri === "needs-reconnect") return "needs-reconnect";
    if (!uri) return "failed";

    const queued = await control(`queue?uri=${encodeURIComponent(uri)}`, "POST");
    if (queued !== "ok") return queued;
    return await control("next", "POST");
  } catch {
    return "failed";
  }
}

/**
 * Back to what was playing before the detour, at the second it was interrupted.
 * With a context to return to, Spotify restores the whole queue with it; without one
 * the best available is the track on its own.
 */
export async function resumeAt(
  contextUri: string,
  trackId: string,
  positionMs: number,
): Promise<ControlResult> {
  try {
    const uri = `spotify:track:${trackId}`;
    const body = contextUri
      ? { context_uri: contextUri, offset: { uri }, position_ms: Math.max(0, Math.round(positionMs)) }
      : { uris: [uri], position_ms: Math.max(0, Math.round(positionMs)) };

    const res = await fetch("https://api.spotify.com/v1/me/player/play", {
      method: "PUT",
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok || res.status === 204) return "ok";
    if (res.status === 404) return "no-device";
    if (res.status === 403) return "premium-required";
    return "failed";
  } catch {
    return "failed";
  }
}

/** Somewhere to send a reader who clicked an artist — their page, not a guess at a URI. */
export const spotifySearchUrl = (query: string, type: "artist" | "track") =>
  `https://open.spotify.com/search/${encodeURIComponent(query)}/${type}s`;

/* ---------- panels ---------- */

export type QueueItem = {
  id: string;
  title: string;
  artists: string[];
  art: string;
  durationMs: number;
};

/** Everything Spotify will play next, not just the one after this. */
export async function queueList(limit = 15): Promise<QueueItem[]> {
  const data = await get("me/player/queue").catch(() => null);
  return (data?.queue ?? [])
    .filter((q: any) => q?.type === "track" && q?.id)
    .slice(0, limit)
    .map((item: any) => ({
      id: item.id,
      title: item.name,
      artists: (item.artists ?? []).map((a: any) => a.name),
      art: item.album?.images?.[item.album.images.length - 1]?.url ?? "",
      durationMs: item.duration_ms ?? 0,
    }));
}

export type ArtistProfile = {
  name: string;
  image: string;
  genres: string[];
  followers: number;
  url: string;
  topTracks: { id: string; title: string; art: string }[];
};

export async function artistProfile(artistId: string): Promise<ArtistProfile | null> {
  if (!artistId) return null;
  const [artist, top] = await Promise.all([
    get(`artists/${artistId}`).catch(() => null),
    get(`artists/${artistId}/top-tracks?market=from_token`).catch(() => null),
  ]);
  if (!artist?.name) return null;
  return {
    name: artist.name,
    image: artist.images?.[0]?.url ?? "",
    genres: (artist.genres ?? []).slice(0, 6),
    followers: artist.followers?.total ?? 0,
    url: artist.external_urls?.spotify ?? "",
    topTracks: (top?.tracks ?? []).slice(0, 5).map((tr: any) => ({
      id: tr.id,
      title: tr.name,
      art: tr.album?.images?.[tr.album.images.length - 1]?.url ?? "",
    })),
  };
}

export type AlbumProfile = {
  name: string;
  art: string;
  released: string;
  label: string;
  total: number;
  url: string;
  tracks: { id: string; number: number; title: string; durationMs: number }[];
};

export async function albumProfile(albumId: string): Promise<AlbumProfile | null> {
  if (!albumId) return null;
  const album = await get(`albums/${albumId}`).catch(() => null);
  if (!album?.name) return null;
  return {
    name: album.name,
    art: album.images?.[0]?.url ?? "",
    released: album.release_date ?? "",
    label: album.label ?? "",
    total: album.total_tracks ?? 0,
    url: album.external_urls?.spotify ?? "",
    tracks: (album.tracks?.items ?? []).map((tr: any) => ({
      id: tr.id,
      number: tr.track_number ?? 0,
      title: tr.name,
      durationMs: tr.duration_ms ?? 0,
    })),
  };
}

/** Play a known track directly — the queue and tracklists hand us real ids. */
export async function playTrack(id: string): Promise<ControlResult> {
  try {
    const res = await fetch("https://api.spotify.com/v1/me/player/play", {
      method: "PUT",
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ uris: [`spotify:track:${id}`] }),
    });
    if (res.ok || res.status === 204) return "ok";
    if (res.status === 404) return "no-device";
    if (res.status === 403) return "premium-required";
    return "failed";
  } catch {
    return "failed";
  }
}
