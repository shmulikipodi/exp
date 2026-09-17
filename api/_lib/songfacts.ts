// The less authoritative source, and often the more interesting one.
//
// Songfacts is a twenty-year-old community database of things about individual songs:
// who a line is about, what an argument was over, which advert it ended up in, what the
// writer said in some interview nobody else indexed. It is not an encyclopedia and it
// does not pretend to be — entries are submitted, lightly edited, and occasionally
// wrong.
//
// That trade is worth making as long as the reader is told. An interesting claim marked
// "Songfacts, which is a fan database" is worth more than a dull certainty, and worth
// far more than the same claim passed off as established.

const UA = "Mozilla/5.0 (compatible; exp/1.0; +https://exp-pearl.vercel.app)";

/** songfacts.com/facts/guns-n-roses/november-rain */
export function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Ampersands are spelled out in their URLs — "guns-n-roses", not "guns-&-roses".
    .replace(/&/g, " n ")
    .replace(/[''’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const strip = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The facts out of a Songfacts page.
 *
 * Their entries are list items inside the body. Anything short is navigation, anything
 * starting with a brace is the page's own JSON-LD, and the "Comments" section below is
 * readers arguing rather than the entries themselves.
 */
export function factsFrom(html: string): string[] {
  const body = html.split(/id="?comments/i)[0];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const m of body.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = strip(m[1]);
    if (text.length < 110 || text.length > 1400) continue;
    if (text.startsWith("{") || text.includes('"@context"')) continue;
    // Their own cross-links read as sentences but are just a list of other songs.
    if (/^(more songs|songfacts|browse|artistfacts)/i.test(text)) continue;
    const key = text.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === 12) break;
  }
  return out;
}

const cache = new Map<string, { at: number; value: string[] }>();
const TTL_MS = 12 * 60 * 60_000;

export async function songfacts(title: string, artist: string): Promise<string[]> {
  const key = `${artist}|${title}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const remember = (value: string[]) => {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 60) cache.delete(cache.keys().next().value as string);
    return value;
  };

  const url = `https://www.songfacts.com/facts/${slug(artist)}/${slug(title)}`;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 7000);
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return remember([]);
    return remember(factsFrom(await res.text()));
  } catch {
    return remember([]);
  }
}

/** Written out for the model, with what it is and is not made plain. */
export function asEvidence(facts: string[]): string {
  if (facts.length === 0) return "";
  return (
    `Songfacts — a community song database, NOT an encyclopedia.\n` +
    `Entries here are submitted by readers and lightly edited. They are frequently the ` +
    `only place a particular story is written down, and they are also sometimes wrong. ` +
    `Use them: this is where the interesting, small, specific things live, and a record ` +
    `with a dull Wikipedia page often has a good Songfacts entry. But a claim that ` +
    `appears ONLY here must be attributed in the note itself — "Songfacts has it that", ` +
    `"according to Songfacts" — so the reader can weigh it. Never state one of these as ` +
    `established fact, and if Wikipedia or Genius contradicts it, they win.\n` +
    facts.map((f) => `  - ${f}`).join("\n")
  );
}
