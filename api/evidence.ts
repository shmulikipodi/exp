// Free, keyless evidence. MusicBrainz carries the credits liner notes are made of —
// producers, engineers, who played what, label, first release date — and Wikipedia
// carries the story. Both are fetched server-side and handed to the model as
// documents, so the notes don't depend on search-grounding quota.

const UA = "exp/1.0 ( https://github.com/ )";
const MB = "https://musicbrainz.org/ws/2";
const WP = "https://en.wikipedia.org/w/api.php";

export type Evidence = { text: string; sources: [string, string][] };

const clean = (s: string) => s.replace(/["\\]/g, " ").trim();

/** Loose title comparison — "Song (Remastered 2011)" is still the same song. */
export function sameSong(a: string | undefined, b: string): boolean {
  const norm = (v: string) =>
    v
      .toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const x = norm(a ?? "");
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json(url: string, timeoutMs = 4500, tries = 2): Promise<any> {
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "application/json" },
        signal: ctl.signal,
      });
      if (res.ok) return await res.json();
      // MusicBrainz allows one request a second and 503s the rest. Back off once.
      if (res.status !== 503 && res.status !== 429) return null;
    } catch {
      // network or timeout — one more go, then give up
    } finally {
      clearTimeout(timer);
    }
    await sleep(700);
  }
  return null; // evidence is best-effort — never fail the request over it
}

/** Recording-to-recording links: what it samples, what sampled it, what it covers.
 *  Prime liner-notes material, and it was being fetched and thrown away. */
function lineage(relations: any[]): string[] {
  const out: string[] = [];
  for (const r of relations ?? []) {
    const other = r?.recording;
    if (!other?.title) continue;
    const who = other["artist-credit"]?.[0]?.name;
    const direction = r.direction === "backward" ? "this was " : "this ";
    out.push(`  - ${direction}${r.type}: "${other.title}"${who ? ` by ${who}` : ""}`);
  }
  return [...new Set(out)];
}

/** Relations on a recording or work, flattened to "role: person" lines. */
function credits(relations: any[]): string[] {
  const out: string[] = [];
  for (const r of relations ?? []) {
    const who = r?.artist?.name;
    if (!who) continue;
    const attrs = (r.attributes ?? []).join(", ");
    const role = r.type === "instrument" || r.type === "vocal" ? attrs || r.type : r.type;
    if (role) out.push(`${role}: ${who}`);
  }
  return [...new Set(out)];
}

async function musicbrainz(
  title: string,
  artist: string,
  isrc: string,
  playingMs = 0,
): Promise<Evidence> {
  // An ISRC identifies the exact recording. Searching by title matches alternate
  // takes, remasters and covers just as happily as the thing actually playing.
  if (isrc) {
    const byIsrc = await json(
      `${MB}/isrc/${encodeURIComponent(isrc)}?inc=artist-rels+work-rels+releases+artist-credits+recording-rels&fmt=json`,
    );
    const match = (byIsrc?.recordings ?? []).find((r: any) => sameSong(r?.title, title));
    if (match?.id) return describeRecording(match, match.id, artist, true, playingMs);
  }

  const query = encodeURIComponent(`recording:"${clean(title)}" AND artist:"${clean(artist)}"`);
  const search = await json(`${MB}/recording/?query=${query}&fmt=json&limit=5`);
  const hit = (search?.recordings ?? []).find((r: any) => (r.score ?? 0) >= 90);
  if (!hit?.id) return { text: "", sources: [] };

  await sleep(600);
  const rec = await json(
    `${MB}/recording/${hit.id}?inc=artist-rels+work-rels+releases+artist-credits+recording-rels&fmt=json`,
  );
  if (!rec) return { text: "", sources: [] };

  return describeRecording(rec, hit.id, artist, false, playingMs);
}

