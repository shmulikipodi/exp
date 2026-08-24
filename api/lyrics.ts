// Lyrics come from LRCLIB — a community database with no key, no account and no quota,
// used by most open-source players. It carries plain lyrics and, often, a synced LRC
// track, which is what this app actually wants: lines that arrive with the music.

const LRCLIB = "https://lrclib.net/api/get";

export type Line = { at: number; text: string };

/** "[01:23.45] words" → a line with a position in seconds. */
function parseLrc(lrc: string): Line[] {
  const lines: Line[] = [];
  for (const raw of lrc.split("\n")) {
    const m = raw.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
    if (!m) continue;
    const at = Number(m[1]) * 60 + Number(m[2]) + Number((m[3] ?? "0").padEnd(3, "0")) / 1000;
    lines.push({ at, text: m[4].trim() });
  }
  return lines.sort((a, b) => a.at - b.at);
}

export type Lyrics = { found: boolean; synced: boolean; lines: Line[]; plain: string };

const EMPTY: Lyrics = { found: false, synced: false, lines: [], plain: "" };

const cache = new Map<string, { at: number; value: Lyrics }>();
const TTL_MS = 30 * 60_000;

/** Shared with the notes pipeline, which uses the timestamps to place a note exactly. */
export async function fetchLyrics(
  track: string,
  artist: string,
  album = "",
  durationMs = 0,
): Promise<Lyrics> {
  const key = `${artist}|${track}|${album}|${durationMs}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const params = new URLSearchParams({ track_name: track, artist_name: artist });
  if (album) params.set("album_name", album);
  if (durationMs > 0) params.set("duration", String(Math.round(durationMs / 1000)));

  let value = EMPTY;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${LRCLIB}?${params}`, {
      headers: { "user-agent": "exp/1.0 ( https://github.com/ )" },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data: any = await res.json();
      const lines = data?.syncedLyrics ? parseLrc(String(data.syncedLyrics)) : [];
      value = {
        found: Boolean(data?.plainLyrics || lines.length),
        synced: lines.length > 0,
        lines,
        plain: String(data?.plainLyrics ?? ""),
      };
    }
  } catch {
    // No lyrics filed, or the service is down. Neither is worth failing a request over.
  }

  cache.set(key, { at: Date.now(), value });
  if (cache.size > 60) cache.delete(cache.keys().next().value as string);
  return value;
}

export default async function handler(req: any, res: any) {
  res.setHeader("content-type", "application/json");

  try {
    const q = new URL(req.url, "http://x").searchParams;
    const track = (q.get("title") ?? "").trim();
    const artist = (q.get("artist") ?? "").trim();
    if (!track || !artist) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "title and artist required" }));
    }

    const lyrics = await fetchLyrics(
      track,
      artist,
      (q.get("album") ?? "").trim(),
      Number(q.get("duration") ?? 0),
    );
    return res.end(JSON.stringify({ ...lyrics, source: "LRCLIB" }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
