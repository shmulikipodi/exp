// Where a song came from and what came out of it.
//
// MusicBrainz models this properly and nothing else free does: every recording of a
// song hangs off one shared "work", and recordings link to each other for samples,
// remixes and covers. So the catalogue can answer questions the sleeve never could —
// who else cut this, who got there first, what it was built out of, what was built
// out of it. Smells Like Teen Spirit has 211 other artists on its work.

import { clean, json, sameSong } from "./_lib/evidence.js";
import { story as geniusStory } from "./_lib/genius.js";

const MB = "https://musicbrainz.org/ws/2";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Related = { kind: string; title: string; artist: string };
export type Cover = {
  artist: string;
  title: string;
  year: string;
  live: boolean;
  instrumental: boolean;
};

export type Tree = {
  found: boolean;
  title: string;
  artist: string;
  year: string;
  label: string;
  /** What the song is about, in a sentence or two. */
  about: string;
  /** What this recording was made out of: what it samples, what it is a cover of. */
  from: Related[];
  /** What was made out of it. */
  into: Related[];
  covers: Cover[];
  /** Everything on the work, including the live takes and medleys not listed. */
  coverCount: number;
  source: string;
};


const cache = new Map<string, { at: number; value: Tree }>();
const TTL_MS = 6 * 60 * 60_000;

/**
 * Recording-to-recording links, split by which way they point. "This samples X" and
 * "X samples this" are two different facts about a record and the app shows them as
 * two different lists.
 */
function related(relations: any[], forward: boolean): Related[] {
  const out: Related[] = [];
  for (const r of relations ?? []) {
    const other = r?.recording;
    if (!other?.title) continue;
    // MusicBrainz says "backward" when the other recording is the one doing the verb.
    if ((r.direction !== "backward") !== forward) continue;
    out.push({
      kind: String(r.type ?? "related"),
      title: other.title,
      artist: other["artist-credit"]?.[0]?.name ?? "",
    });
  }
  return out.slice(0, 8);
}

/** One row per artist: a song this popular has four hundred live takes on its work. */
export function covers(relations: any[], performer: string, title: string): Cover[] {
  const best = new Map<string, Cover & { rank: number }>();
  const mine = performer.toLowerCase();

  for (const r of relations ?? []) {
    const rec = r?.recording;
    if (!rec?.title) continue;
    const who = rec["artist-credit"]?.[0]?.name;
    if (!who || who.toLowerCase() === mine) continue;

    const attrs: string[] = r.attributes ?? [];
    if (attrs.includes("karaoke") || attrs.includes("partial") || attrs.includes("medley")) {
      continue;
    }

    const live = attrs.includes("live");
    // A recording whose title IS the song, cut in a studio, is someone properly
    // covering it. Everything else is a step further away and ranks below.
    const straight = sameSong(rec.title, title);
    const rank = (straight ? 0 : 2) + (live ? 1 : 0);

    const key = who.toLowerCase();
    const seen = best.get(key);
    if (seen && seen.rank <= rank) continue;
    best.set(key, {
      rank,
      artist: who,
      title: rec.title,
      year: String(r.begin ?? "").slice(0, 4),
      live,
      instrumental: attrs.includes("instrumental"),
    });
  }

  return [...best.values()]
    .sort((a, b) => a.rank - b.rank || (a.year || "9999").localeCompare(b.year || "9999"))
    .slice(0, 40)
    .map(({ rank: _rank, ...cover }) => cover);
}

const asRelated = (l: { kind: string; title: string; artist: string }): Related => ({
  kind: l.kind,
  title: l.title,
  artist: l.artist,
});

/** Jay-Z's Holy Grail both samples this and interpolates it. It is still one row. */
export function once(links: Related[], limit: number): Related[] {
  const seen = new Set<string>();
  const out: Related[] = [];
  for (const l of links) {
    const key = `${l.artist}|${l.title}`.toLowerCase();
    if (!l.title || seen.has(key)) continue;
    seen.add(key);
    out.push(l);
    if (out.length === limit) break;
  }
  return out;
}

/** The opening of the Genius page — enough to say what the song is, not a whole essay. */
function firstLines(about: string): string {
  const stop = about.indexOf("\n\n");
  return (stop > 80 ? about.slice(0, stop) : about).slice(0, 320).trim();
}

type Catalogue = { title: string; artist: string; year: string; label: string; relations: any[]; covers: Cover[]; coverCount: number; id: string };

const EMPTY_CAT: Catalogue = {
  title: "",
  artist: "",
  year: "",
  label: "",
  relations: [],
  covers: [],
  coverCount: 0,
  id: "",
};