/** Turns a MusicBrainz recording into the lines a liner note is actually built from. */
async function describeRecording(
  rec: any,
  id: string,
  artist: string,
  exact: boolean,
  playingMs = 0,
): Promise<Evidence> {
  const lines = credits(rec.relations);

  // Composers and lyricists hang off the underlying work, not the recording — but that
  // is a third round-trip with a wait in front of it, so it is only worth making when
  // the recording itself named nobody.
  const workId = (rec.relations ?? []).find((r: any) => r["target-type"] === "work")?.work?.id;
  if (workId && lines.length === 0) {
    await sleep(600);
    const work = await json(`${MB}/work/${workId}?inc=artist-rels&fmt=json`);
    lines.push(...credits(work?.relations));
  }

  const releases = (rec.releases ?? [])
    .map((r: any) => r.date)
    .filter(Boolean)
    .sort();
  const first = releases[0];
  const label = (rec.releases ?? []).find((r: any) => r["label-info"]?.[0]?.label?.name)?.[
    "label-info"
  ]?.[0]?.label?.name;

  const links = lineage(rec.relations);

  const body = [
    `MusicBrainz credits for "${rec.title}" — ${rec["artist-credit"]?.[0]?.name ?? artist}`,
    exact
      ? "This entry was matched by ISRC, so it is definitely the recording being played."
      : "Matched by title and artist, so check it is not an alternate take, remaster or cover.",
    rec.length ? `Recording length: ${Math.round(rec.length / 1000)}s` : "",
    rec.length && playingMs && Math.abs(rec.length - playingMs) > 5000
      ? `VERSION MISMATCH: the track playing is ${Math.round(playingMs / 1000)}s but this ` +
        `catalogue entry is ${Math.round(rec.length / 1000)}s. The listener is on a different ` +
        `cut — an edit, a remaster, a live take or an extended version. Worth one note if you ` +
        `can say which, and a reason to distrust any timing in this entry.`
      : "",
    first ? `Earliest release date on file: ${first}` : "",
    label ? `Label: ${label}` : "",
    lines.length ? `Credits:\n${[...new Set(lines)].map((l) => `  - ${l}`).join("\n")}` : "",
    links.length ? `Related recordings:\n${links.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const url = `https://musicbrainz.org/recording/${id}`;
  return { text: body, sources: [[url, `MusicBrainz — ${rec.title}`]] };
}

async function wikipedia(title: string, artist: string, album = ""): Promise<Evidence> {
  const term = encodeURIComponent(`${title} ${artist} song`);
  const search = await json(
    `${WP}?action=query&list=search&srsearch=${term}&srlimit=5&format=json&origin=*`,
  );
  const results = search?.query?.search ?? [];

  // The ISRC path exists so a same-titled song can't poison the credits. Taking search
  // result #1 on trust reopened that door on the other side: nine thousand characters
  // about the wrong record, under a prompt that says evidence outranks memory. A wrong
  // article is worse than no article, so an unrecognisable one is refused.
  const songPage = results.find((r: any) => sameSong(r?.title, title));
  const albumPage = album
    ? results.find((r: any) => sameSong(r?.title, album))
    : undefined;
  const page = songPage ?? albumPage;
  if (!page?.title) return { text: "", sources: [] };
  const aboutTheSong = Boolean(songPage);

  const extract = await json(
    `${WP}?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(page.title)}`,
  );
  const pages = extract?.query?.pages ?? {};
  const text = (Object.values(pages)[0] as any)?.extract ?? "";
  if (!text) return { text: "", sources: [] };

  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`;
  return {
    text:
      `Wikipedia — ${page.title}\n` +
      (aboutTheSong
        ? ""
        : `NOTE: this article is about the album, not this specific track. Do not assume ` +
          `anything in it describes the recording that is playing unless it says so.\n`) +
      text.slice(0, 7000),
    sources: [[url, `Wikipedia — ${page.title}`]],
  };
}

/** Both sources, in parallel, never throwing. Empty text means we found nothing. */
// 3. Every question and every "more notes" for the same track was re-running the whole
// gather — four MusicBrainz round-trips with 1.1s of deliberate spacing between them,
// for credits already in hand. Warm instances keep this; a cold one just pays once.
const BUDGET_MS = 9000;

function withBudget<T>(work: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), BUDGET_MS)),
  ]);
}

const CACHE_TTL_MS = 30 * 60_000;
const CACHE_MAX = 60;
const evidenceCache = new Map<string, { at: number; value: Evidence }>();

export async function gather(
  title: string,
  artist: string,
  isrc = "",
  album = "",
  durationMs = 0,
): Promise<Evidence> {
  const key = `${isrc}|${title}|${artist}|${album}|${durationMs}`.toLowerCase();
  const hit = evidenceCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const empty = { text: "", sources: [] as [string, string][] };
  // Each source gets its own clock. Racing them as a group meant one slow catalogue
  // lookup threw away an encyclopedia article that had already arrived.
  const [mb, wp, albumWp] = await Promise.all([
    withBudget(musicbrainz(title, artist, isrc, durationMs).catch(() => empty), empty),
    withBudget(wikipedia(title, artist, album).catch(() => empty), empty),
    // Most tracks have no article of their own but sit on an album that does, and it
    // usually describes the same sessions. Fetched alongside, it costs no time.
    album ? withBudget(wikipediaOn(`${album} ${artist} album`, album).catch(() => empty), empty) : empty,
  ]);

  // Two articles about the same record would otherwise be handed over twice.
  const seen = new Set(wp.sources.map(([url]) => url));
  const extra = albumWp.sources.some(([url]) => seen.has(url)) ? empty : albumWp;

  const value: Evidence = {
    text: [mb.text, wp.text, extra.text].filter(Boolean).join("\n\n---\n\n"),
    sources: [...mb.sources, ...wp.sources, ...extra.sources],
  };

  evidenceCache.set(key, { at: Date.now(), value });
  if (evidenceCache.size > CACHE_MAX) {
    evidenceCache.delete(evidenceCache.keys().next().value as string);
  }
  return value;
}

/* ---------- artist and album, gathered separately ---------- */

async function wikipediaOn(term: string, label: string): Promise<Evidence> {
  const search = await json(
    `${WP}?action=query&list=search&srsearch=${encodeURIComponent(term)}&srlimit=5&format=json&origin=*`,
  );
  const results = search?.query?.search ?? [];

  // Searching "Pearl Jam band musician" happily returns "Better Man (Pearl Jam song)".
  // The page about the subject is the one whose title IS the subject.
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const want = norm(label);
  const page =
    results.find((r: any) => norm(r.title) === want) ??
    results.find((r: any) => !/\bsong\b|\bsingle\b/i.test(r.title) && norm(r.title).includes(want)) ??
    results[0];
  if (!page?.title) return { text: "", sources: [] };

  const extract = await json(
    `${WP}?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(page.title)}`,
  );
  const text = (Object.values(extract?.query?.pages ?? {})[0] as any)?.extract ?? "";
  if (!text) return { text: "", sources: [] };

  return {
    text: `${label} — Wikipedia: ${page.title}\n${text.slice(0, 9000)}`,
    sources: [
      [
        `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
        `Wikipedia — ${page.title}`,
      ],
    ],
  };
}

