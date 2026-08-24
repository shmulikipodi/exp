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

    const params = new URLSearchParams({ track_name: track, artist_name: artist });
    const album = (q.get("album") ?? "").trim();
    if (album) params.set("album_name", album);
    const duration = Number(q.get("duration") ?? 0);
    if (duration > 0) params.set("duration", String(Math.round(duration / 1000)));

    const upstream = await fetch(`${LRCLIB}?${params}`, {
      headers: { "user-agent": "exp/1.0 ( https://github.com/ )" },
    });

    // 404 is the ordinary answer for a track nobody has transcribed.
    if (upstream.status === 404) return res.end(JSON.stringify({ lines: [], plain: "", found: false }));
    if (!upstream.ok) {
      res.statusCode = 502;
      return res.end(JSON.stringify({ error: `Lyrics service returned ${upstream.status}` }));
    }

    const data: any = await upstream.json();
    const lines = data?.syncedLyrics ? parseLrc(String(data.syncedLyrics)) : [];

    return res.end(
      JSON.stringify({
        found: Boolean(data?.plainLyrics || lines.length),
        synced: lines.length > 0,
        lines,
        plain: String(data?.plainLyrics ?? ""),
        source: "LRCLIB",
      }),
    );
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
