// The one source that is actually about what a song means.
//
// MusicBrainz knows who played on it and Wikipedia knows what happened around it.
// Neither one will tell you what a line is about. Genius is people arguing about
// exactly that, line by line, plus an editorial account of the song and a map of what
// it was built from and what got built out of it — ranked, unlike a catalogue, so the
// interpolation everybody knows sits above the one nobody has heard.
//
// Read from the site's own JSON endpoints: no key, no account, no quota.

import { sameSong } from "./evidence.js";

const G = "https://genius.com/api";
// Genius answers a default agent with an interstitial. A named one gets the JSON.
const UA = "Mozilla/5.0 (compatible; exp/1.0; +https://exp-pearl.vercel.app)";

export type Link = { kind: string; title: string; artist: string; weight: number };
export type Annotation = { line: string; note: string; votes: number };

export type Story = {
  found: boolean;
  url: string;
  about: string;
  writers: string[];
  producers: string[];
  recordedAt: string;
  released: string;
  /** What it was made out of. */
  from: Link[];
  /** What was made out of it. */
  into: Link[];
  annotations: Annotation[];
  annotationCount: number;
};

const NOTHING: Story = {
  found: false,
  url: "",
  about: "",
  writers: [],
  producers: [],
  recordedAt: "",
  released: "",
  from: [],
  into: [],
  annotations: [],
  annotationCount: 0,
};

const BACKWARD: Record<string, string> = {
  samples: "samples",
  interpolates: "interpolates",
  cover_of: "is a cover of",
  remix_of: "is a remix of",
  live_version_of: "is a live version of",
};
const FORWARD: Record<string, string> = {
  sampled_in: "sampled in",
  interpolated_by: "interpolated by",
  covered_by: "covered by",
  remixed_by: "remixed by",
};

async function json(url: string, timeoutMs = 8000, tries = 2): Promise<any> {
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "application/json" },
        signal: ctl.signal,
      });
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) return null;
    } catch {
      // timeout or network — one more go
    } finally {
      clearTimeout(timer);
    }
  }
  return null; // one more source that must never fail a request
}

const loose = (v: string) =>
  v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The song page for this recording, not a tribute band's.
 *
 * Genius answers "Smells Like Teen Spirit Nirvana" with the original and eleven
 * covers of it, all sharing the title. The primary artist is what tells them apart.
 */
export function pickSong(hits: any[], title: string, artist: string): any | null {
  const who = loose(artist);
  for (const hit of hits) {
    const song = hit?.result ?? hit;
    if (!song?.id) continue;
    const name = loose(song.primary_artist?.name ?? "");
    if (!name || !(name.includes(who) || who.includes(name))) continue;
    if (!sameSong(song.title, title)) continue;
    return song;
  }
  return null;
}

/**
 * Relationships, most-read first. Genius carries a pageview count, which is the
 * popularity signal a catalogue never has: it is the difference between telling
 * someone Tyler, The Creator interpolated this and telling them David0Mario did.
 */
export function rank(relationships: any[], map: Record<string, string>): Link[] {
  const out: Link[] = [];
  for (const rel of relationships ?? []) {
    const kind = map[rel?.relationship_type];
    if (!kind) continue;
    for (const song of rel.songs ?? []) {
      out.push({
        kind,
        title: String(song?.title ?? ""),
        artist: String(song?.primary_artist?.name ?? song?.artist_names ?? ""),
        weight: Number(song?.stats?.pageviews ?? 0),
      });
    }
  }
  out.sort((a, b) => b.weight - a.weight);
  // Everything Genius has ever been asked about ends up on a famous song's page. If
  // enough of them are things people actually read, the rest are not worth the room.
  const read = out.filter((l) => l.weight > 0);
  return (read.length >= 3 ? read : out).filter((l) => l.title).slice(0, 6);
}

const cache = new Map<string, { at: number; value: Story }>();
const TTL_MS = 6 * 60 * 60_000;

export async function story(title: string, artist: string): Promise<Story> {
  const key = `${artist}|${title}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const remember = (value: Story) => {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 60) cache.delete(cache.keys().next().value as string);
    return value;
  };

  const found = await json(
    `${G}/search/multi?q=${encodeURIComponent(`${title} ${artist}`)}`,
  );
  const sections = found?.response?.sections ?? [];
  const hits = sections.find((s: any) => s?.type === "song")?.hits ?? [];
  const picked = pickSong(hits, title, artist);
  if (!picked?.id) return remember(NOTHING);

  const [full, refs] = await Promise.all([
    json(`${G}/songs/${picked.id}?text_format=plain`),
    json(`${G}/referents?song_id=${picked.id}&text_format=plain&per_page=25`),
  ]);
  const song = full?.response?.song;
  if (!song) return remember(NOTHING);

  const annotations: Annotation[] = [];
  for (const ref of refs?.response?.referents ?? []) {
    const line = String(ref?.fragment ?? "").replace(/\s+/g, " ").trim();
    const best = (ref?.annotations ?? [])[0];
    const note = String(best?.body?.plain ?? "").replace(/\s+/g, " ").trim();
    if (!line || note.length < 40) continue;
    annotations.push({ line, note: note.slice(0, 700), votes: Number(best?.votes_total ?? 0) });
  }
  annotations.sort((a, b) => b.votes - a.votes);

  return remember({
    found: true,
    url: `https://genius.com${song.path ?? ""}`,
    about: String(song.description?.plain ?? "").trim().slice(0, 2500),
    writers: (song.writer_artists ?? []).map((a: any) => String(a?.name ?? "")).filter(Boolean),
    producers: (song.producer_artists ?? []).map((a: any) => String(a?.name ?? "")).filter(Boolean),
    recordedAt: String(song.recording_location ?? ""),
    released: String(song.release_date_for_display ?? ""),
    from: rank(song.song_relationships, BACKWARD),
    into: rank(song.song_relationships, FORWARD),
    annotations: annotations.slice(0, 10),
    annotationCount: Number(song.annotation_count ?? annotations.length),
  });
}

/** The same story, written out for the model. */
export function asEvidence(s: Story): string {
  if (!s.found) return "";
  const lines: string[] = ["Genius — the song's own page"];

  if (s.about) lines.push(`What the page says the song is:\n${s.about}`);
  if (s.writers.length) lines.push(`Written by: ${s.writers.join(", ")}`);
  if (s.producers.length) lines.push(`Produced by: ${s.producers.join(", ")}`);
  if (s.recordedAt) lines.push(`Recorded at: ${s.recordedAt}`);
  if (s.released) lines.push(`Released: ${s.released}`);

  const links = [...s.from, ...s.into];
  if (links.length) {
    lines.push(
      `Built from and built into, most-read first:\n` +
        links.map((l) => `  - ${l.kind}: "${l.title}" by ${l.artist}`).join("\n"),
    );
  }

  if (s.annotations.length) {
    lines.push(
      `Line-by-line readings from Genius. THESE ARE READERS' INTERPRETATIONS, not ` +
        `established fact — most are written by anonymous contributors and some are ` +
        `wrong. They are here because they are the argument about what this song means, ` +
        `which is the thing a listener most wants and no catalogue holds. Use them to ` +
        `find out what is disputed and what the writer has actually said; attribute an ` +
        `interpretation as an interpretation ("the line is usually read as", "Cobain ` +
        `told Rolling Stone"), never as a plain fact. Prefer any reading that quotes ` +
        `the artist over one that does not:\n` +
        s.annotations
          .map((a) => `  - "${a.line}"\n    → ${a.note}`)
          .join("\n"),
    );
  }

  return lines.join("\n");
}
