// The words in a language you read.
//
// A song you cannot understand a word of is the one this app is least use on, and the
// one it would help most. Lyrics are the ground floor of understanding a record: no
// amount of who-produced-it makes up for not knowing what the singer is saying.
//
// Translated line by line so each one can sit against the line it renders, and so the
// timings still work — a paragraph of prose would lose the sync that makes the words
// follow the music.

import { ground } from "./_lib/providers.js";

const MODEL = "gemini-3.6-flash";

const SYSTEM = `You translate song lyrics for someone listening to the song right now.

- Return ONLY a JSON array of strings, the same length as the array you are given, in
  the same order. No commentary, no markdown fence, no object around it.
- One line in, one line out. Never merge two lines, never split one, never drop one.
  An empty line stays an empty line ("").
- Translate what it says, not what it would say if it were a poem in the target
  language. This is being read beside the original by someone who wants to know what
  the singer is saying — plain and accurate beats graceful.
- Keep the register. Slang stays slang, profanity stays profanity, a threat stays a
  threat. Cleaning up a lyric is a mistranslation.
- Idioms: give the meaning, not the words. If an idiom carries something a reader would
  otherwise miss entirely, you may add a short gloss in square brackets.
- Proper nouns, brand names and place names stay as they are.
- A line already in the target language comes back unchanged.`;

export type Translated = { lines: string[]; language: string };

const cache = new Map<string, { at: number; value: string[] }>();
const TTL_MS = 24 * 60 * 60_000;

/** The model returns an array; anything else is a failure we can see rather than guess at. */
export function parseLines(text: string, expected: number): string[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error("Translation did not come back as a list");

  const parsed = JSON.parse(candidate.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("Translation did not come back as a list");

  // Length has to match or the lines stop lining up with the music, which is the whole
  // reason for translating them one at a time.
  const out = parsed.map((v) => (typeof v === "string" ? v : ""));
  if (out.length === expected) return out;
  if (out.length > expected) return out.slice(0, expected);
  return [...out, ...Array(expected - out.length).fill("")];
}

export default async function handler(req: any, res: any) {
  res.setHeader("content-type", "application/json");
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const lines: string[] = (Array.isArray(body.lines) ? body.lines : [])
      .map((l: unknown) => String(l ?? ""))
      .slice(0, 120);
    const into = String(body.into ?? "en") === "he" ? "Hebrew" : "English";
    const keys: string[] = Array.isArray(body.keys) ? body.keys : [];

    if (lines.length === 0) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "lines required" }));
    }

    const key = `${into}|${lines.join("\n")}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return res.end(JSON.stringify({ lines: hit.value, language: into }));
    }

    const asked =
      `Translate these ${lines.length} lyric lines into ${into}. Return a JSON array of ` +
      `exactly ${lines.length} strings.\n\n${JSON.stringify(lines)}`;

    const done = await ground(SYSTEM, asked, MODEL, keys);
    const out = parseLines(done.text, lines.length);

    cache.set(key, { at: Date.now(), value: out });
    if (cache.size > 40) cache.delete(cache.keys().next().value as string);
    return res.end(JSON.stringify({ lines: out, language: into }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