async function fetchCatalogue(title: string, artist: string, isrc: string): Promise<Catalogue> {
  const inc = "work-rels+releases+artist-credits+recording-rels";
  let rec: any = null;

  // An ISRC names the exact recording. Searching by title finds alternate takes and
  // other people's covers just as happily as the thing actually playing.
  if (isrc) {
    const byIsrc = await json(`${MB}/isrc/${encodeURIComponent(isrc)}?inc=${inc}&fmt=json`);
    rec = (byIsrc?.recordings ?? []).find((r: any) => sameSong(r?.title, title)) ?? null;
  }
  if (!rec) {
    const query = encodeURIComponent(`recording:"${clean(title)}" AND artist:"${clean(artist)}"`);
    const search = await json(`${MB}/recording/?query=${query}&fmt=json&limit=5`);
    const found = (search?.recordings ?? []).find((r: any) => (r.score ?? 0) >= 90);
    if (found?.id) {
      await sleep(600);
      rec = await json(`${MB}/recording/${found.id}?inc=${inc}&fmt=json`);
    }
  }
  if (!rec?.id) return EMPTY_CAT;

  const performer = rec["artist-credit"]?.[0]?.name ?? artist;
  const dates = (rec.releases ?? []).map((r: any) => r.date).filter(Boolean).sort();
  const label =
    (rec.releases ?? []).find((r: any) => r["label-info"]?.[0]?.label?.name)?.["label-info"]?.[0]
      ?.label?.name ?? "";

  const workId = (rec.relations ?? []).find((r: any) => r["target-type"] === "work")?.work?.id;
  let sung: Cover[] = [];
  let total = 0;
  if (workId) {
    await sleep(600);
    const work = await json(`${MB}/work/${workId}?inc=recording-rels+artist-credits&fmt=json`);
    const rels = (work?.relations ?? []).filter((r: any) => r["target-type"] === "recording");
    sung = covers(rels, performer, rec.title);
    total = new Set(
      rels
        .map((r: any) => r.recording?.["artist-credit"]?.[0]?.name?.toLowerCase())
        .filter((n: string) => n && n !== performer.toLowerCase()),
    ).size;
  }

  return {
    title: rec.title,
    artist: performer,
    year: String(dates[0] ?? "").slice(0, 4),
    label,
    relations: rec.relations ?? [],
    covers: sung,
    coverCount: total,
    id: rec.id,
  };
}

// Three round-trips with a second of deliberate silence between them, against a host
// that 503s anything faster. Seventeen seconds is not a column you can put on a screen,
// so it is never waited for: the page comes back with the part Genius knows, and the
// catalogue's half is there the next time the track comes round.
const catCache = new Map<string, Catalogue>();
const catPending = new Set<string>();

function catalogue(title: string, artist: string, isrc: string): Catalogue {
  const key = `${isrc}|${title}|${artist}`.toLowerCase();
  const hit = catCache.get(key);
  if (hit) return hit;

  if (!catPending.has(key)) {
    catPending.add(key);
    const remember = (value: Catalogue) => {
      catCache.set(key, value);
      catPending.delete(key);
      if (catCache.size > 60) catCache.delete(catCache.keys().next().value as string);
    };
    fetchCatalogue(title, artist, isrc).then(remember, () => remember(EMPTY_CAT));
  }
  return EMPTY_CAT;
}

export async function songTree(title: string, artist: string, isrc = ""): Promise<Tree> {
  const key = `${isrc}|${title}|${artist}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const page = await geniusStory(title, artist).catch(() => null);
  const cat = catalogue(title, artist, isrc);
  const about = page?.about ? firstLines(page.about) : "";

  const from = once([...(page?.from ?? []).map(asRelated), ...related(cat.relations, true)], 6);
  const into = once([...(page?.into ?? []).map(asRelated), ...related(cat.relations, false)], 6);

  const value: Tree = {
    found: Boolean(about) || from.length > 0 || into.length > 0 || cat.covers.length > 0,
    title: cat.title || title,
    artist: cat.artist || artist,
    year: cat.year,
    label: cat.label,
    about,
    from,
    into,
    covers: cat.covers,
    coverCount: cat.coverCount,
    source: cat.id ? `https://musicbrainz.org/recording/${cat.id}` : (page?.url ?? ""),
  };

  // Only worth remembering once the slow half has arrived; until then the next request
  // should look again and pick it up.
  if (cat.id) {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 60) cache.delete(cache.keys().next().value as string);
  }
  return value;
}

export default async function handler(req: any, res: any) {
  res.setHeader("content-type", "application/json");
  try {
    const q = new URL(req.url, "http://x").searchParams;
    const title = (q.get("title") ?? "").trim();
    const artist = (q.get("artist") ?? "").trim();
    if (!title || !artist) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "title and artist required" }));
    }
    res.setHeader("cache-control", "public, max-age=1800");
    return res.end(JSON.stringify(await songTree(title, artist, (q.get("isrc") ?? "").trim())));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
