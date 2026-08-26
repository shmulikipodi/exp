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

// Two ways in, because the free one only works from a laptop. genius.com/api is the
// site's own endpoint — no key, complete data — but it sits behind Cloudflare, which
// answers a datacenter IP with a 403 challenge, so in production it returns nothing.
// api.genius.com is the documented API, carries the same fields, and takes a free
// token. With a token, that; without one, the open endpoint, so local development and
// anyone self-hosting still get the best source this app has.
const OPEN = "https://genius.com/api";
const OFFICIAL = "https://api.genius.com";
const UA = "Mozilla/5.0 (compatible; exp/1.0; +https://exp-pearl.vercel.app)";

const token = () => (process.env.GENIUS_TOKEN ?? "").trim();
const base = () => (token() ? OFFICIAL : OPEN);
const headers = () => {
  const auth = token();
  return {
    "user-agent": UA,
    accept: "application/json",
    ...(auth ? { authorization: `Bearer ${auth}` } : {}),
  };
};

export type Link = { kind: string; title: string; artist: string; art: string; weight: number };
export type Person = { name: string; role: string; image: string };
export type Annotation = { line: string; note: string; votes: number };

export type Story = {
  found: boolean;
  url: string;
  about: string;
  writers: string[];
  producers: string[];
  recordedAt: string;
  released: string;
  /** Everyone the page credits, and what each of them actually did. */
  people: Person[];
  /** Songs this one is built out of: what it samples, what it interpolates. */
  uses: Link[];
  /** Songs built out of this one. */
  usedBy: Link[];
  /** Other people's recordings of it. */
  coveredBy: Link[];
  /** If the track playing is itself a cover, the record it is a cover of. */
  original: Link[];
  /** Remixes, and the live readings that got their own page. */
  versions: Link[];
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
  people: [],
  uses: [],
  usedBy: [],
  coveredBy: [],
  original: [],
  versions: [],
  annotations: [],
  annotationCount: 0,
};

// A song's relatives, sorted into the four questions a listener actually asks: what is
// this built out of, what got built out of it, who else has sung it, and — when the
// thing playing is itself somebody else's song — whose was it first.
const USES: Record<string, string> = { samples: "samples", interpolates: "interpolates" };
const USED_BY: Record<string, string> = {
  sampled_in: "samples this",
  interpolated_by: "interpolates this",
};
const COVERED_BY: Record<string, string> = { covered_by: "covered it" };
const ORIGINAL: Record<string, string> = {
  cover_of: "the original",
  remix_of: "remixes",
  live_version_of: "live take of",
};
const VERSIONS: Record<string, string> = {
  remixed_by: "remixed it",
  performed_live_as: "played live as",
};

async function json(url: string, timeoutMs = 8000, tries = 2): Promise<any> {
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: headers(), signal: ctl.signal });
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
        art: String(song?.song_art_image_thumbnail_url ?? ""),
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

/**
 * Everyone credited, with the thing they actually did.
 *
 * Genius keeps three separate lists — the writers, the producers, and a free-form set
 * of "custom performances" that is where the interesting entries live: Bass Guitar,
 * Assistant Mixing Engineer, Mastered At. One person often appears in more than one of
 * them, and a name with two roles is one line, not two.
 */
export function people(song: any): Person[] {
  const byName = new Map<string, Person>();

  const add = (name: string, role: string, image = "") => {
    if (!name) return;
    const key = name.toLowerCase();
    const seen = byName.get(key);
    if (!seen) {
      byName.set(key, { name, role, image });
      return;
    }
    if (image && !seen.image) seen.image = image;
    if (role && !seen.role.toLowerCase().includes(role.toLowerCase())) {
      seen.role = `${seen.role}, ${role.toLowerCase()}`;
    }
  };

  for (const a of song?.writer_artists ?? []) add(a?.name, "Writer", a?.image_url);
  for (const a of song?.producer_artists ?? []) add(a?.name, "Producer", a?.image_url);
  for (const p of song?.custom_performances ?? []) {
    for (const a of p?.artists ?? []) add(a?.name, String(p?.label ?? ""), a?.image_url);
  }

  // Publishers, labels and copyright lines are business, not creation.
  const RIGHTS = /publish|copyright|℗|©|label|distribut|clearance/i;
  // Roughly the order someone would want them: the ones who wrote and played it, then
  // the ones who captured it, then the ones who filmed it.
  const TIER = [
    /writ|compos|lyric|produc|arrang|vocal|guitar|bass|drum|keyboard|piano|string|horn|sax|violin|cell|perform|feature/i,
    /engineer|mix|master|record|studio|programm/i,
  ];
  const tier = (role: string) => {
    const i = TIER.findIndex((rx) => rx.test(role));
    return i < 0 ? TIER.length : i;
  };

  return [...byName.values()]
    .filter((p) => !RIGHTS.test(p.role))
    .sort((a, b) => tier(a.role) - tier(b.role))
    .slice(0, 16);
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

  const q = encodeURIComponent(`${title} ${artist}`);
  const found = token()
    ? await json(`${OFFICIAL}/search?q=${q}`)
    : await json(`${OPEN}/search/multi?q=${q}`);

  // /search returns hits directly; /search/multi buckets them into sections.
  const hits =
    found?.response?.hits ??
    (found?.response?.sections ?? []).find((s: any) => s?.type === "song")?.hits ??
    [];
  const picked = pickSong(hits, title, artist);
  if (!picked?.id) return remember(NOTHING);

  const [full, refs] = await Promise.all([
    json(`${base()}/songs/${picked.id}?text_format=plain`),
    json(`${base()}/referents?song_id=${picked.id}&text_format=plain&per_page=25`),
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
    people: people(song),
    uses: rank(song.song_relationships, USES),
    usedBy: rank(song.song_relationships, USED_BY),
    coveredBy: rank(song.song_relationships, COVERED_BY),
    original: rank(song.song_relationships, ORIGINAL),
    versions: rank(song.song_relationships, VERSIONS),
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

  if (s.people.length) {
    lines.push(
      `Credited, and what each did:\n` +
        s.people.map((p) => `  - ${p.role}: ${p.name}`).join("\n"),
    );
  }

  const links = [...s.original, ...s.uses, ...s.usedBy, ...s.coveredBy, ...s.versions];
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
