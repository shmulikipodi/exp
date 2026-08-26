// Free, keyless evidence. MusicBrainz carries the credits liner notes are made of —
// producers, engineers, who played what, label, first release date — and Wikipedia
// carries the story. Both are fetched server-side and handed to the model as
// documents, so the notes don't depend on search-grounding quota.

import { asEvidence, story as geniusStory } from "./genius.js";

const UA = "exp/1.0 ( https://github.com/ )";

/**
 * An encyclopedia article opens with composition and recording and keeps the lawsuit,
 * the accusation and the myth for further down. Taking the first N characters therefore
 * kept the dullest part of every article and threw away the reason anyone remembers the
 * song — Stairway to Heaven arrived without the backwards-message trial, which is the
 * single thing most people know about it.
 *
 * So: keep the opening, then pick the paragraphs that carry a story.
 */
const SIGNALS =
  /\b(sued|suing|lawsuit|court|jury|verdict|settle\w*|plagiar\w*|stole|stolen|credit\w*|royalt\w*|banned|ban\b|censor\w*|controvers\w*|accus\w*|alleg\w*|denied|denies|rumou?r\w*|myth|legend|hoax|backward\w*|backmask\w*|subliminal|satan\w*|occult|protest\w*|boycott\w*|refus\w*|walked out|quit|fired|sacked|feud|argu\w*|fight|punch\w*|died|death|overdose|suicide|funeral|tribute|arrest\w*|drug\w*|affair|divorce|breakup|split|reunit\w*|apolog\w*|withdraw\w*|pulled|scrap\w*|almost|nearly|rejected|turned down|threat\w*|sample\w*|interpolat\w*|cover version|misheard|mistake|accident\w*|improvis\w*|first take|one take)\b/i;

/**
 * Sections an encyclopedia article keeps the good part in. "In popular culture" is a
 * list of every film, advert, riot and football chant a song ended up in; "Legacy" is
 * why anyone still plays it; "Cover versions" is who else thought it was worth
 * recording. Ranking paragraphs by keyword found some of this by accident. Naming the
 * sections finds all of it on purpose.
 */
const LIFE =
  /(legacy|popular culture|cultural|cover|parod|sampl|interpolat|controvers|scandal|lawsuit|litigation|court|banned|censor|in media|in film|film and television|television|advertis|impact|influence|aftermath|tribute|protest|reaction|meaning|interpretation)/i;

/** How it was made. Worth keeping, but never at the expense of the above. */
const MAKING = /(writing|composition|background|origin|lyric|analysis|theme|version|rendition|recording)/i;

const PRIZED = new RegExp(`${LIFE.source}|${MAKING.source}`, "i")

type Section = { heading: string; body: string };

/** Plain-text Wikipedia extracts mark their headings with == equals signs ==. */
function sections(text: string): Section[] {
  const out: Section[] = [];
  let heading = "";
  let buffer: string[] = [];
  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body) out.push({ heading, body });
    buffer = [];
  };
  for (const line of text.split(/\n/)) {
    const m = line.match(/^\s*=+\s*(.+?)\s*=+\s*$/);
    if (m) {
      flush();
      heading = m[1];
    } else {
      buffer.push(line);
    }
  }
  flush();
  return out;
}

