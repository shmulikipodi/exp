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
function sameSong(a: string | undefined, b: string): boolean {
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

async function json(url: string, timeoutMs = 9000, tries = 2): Promise<any> {
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
    await sleep(1200);
  }
  return null; // evidence is best-effort — never fail the request over it
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

async function musicbrainz(title: string, artist: string, isrc: string): Promise<Evidence> {
  // An ISRC identifies the exact recording. Searching by title matches alternate
  // takes, remasters and covers just as happily as the thing actually playing.
  if (isrc) {
    const byIsrc = await json(`${MB}/isrc/${encodeURIComponent(isrc)}?fmt=json`);
    const match = (byIsrc?.recordings ?? []).find((r: any) => sameSong(r?.title, title));
    const exact = match?.id;
    if (exact) {
      await sleep(1100);
      const rec = await json(
        `${MB}/recording/${exact}?inc=artist-rels+work-rels+releases+artist-credits&fmt=json`,
      );
      if (rec) return describeRecording(rec, exact, artist, true);
    }
  }

  const query = encodeURIComponent(`recording:"${clean(title)}" AND artist:"${clean(artist)}"`);
  const search = await json(`${MB}/recording/?query=${query}&fmt=json&limit=5`);
  const hit = (search?.recordings ?? []).find((r: any) => (r.score ?? 0) >= 90);
  if (!hit?.id) return { text: "", sources: [] };

  await sleep(1100);
  const rec = await json(
    `${MB}/recording/${hit.id}?inc=artist-rels+work-rels+releases+artist-credits&fmt=json`,
  );
  if (!rec) return { text: "", sources: [] };

  return describeRecording(rec, hit.id, artist, false);
}

/** Turns a MusicBrainz recording into the lines a liner note is actually built from. */
async function describeRecording(
  rec: any,
  id: string,
  artist: string,
  exact: boolean,
): Promise<Evidence> {
  const lines = credits(rec.relations);

  // Composers and lyricists hang off the underlying work, not the recording.
  const workId = (rec.relations ?? []).find((r: any) => r["target-type"] === "work")?.work?.id;
  if (workId) {
    await sleep(1100);
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

  const body = [
    `MusicBrainz credits for "${rec.title}" — ${rec["artist-credit"]?.[0]?.name ?? artist}`,
    exact
      ? "This entry was matched by ISRC, so it is definitely the recording being played."
      : "Matched by title and artist, so check it is not an alternate take, remaster or cover.",
    rec.length ? `Recording length: ${Math.round(rec.length / 1000)}s` : "",
    first ? `Earliest release date on file: ${first}` : "",
    label ? `Label: ${label}` : "",
    lines.length ? `Credits:\n${[...new Set(lines)].map((l) => `  - ${l}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const url = `https://musicbrainz.org/recording/${id}`;
  return { text: body, sources: [[url, `MusicBrainz — ${rec.title}`]] };
}

async function wikipedia(title: string, artist: string): Promise<Evidence> {
  const term = encodeURIComponent(`${title} ${artist} song`);
  const search = await json(
    `${WP}?action=query&list=search&srsearch=${term}&srlimit=3&format=json&origin=*`,
  );
  const page = (search?.query?.search ?? [])[0];
  if (!page?.title) return { text: "", sources: [] };

  const extract = await json(
    `${WP}?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(page.title)}`,
  );
  const pages = extract?.query?.pages ?? {};
  const text = (Object.values(pages)[0] as any)?.extract ?? "";
  if (!text) return { text: "", sources: [] };

  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`;
  return {
    text: `Wikipedia — ${page.title}\n${text.slice(0, 7000)}`,
    sources: [[url, `Wikipedia — ${page.title}`]],
  };
}

/** Both sources, in parallel, never throwing. Empty text means we found nothing. */
export async function gather(title: string, artist: string, isrc = ""): Promise<Evidence> {
  const [mb, wp] = await Promise.all([
    musicbrainz(title, artist, isrc).catch(() => ({ text: "", sources: [] as [string, string][] })),
    wikipedia(title, artist).catch(() => ({ text: "", sources: [] as [string, string][] })),
  ]);
  return {
    text: [mb.text, wp.text].filter(Boolean).join("\n\n---\n\n"),
    sources: [...mb.sources, ...wp.sources],
  };
}