/** Who the act is: formation, place, line-up. Not the song that happens to be playing. */
export async function gatherArtist(artist: string): Promise<Evidence> {
  const blank = { text: "", sources: [] as [string, string][] };
  const [mb, wp] = await Promise.all([
    (async () => {
      const found = await json(
        `${MB}/artist/?query=artist:"${clean(artist)}"&fmt=json&limit=3`,
      );
      const hit = (found?.artists ?? []).find((a: any) => (a.score ?? 0) >= 90);
      if (!hit?.id) return { text: "", sources: [] as [string, string][] };

      await sleep(600);
      const full = await json(`${MB}/artist/${hit.id}?inc=artist-rels&fmt=json`);
      if (!full) return { text: "", sources: [] as [string, string][] };

      const members = (full.relations ?? [])
        .filter((r: any) => r.type === "member of band" && r?.artist?.name)
        .map((r: any) => {
          const span = [r.begin, r.end].filter(Boolean).join("–");
          return `  - ${r.artist.name}${(r.attributes ?? []).length ? ` (${r.attributes.join(", ")})` : ""}${span ? ` ${span}` : ""}`;
        });

      const body = [
        `MusicBrainz artist: ${full.name}`,
        full.type ? `Type: ${full.type}` : "",
        full.area?.name ? `From: ${full.area.name}` : "",
        full["life-span"]?.begin
          ? `Active: ${full["life-span"].begin}${full["life-span"].ended ? `–${full["life-span"].end}` : " onwards"}`
          : "",
        members.length ? `Members on file:\n${[...new Set(members)].slice(0, 18).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        text: body,
        sources: [
          [`https://musicbrainz.org/artist/${hit.id}`, `MusicBrainz — ${full.name}`] as [string, string],
        ],
      };
    })().catch(() => blank),
    withBudget(wikipediaOn(`${artist} band musician`, artist).catch(() => blank), blank),
  ]);

  return {
    text: [mb.text, wp.text].filter(Boolean).join("\n\n---\n\n"),
    sources: [...mb.sources, ...wp.sources],
  };
}

/** The record as a whole: when it was made, who made it, what it did. */
export async function gatherAlbum(album: string, artist: string): Promise<Evidence> {
  const blank = { text: "", sources: [] as [string, string][] };
  const [mb, wp] = await Promise.all([
    (async () => {
      const found = await json(
        `${MB}/release-group/?query=releasegroup:"${clean(album)}" AND artist:"${clean(artist)}"&fmt=json&limit=3`,
      );
      const hit = (found?.["release-groups"] ?? []).find((g: any) => (g.score ?? 0) >= 90);
      if (!hit?.id) return { text: "", sources: [] as [string, string][] };

      const body = [
        `MusicBrainz release group: ${hit.title}`,
        hit["primary-type"] ? `Type: ${hit["primary-type"]}` : "",
        hit["first-release-date"] ? `First released: ${hit["first-release-date"]}` : "",
        (hit["artist-credit"] ?? []).length
          ? `Credited to: ${hit["artist-credit"].map((a: any) => a.name).join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        text: body,
        sources: [
          [`https://musicbrainz.org/release-group/${hit.id}`, `MusicBrainz — ${hit.title}`] as [
            string,
            string,
          ],
        ],
      };
    })().catch(() => blank),
    withBudget(wikipediaOn(`${album} ${artist} album`, album).catch(() => blank), blank),
  ]);

  return {
    text: [mb.text, wp.text].filter(Boolean).join("\n\n---\n\n"),
    sources: [...mb.sources, ...wp.sources],
  };
}