export function highlights(text: string, budget: number): string {
  if (text.length <= budget) return text;

  const parts = sections(text);
  const kept: string[] = [];
  const taken = new Set<string>();
  let used = 0;

  const take = (chunk: string, label = "") => {
    if (used >= budget || taken.has(chunk)) return;
    taken.add(chunk);
    kept.push(label ? `== ${label} ==\n${chunk}` : chunk);
    used += chunk.length + label.length;
  };

  // The opening establishes what the song is; it always stays.
  const intro = parts.find((p) => !p.heading)?.body ?? text;
  intro
    .split(/\n+/)
    .filter((p) => p.trim().length > 40)
    .slice(0, 3)
    .forEach((p) => take(p));

  // Then the sections named above — but the song's life before the song's making. In
  // document order, "Writing and recording" and "Lyrics and interpretation" spent the
  // entire budget on a long article and "Legacy" and "Covers and parodies" never
  // arrived, which is the exact failure this whole function exists to prevent.
  for (const part of parts) {
    if (!LIFE.test(part.heading.trim())) continue;
    take(part.body.slice(0, 2200), part.heading);
  }
  for (const part of parts) {
    if (LIFE.test(part.heading.trim()) || !MAKING.test(part.heading.trim())) continue;
    take(part.body.slice(0, 1600), part.heading);
  }

  // Then whatever else carries a story — richest first, not first-come. Taking them in
  // document order let one long lawsuit section spend the whole budget before the
  // article ever got to the myth people actually remember.
  const rest = parts
    .filter((p) => !PRIZED.test(p.heading.trim()))
    .flatMap((p) => p.body.split(/\n+/))
    .filter((p) => p.trim().length > 40 && !taken.has(p));

  const scored = rest
    .map((p) => ({ p, score: (p.match(new RegExp(SIGNALS.source, "gi")) ?? []).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const { p } of scored) take(p);

  // Still room? Fill in with the rest rather than leaving the budget unspent.
  for (const p of rest) take(p);

  return kept.join("\n\n").slice(0, budget);
}
const MB = "https://musicbrainz.org/ws/2";
const wpApi = (lang: string) => `https://${lang}.wikipedia.org/w/api.php`;

/**
 * Which Wikipedias to ask. English is always one of them and usually the deepest, but
 * it is thin or absent for music that was never sung in it — an Israeli song may have a
 * substantial Hebrew article and no English one at all. The script the artist and title
 * are written in says more about where the article will be than the interface language
 * does.
 */
const SCRIPTS: [RegExp, string][] = [
  [/[\u0590-\u05FF]/, "he"],
  [/[\u0600-\u06FF]/, "ar"],
  [/[\u0400-\u04FF]/, "ru"],
  [/[\u0370-\u03FF]/, "el"],
  [/[\u3040-\u30FF]/, "ja"],
  [/[\uAC00-\uD7AF]/, "ko"],
  [/[\u4E00-\u9FFF]/, "zh"],
  [/[\u0900-\u097F]/, "hi"],
];

export function pickWikis(title: string, artist: string, uiLang = "en"): string[] {
  const langs = ["en"];
  const text = `${title} ${artist}`;
  for (const [script, lang] of SCRIPTS) {
    if (script.test(text) && !langs.includes(lang)) langs.push(lang);
  }
  // The reader's own language is worth a look even for a song written in another —
  // it often carries names and terms in the form they will be read in.
  if (uiLang !== "en" && !langs.includes(uiLang)) langs.push(uiLang);
  return langs.slice(0, 3);
}

export type Evidence = { text: string; sources: [string, string][] };

export const clean = (s: string) => s.replace(/["\\]/g, " ").trim();

/**
 * Loose title comparison — "Song (Remastered 2011)" is still the same song.
 *
 * Letters in any script, not just a-z. Stripping to [a-z0-9] reduced every Hebrew and
 * Japanese title to an empty string, so the guard rejected every article written about
 * them — the songs that most need a non-English Wikipedia were the ones that could
 * never reach it.
 */
export function sameSong(a: string | undefined, b: string): boolean {
  const norm = (v: string) =>
    v
      .toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const x = norm(a ?? "");
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function json(url: string, timeoutMs = 4500, tries = 2): Promise<any> {
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

/**
 * Every other artist who recorded this song, from the work all its recordings share.
 * MusicBrainz lists each take separately, so the same singer arrives ten times over —
 * one line per artist, and the original performer left out.
 */
function otherRecordings(relations: any[], performer: string, title: string): string[] {
  const byArtist = new Map<string, { line: string; straight: boolean }>();
  const mine = performer.toLowerCase();
  for (const r of relations ?? []) {
    const rec = r?.recording;
    if (!rec?.title) continue;
    const who = rec["artist-credit"]?.[0]?.name;
    if (!who || who.toLowerCase() === mine) continue;
    const key = who.toLowerCase();
    // A popular song collects hundreds of these, most of them live medleys and
    // eight-second teases. A recording whose title IS the song is someone covering it.
    const straight = sameSong(rec.title, title);
    const line = `${who} — "${rec.title}"`;
    const seen = byArtist.get(key);
    if (!seen || (straight && !seen.straight) || (straight === seen.straight && line.length < seen.line.length)) {
      byArtist.set(key, { line, straight });
    }
  }
  return [...byArtist.values()]
    .sort((a, b) => Number(b.straight) - Number(a.straight))
    .slice(0, 20)
    .map((x) => x.line);
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

  // Composers, lyricists and — the reason this round-trip is now always worth making —
  // every other recording of the same song. Who else thought it was worth cutting, and
  // who got there first, is a question a catalogue can answer and an encyclopedia
  // usually can't.
  const workId = (rec.relations ?? []).find((r: any) => r["target-type"] === "work")?.work?.id;
  let others: string[] = [];
  if (workId) {
    await sleep(600);
    const work = await json(
      `${MB}/work/${workId}?inc=artist-rels+recording-rels+artist-credits&fmt=json`,
    );
    if (lines.length === 0) lines.push(...credits(work?.relations));
    others = otherRecordings(work?.relations, rec["artist-credit"]?.[0]?.name ?? artist, rec.title);
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
    others.length
      ? `Other artists who recorded this song (MusicBrainz, ${others.length} of them):\n` +
        others.map((o) => `  - ${o}`).join("\n") +
        `\nA cover worth a note is one that changed the song's life — outsold the original, ` +
        `is what most people now think of as the song, or came from somewhere nobody expected. ` +
        `A list of names is not a note.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const url = `https://musicbrainz.org/recording/${id}`;
  return { text: body, sources: [[url, `MusicBrainz — ${rec.title}`]] };
}

async function wikipedia(
  title: string,
  artist: string,
  album = "",
  lang = "en",
): Promise<Evidence> {
  const api = wpApi(lang);
  const find = async (query: string) => {
    const res = await json(
      `${api}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json&origin=*`,
    );
    return res?.query?.search ?? [];
  };

  let results = await find(`${title} ${artist}`);
  // Some editions rank a two-term query badly — ja.wikipedia answers "プラスチックラブ
  // 竹内まりや" with five unrelated pages. The title alone finds it, and the title check
  // below is what makes trying that safe.
  if (!results.some((r: any) => sameSong(r?.title, title))) {
    const byTitle = await find(title);
    if (byTitle.length) results = [...byTitle, ...results];
  }

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
    `${api}?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(page.title)}`,
  );
  const pages = extract?.query?.pages ?? {};
  const text = (Object.values(pages)[0] as any)?.extract ?? "";
  if (!text) return { text: "", sources: [] };

  const tag = lang === "en" ? "Wikipedia" : `Wikipedia (${lang})`;
  const url = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`;
  return {
    text:
      `${tag} — ${page.title}\n` +
      (aboutTheSong
        ? ""
        : `NOTE: this article is about the album, not this specific track. Do not assume ` +
          `anything in it describes the recording that is playing unless it says so.\n`) +
      highlights(text, 9000),
    sources: [[url, `${tag} — ${page.title}`]],
  };
}

/* ---------- what the song is doing out in the world right now ---------- */

// GDELT indexes the world's news and answers without a key. An encyclopedia tells you
// a song was used in a film in 1994; this tells you it was in a trailer last month, or
// sued last week, or sung at a funeral that made the papers. Headlines only, which is
// enough to know that something happened and worth one note when it did.
const GDELT = "https://api.gdeltproject.org/api/v2/doc/doc";

async function fetchNews(title: string, artist: string): Promise<Evidence> {
  const query = `"${title}" ${artist}`;
  const url =
    `${GDELT}?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=25` +
    `&timespan=12m&sort=hybridrel&format=json`;

  const data = await json(url, 20000, 1);
  const articles: any[] = data?.articles ?? [];
  if (articles.length === 0) return { text: "", sources: [] };

  const want = title.toLowerCase();
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const a of articles) {
    const headline = String(a?.title ?? "").trim();
    const domain = String(a?.domain ?? "");
    // The query is loose enough to return anything mentioning the band. A headline
    // that doesn't name the song is about the band, and that is a different note.
    if (!headline || !headline.toLowerCase().includes(want)) continue;
    if (seen.has(headline)) continue;
    seen.add(headline);
    const when = String(a?.seendate ?? "").slice(0, 8);
    const date = when.length === 8 ? `${when.slice(0, 4)}-${when.slice(4, 6)}` : "";
    lines.push(`  - ${date ? `[${date}] ` : ""}${headline}${domain ? ` (${domain})` : ""}`);
    if (lines.length === 10) break;
  }
  if (lines.length === 0) return { text: "", sources: [] };

  return {
    text:
      `News in the last year that names this song (GDELT, headlines only):\n` +
      lines.join("\n") +
      `\nHeadlines are not facts. Use one only if it points at something you can state ` +
      `plainly — a sync, a lawsuit, a death, an anniversary, a cover that charted. Never ` +
      `write a note whose whole content is that a newspaper mentioned the song.`,
    sources: [],
  };
}

// GDELT takes about seventeen seconds to answer, which is twice the whole evidence
// budget. So it is never waited for: asking starts the fetch and returns whatever
// arrived from an earlier ask. The first play of a track gets no headlines; the second
// look at it — more notes, a question, hearing it again — gets them.
const newsCache = new Map<string, { at: number; value: Evidence }>();
const newsPending = new Set<string>();
const NEWS_TTL_MS = 6 * 60 * 60_000;

function news(title: string, artist: string): Evidence {
  const key = `${title}|${artist}`.toLowerCase();
  const hit = newsCache.get(key);
  if (hit && Date.now() - hit.at < NEWS_TTL_MS) return hit.value;

  if (!newsPending.has(key)) {
    newsPending.add(key);
    const remember = (value: Evidence) => {
      newsCache.set(key, { at: Date.now(), value });
      newsPending.delete(key);
      if (newsCache.size > 60) newsCache.delete(newsCache.keys().next().value as string);
    };
    fetchNews(title, artist).then(remember, () => remember({ text: "", sources: [] }));
  }
  return { text: "", sources: [] };
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
  uiLang = "en",
): Promise<Evidence> {
  const wikis = pickWikis(title, artist, uiLang);
  const key = `${isrc}|${title}|${artist}|${album}|${durationMs}|${wikis.join(",")}`.toLowerCase();
  const hit = evidenceCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const empty = { text: "", sources: [] as [string, string][] };
  // Each source gets its own clock. Racing them as a group meant one slow catalogue
  // lookup threw away an encyclopedia article that had already arrived.
  const [mb, band, press, genius, ...articles] = await Promise.all([
    withBudget(musicbrainz(title, artist, isrc, durationMs).catch(() => empty), empty),
    // A small, story-filtered slice of the band's own article. What happened to the
    // people who made a record is often the most remarkable thing about it, and a song
    // page never says so — Pantera's guitarist was shot dead on stage and buried with
    // one of Eddie Van Halen's guitars, and no amount of reading about "Floods" finds
    // that out.
    withBudget(bandStory(artist, wikis[0]).catch(() => empty), empty),
    // What the song has been doing lately, which no encyclopedia is fast enough to know.
    // Never waited for; see news() for why.
    news(title, artist),
    // The only source that is about what the song means rather than how it was made.
    withBudget(
      geniusStory(title, artist)
        .then((s) => ({ text: asEvidence(s), sources: s.found ? ([[s.url, "Genius"]] as [string, string][]) : [] }))
        .catch(() => empty),
      empty,
    ),
    // Every language edition worth asking, at once.
    ...wikis.map((lang) =>
      withBudget(wikipedia(title, artist, album, lang).catch(() => empty), empty),
    ),
    // Most tracks have no article of their own but sit on an album that does, and it
    // usually describes the same sessions. Fetched alongside, it costs no time.
    album
      ? withBudget(wikipediaOn(`${album} ${artist}`, album, wikis[0]).catch(() => empty), empty)
      : empty,
  ]);

  // The same article must not arrive twice under different searches.
  const seen = new Set<string>();
  const kept = articles.filter((a) => {
    const url = a.sources[0]?.[0];
    if (!a.text || !url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });

  const value: Evidence = {
    // press has no sources of its own — headlines are a pointer, not a citation — so it
    // is joined in by hand rather than going through the de-duplicating filter above.
    text: [genius.text, mb.text, ...kept.map((a) => a.text), band.text, press.text]
      .filter(Boolean)
      .join("\n\n---\n\n"),
    sources: [...genius.sources, ...mb.sources, ...kept.flatMap((a) => a.sources), ...band.sources],
  };

  evidenceCache.set(key, { at: Date.now(), value });
  if (evidenceCache.size > CACHE_MAX) {
    evidenceCache.delete(evidenceCache.keys().next().value as string);
  }
  return value;
}

/* ---------- artist and album, gathered separately ---------- */

async function wikipediaOn(term: string, label: string, lang = "en"): Promise<Evidence> {
  const api = wpApi(lang);
  const search = await json(
    `${api}?action=query&list=search&srsearch=${encodeURIComponent(term)}&srlimit=5&format=json&origin=*`,
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
    `${api}?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(page.title)}`,
  );
  const text = (Object.values(extract?.query?.pages ?? {})[0] as any)?.extract ?? "";
  if (!text) return { text: "", sources: [] };

  const tag = lang === "en" ? "Wikipedia" : `Wikipedia (${lang})`;
  return {
    text: `${label} — ${tag}: ${page.title}\n${highlights(text, 11000)}`,
    sources: [
      [
        `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
        `${tag} — ${page.title}`,
      ],
    ],
  };
}

/** What became of the band, kept short. Only the paragraphs that carry a story. */
async function bandStory(artist: string, lang: string): Promise<Evidence> {
  const found = await wikipediaOn(`${artist} band musician`, artist, lang);
  if (!found.text) return { text: "", sources: [] };
  return {
    text: `ABOUT THE BAND ITSELF — what happened to the people who made this record. Use at
most one of these, and only if it is genuinely remarkable.\n${highlights(found.text, 3500)}`,
    sources: found.sources,
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
