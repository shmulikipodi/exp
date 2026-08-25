// The product's opinion about what a liner note is. Edit the prompt here, not inline.

import { ground, lastFallbackReason } from "./providers.js";
import { gather, gatherAlbum, gatherArtist } from "./evidence.js";
import { keyPool, poolStatus } from "./keys.js";
import { fetchLyrics } from "./lyrics.js";
import { findEpisode, findMentions } from "./podcast.js";

const MODEL = "gemini-3.6-flash";

const SYSTEM = `You write liner notes — the kind that came folded inside a record sleeve,
written by someone who was there, for someone who is listening right now.

You are NOT writing an encyclopedia entry. Hard rules:

- WOULD SOMEONE REPEAT THIS TO A FRIEND? That is the test, and almost nothing else is.
  A note that passes it earns its place; a note that is merely true and verifiable does
  not. "Halfway through, a piccolo was lost in the mastering" is accurate, sourced, and
  nobody has ever cared. Cut it.

What earns a note, in roughly this order:

  1. THE THING THIS RECORD IS KNOWN FOR. If there is a famous story attached — a
     lawsuit, an accusation, a myth, a feud, a death, a refusal, a banning, a rumour
     people still argue about — it goes first, whether or not the rumour is true. Say
     what was claimed and what is actually established. Someone playing Stairway to
     Heaven wants the backwards-message trial; someone playing Bitter Sweet Symphony
     wants the royalties. Skipping past that to a mixing detail is a failure, not
     restraint.
  2. SOMETHING THAT CHANGES HOW THE SONG SOUNDS NEXT TIME. A part that is not what it
     appears to be, a sound made by an object nobody would guess, a voice that belongs
     to someone else, a mistake left in.
  3. WHAT NEARLY HAPPENED INSTEAD. The version that was scrapped, the singer who turned
     it down, the accident that made it, the label that refused it.
  4. WHO WAS ACTUALLY THERE, when it is genuinely surprising — an uncredited player, a
     famous name in a small role.
  5. WHAT THE SONG IS ABOUT, when it is documented and not obvious from the words.

What does not earn a note, however well sourced:

  - Routine credits. Who mixed it, where it was mastered, which studio, unless something
    turned on it. That is a database row, and the reader can see the label already.
  - Technical detail with no consequence. Which microphone, which desk, which take
    number — unless the record sounds the way it does because of it.
  - Chart positions, certifications and sales, unless something happened as a result.
  - Anything of the form "it was well received" or "it remains a fan favourite".

- Every note must contain something the listener could not have guessed from the title
  and artist alone. A note that says the song is beloved, influential, iconic, a classic,
  a fan favourite, or a standout track is worthless. Delete it.
- Be specific and checkable. Names, years, rooms, instruments, takes, money, arguments.
  "Recorded quickly" is nothing. "Cut in two takes at Muscle Shoals on a Sunday because
  the studio was booked Monday" is a liner note. But specificity is the standard a good
  note has to meet, not the reason it is good — a precise fact about nothing is still
  about nothing.
- Never pad. Three notes worth repeating beat six that are merely accurate. If this
  recording genuinely has no story, write the two or three real things and stop.
- If you don't actually know this song — covers, remasters and same-titled songs are easy
  to confuse — return few notes and set confidence "low". Saying less is always allowed.
  Inventing a producer, a sample or a session player is the one unforgivable failure.
- A famous rumour is worth reporting even when it is false, provided you say so. "Fans
  have claimed X since 1982; the band denied it and the court found no evidence" is a
  good note. Repeating the rumour as fact is not.
- No second person. Don't tell the listener how to feel or what to notice emotionally.
- You may be given EVIDENCE. The MusicBrainz part is a catalogue: structured credits,
  dates and labels, and the most reliable thing you will see — but silent on anything
  that is not a credit. The Wikipedia part is prose: broader, usually cited, and worth
  more scepticism on a surprising claim than on a plain fact. Treat the two accordingly. Where it contradicts your own
  memory, the evidence wins. A credit list is raw material, not a note — "Producer: X" is
  only worth writing up if you can say something about what X did here.
- Check the evidence names the same recording you were asked about. Catalogue matches go
  wrong on covers and re-recordings; if the credits look like a different version, say so
  in a note and set confidence "low".
- No second person. Don't tell the listener how to feel or what to notice emotionally.
- Wrap anything a reader might want to look up in double square brackets: [[Eddie Hazel]],
  [[United Sound Systems]], [[Echoplex]], [[Westbound Records]], [[Muscle Shoals]].
  People, studios, instruments and equipment, labels, places, bands, songs and albums.
  Two of those get a prefix, because the reader can act on them: a musician or band is
  [[artist:Eddie Hazel]], and another song is [[song:Maggot Brain]]. Everything else
  stays unprefixed. Do not prefix the song being written about or its own artist.
  When a name is ambiguous on Wikipedia, give the article title after a pipe so the link
  lands on the right one: [[artist:George Clinton|George Clinton (musician)]] — plain
  "George Clinton" is the American Founding Father. The reader sees the part before the
  pipe. Do this for anyone whose name is shared with someone better known.
  Wrap the name only — "[[Eddie Hazel]]'s guitar", never "[[Eddie Hazel's guitar]]" — and
  write the name as it would be titled, not as a description. Do not wrap ordinary words,
  and do not put a link in the note's title.

Note kinds, pick whichever the evidence actually supports:
  origin     — where the song came from: the demo, the commission, the argument, the debt
  room       — what happened at the recording: who was there, what broke, what was improvised
  personnel  — who actually played, wrote, engineered or produced, especially uncredited
  sample     — what it samples, interpolates, quotes, or what later sampled it. The
               evidence may list related recordings outright; those are the good ones
  version    — the listener is on an edit, remaster or live take rather than the
               original, and something about it differs
  lyric      — what a specific line actually refers to, when that is documented and not
               guessed. If the lyrics are given below, quote the line you mean
  moment     — a thing audible at a specific point in the recording
  afterlife  — what happened to it after release: lawsuits, chart facts, covers, reuse

"at" places a note at a moment in the recording. Give it as a timestamp inside the
track's length — "2:07" — never a fraction or a percentage.

- Set it ONLY when the note is about something audible at a particular point: a solo
  starting, an instrument entering, a key change, a sound you can point at. Everything
  else — who produced it, where it was cut, what it samples, what happened afterwards —
  takes "at": null and is shown from the start.
- If the evidence states a time, use that time. It is the only sort you can be sure of.
- Otherwise place it from the structure of the song and the track's length, and say so.
- If you cannot place it within about ten seconds, set "at" to null. A dot in the wrong
  place is worse than no dot: the reader sits waiting for something that never comes.
- "atBasis" is "documented" when the time came from the evidence, "estimated" when you
  worked it out yourself.

Return ONLY a JSON object, no markdown fence:
{
  "headline": "one sentence naming what this record actually is, the way someone who knows it would say it to a friend. Not a summary. Not praise.",
  "notes": [{ "kind": "origin", "at": null, "atBasis": null, "title": "four to seven words", "body": "one to three sentences" }],
  "thread": "one sentence connecting this song to the listed recent tracks — a shared producer, player, sample, city, year, label or lineage. Only if a real connection exists. Otherwise null.",
  "confidence": "high" | "low"
}`;

type Body = {
  mode?: "notes" | "more" | "ask" | "artist" | "album";
  have?: { title: string; body: string }[];
  rejected?: string[];
  question?: string;
  artist?: string;
  about?: { title: string; body: string } | null;
  title?: string;
  artists?: string[];
  album?: string;
  released?: string;
  durationMs?: number;
  label?: string;
  genres?: string[];
  copyrights?: string[];
  recent?: string[];
  lang?: string;
  isrc?: string;
  wide?: boolean;
  keys?: string[];
  check?: boolean;
};

/** Key health, without spending generation quota: the model-list endpoint is free. */
async function describePool(extra: string[]) {
  const keys = keyPool("GEMINI", extra);
  const cooldowns = poolStatus("GEMINI", extra);
  const slots = await Promise.all(
    keys.map(async (k, i) => {
      const state = cooldowns[i];
      try {
        const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
          headers: { "x-goog-api-key": k },
        });
        return { ...state, valid: r.ok, status: r.status };
      } catch {
        return { ...state, valid: false, status: 0 };
      }
    }),
  );
  const groq = keyPool("GROQ");
  const groqSlots = await Promise.all(
    groq.map(async (k) => {
      try {
        const r = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { authorization: `Bearer ${k}` },
        });
        const body: any = r.ok ? await r.json() : null;
        const models = (body?.data ?? [])
          .map((m: any) => m.id)
          .filter((id: string) => /compound|llama|kimi|qwen|gpt/i.test(id))
          .slice(0, 8);
        return { key: `…${k.slice(-4)}`, valid: r.ok, status: r.status, models };
      } catch {
        return { key: `…${k.slice(-4)}`, valid: false, status: 0, models: [] };
      }
    }),
  );

  return { keys: keys.length, slots, groqKeys: groq.length, groq: groqSlots };
}

function readJson(req: any): Promise<Body> {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/** For answers, prose is a usable result — better than throwing away a good sentence
 *  because it arrived without braces around it. */
export function parseAnswer(text: string): string {
  try {
    const parsed = parseNotes(text);
    const answer = String(parsed?.answer ?? "").trim();
    if (answer) return answer;
  } catch {
    /* not JSON — the raw text is the answer */
  }
  return text.replace(/```(?:json)?|```/g, "").trim();
}

/**
 * A timestamp becomes a position in the track. Anything that isn't a real time inside
 * the song is dropped to null rather than guessed at — the note still shows, just from
 * the start, which is the honest place for a moment nobody can locate.
 */
export function toFraction(at: unknown, durationMs: number): number | null {
  // Older stored notes used a raw fraction.
  if (typeof at === "number") return at >= 0 && at <= 1 ? at : null;
  if (typeof at !== "string" || !durationMs) return null;

  const m = at.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;

  const ms = (Number(m[1]) * 60 + Number(m[2])) * 1000;
  if (ms < 0 || ms > durationMs) return null;
  return ms / durationMs;
}

const LINK = /\[\[(?:(artist|song):)?([^\]|]{2,60})(?:\|([^\]]{2,80}))?\]\]/g;

/**
 * Resolves the [[marked]] names to real Wikipedia articles in one request, rather than
 * letting the model write URLs — it will happily invent a plausible one. Anything with
 * no article falls back to a search, which cannot 404.
 */
async function resolveLinks(texts: string[], lang = "en"): Promise<Record<string, string>> {
  const terms = new Set<string>();
  for (const text of texts) {
    // The lookup title when one is given, the visible name otherwise. Stored under the
    // visible name, which is what the reader's copy carries.
    for (const m of String(text ?? "").matchAll(LINK)) {
      terms.add(`${m[2].trim()}\u0000${(m[3] ?? m[2]).trim()}`);
    }
  }
  if (terms.size === 0) return {};

  const pairs = [...terms].slice(0, 40).map((t) => {
    const [shown, lookup] = t.split("\u0000");
    return { shown, lookup };
  });
  const byLookup = new Map(pairs.map((p) => [p.lookup, p.shown]));
  const wanted = pairs.map((p) => p.lookup);
  const search = (t: string) =>
    `https://${lang}.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(t)}`;
  const links: Record<string, string> = Object.fromEntries(
    pairs.map((p) => [p.shown, search(p.lookup)]),
  );

  /** Resolves as many of `names` as one edition has articles for. */
  const resolveIn = async (edition: string, names: string[]): Promise<string[]> => {
    const missed: string[] = [];
    try {
      const url =
        `https://${edition}.wikipedia.org/w/api.php?action=query&redirects=1&format=json&origin=*&titles=` +
        encodeURIComponent(names.join("|"));
      const res = await fetch(url, { headers: { "user-agent": "exp/1.0 ( https://github.com/ )" } });
      if (!res.ok) return names;
      const data: any = await res.json();

      // Wikipedia normalises and redirects on the way; both have to be followed back to
      // the term the model actually wrote.
      const trace = new Map<string, string>();
      for (const n of data?.query?.normalized ?? []) trace.set(n.to, n.from);
      for (const r of data?.query?.redirects ?? []) trace.set(r.to, trace.get(r.from) ?? r.from);

      for (const page of Object.values<any>(data?.query?.pages ?? {})) {
        const original = trace.get(page.title) ?? page.title;
        if (page.missing !== undefined || !page.title) {
          if (original) missed.push(original);
          continue;
        }
        links[byLookup.get(original) ?? original] =
          `https://${edition}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`;
      }
    } catch {
      return names;
    }
    return missed;
  };

  // The reader's own Wikipedia first — a Hebrew note pointing at an English article is
  // a dead end for the person reading it. Anything it has no article for falls back to
  // English, which usually does.
  const missing = await resolveIn(lang, wanted);
  if (lang === "en" || !missing.length) return links;

  await resolveIn("en", missing);

  // Names are written in Latin script even inside a Hebrew note, so "Eddie Hazel" finds
  // nothing on he.wikipedia — the article there is titled in Hebrew. Wikipedia knows the
  // pairing, so ask it: the English article's language link is the Hebrew one.
  const viaEnglish = missing.filter((t) =>
    links[byLookup.get(t) ?? t]?.includes("en.wikipedia.org/wiki/"),
  );
  if (!viaEnglish.length) return links;

  try {
    const url =
      `https://en.wikipedia.org/w/api.php?action=query&redirects=1&format=json&origin=*` +
      `&prop=langlinks&lllang=${encodeURIComponent(lang)}&lllimit=500&titles=` +
      encodeURIComponent(viaEnglish.join("|"));
    const res = await fetch(url, { headers: { "user-agent": "exp/1.0 ( https://github.com/ )" } });
    if (!res.ok) return links;
    const data: any = await res.json();

    const trace = new Map<string, string>();
    for (const n of data?.query?.normalized ?? []) trace.set(n.to, n.from);
    for (const r of data?.query?.redirects ?? []) trace.set(r.to, trace.get(r.from) ?? r.from);

    for (const page of Object.values<any>(data?.query?.pages ?? {})) {
      const translated = page?.langlinks?.[0]?.["*"];
      if (!translated) continue;
      const original = trace.get(page.title) ?? page.title;
      const shown = byLookup.get(original) ?? original;
      if (!links[shown]) continue;
      links[shown] = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(
        String(translated).replace(/ /g, "_"),
      )}`;
    }
  } catch {
    // The English links already work; this only makes them better.
  }

  return links;
}

/** Models fence JSON even when told not to. Dig the object out. */
export function parseNotes(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("Model did not return JSON");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

const ARTIST_SYSTEM = `You are introducing a musician or band to someone who is
listening to one of their records right now and wants to know who they are.

Cover, in four to six sentences: when and where they formed, the line-up that matters
and who does what, what they actually sound like, and what they did that made them worth
knowing. Names, years, places, labels. Concrete over interpretive.

- Do NOT describe the individual song that happens to be playing. That is not the
  question. A sentence about one track is a failure.
- No praise words. Influential, legendary, iconic, seminal and beloved are all banned.
- If the evidence is thin and you are not confident, say so in a sentence rather than
  inventing a history.

Return ONLY a JSON object, no markdown fence: { "answer": "..." }`;

const ALBUM_SYSTEM = `You are describing an album to someone playing a track from it.

Cover, in four to six sentences: when and where it was recorded, who produced and
engineered it, what the band was doing at that point, how it was received and what it
did commercially, and where it sits in their catalogue. Names, years, studios, labels,
numbers.

- Do NOT describe the individual song that happens to be playing, beyond noting where it
  sits on the record. The album is the subject.
- No praise words. Influential, legendary, iconic, seminal and beloved are all banned.
- If the evidence is thin, say so rather than inventing.

Return ONLY a JSON object, no markdown fence: { "answer": "..." }`;

const ASK_SYSTEM = `You are answering a question about a specific recording, for someone
listening to it right now. You have the same evidence the liner notes were written from.

- Answer in two to four sentences. No preamble, no restating the question.
- Specific and checkable beats general and safe. Names, years, rooms, numbers.
- The evidence is a floor, not a ceiling. It is a catalogue entry and a few encyclopedia
  articles: it will not cover most open questions. If you know the answer anyway, give
  it — but mark the part that is not in the evidence, in the sentence itself, with a
  short phrase like "not in the sources, but" or "from outside the evidence". The reader
  can then weigh it. Refusing to answer something you actually know is its own failure.
- What you must never do is present something uncertain as documented, or invent a name,
  a date or a studio. "That isn't recorded anywhere I can see" is a good answer.
- Do not praise the record or tell the listener how to feel about it.

Return ONLY a JSON object, no markdown fence: { "answer": "..." }`;

// This goes at the TOP of the prompt, not the bottom. All the evidence is in English,
// which pulls hard towards answering in English — a language rule tacked on after four
// hundred words of instructions gets dropped, especially by the lighter models.
const HEBREW_HEADER = `WRITE IN HEBREW.

Every human-readable string you produce — headline, note titles, note bodies, thread,
answers — must be written in Hebrew, in a plain and specific register. JSON keys and the
"kind" values stay in English. Names of people, bands, songs, albums, studios and labels
stay in their original Latin script; do not transliterate them.

The evidence below is in English. That is not a reason to answer in English.

`;

/** Did the model actually do it? Cheap, and the only way to know. */
export function looksHebrew(text: string): boolean {
  return /[\u0590-\u05FF]/.test(text);
}

/** Every note, not just some. The model happily writes half a set in Hebrew and the
 *  rest in English, and "contains Hebrew somewhere" waves that straight through. */
export function allHebrew(parsed: any): boolean {
  if (!looksHebrew(String(parsed?.headline ?? ""))) return false;
  const notes = Array.isArray(parsed?.notes) ? parsed.notes : [];
  return notes.every((n: any) => looksHebrew(String(n?.body ?? "")));
}

export default async function handler(req: any, res: any) {
  res.setHeader("content-type", "application/json");

  // GET /api/notes?title=…&artist=… returns the raw evidence, for debugging the
  // sources without burning a model call.
  if (req.method === "GET") {
    const q = new URL(req.url, "http://x").searchParams;
    const title = q.get("title") ?? "";
    const artist = q.get("artist") ?? "";
    // No song asked for? Report on the key pool instead. Validity is checked against
    // the model-list endpoint, which costs no generation quota.
    if (!title || !artist) {
      return res.end(JSON.stringify(await describePool([])));
    }
    return res.end(
        JSON.stringify(
          await gather(
            title,
            artist,
            q.get("isrc") ?? "",
            q.get("album") ?? "",
            Number(q.get("duration") ?? 0),
            q.get("lang") ?? "en",
          ),
        ),
      );
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "POST only" }));
  }

  try {
    const body = await readJson(req);
    const userKeys = (body.keys ?? []).map((k) => String(k).trim()).filter(Boolean);

    if (body.check) {
      return res.end(JSON.stringify(await describePool(userKeys)));
    }

    const title = (body.title ?? "").trim();
    const artists = (body.artists ?? []).filter(Boolean);
    if (!title || artists.length === 0) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "title and artists required" }));
    }

    const facts = [
      `Song: ${title}`,
      `Artist: ${artists.join(", ")}`,
      body.album ? `Album: ${body.album}` : "",
      body.released ? `Released: ${body.released}` : "",
      body.durationMs
        ? `Length: ${Math.floor(body.durationMs / 60000)}:${String(
            Math.floor((body.durationMs % 60000) / 1000),
          ).padStart(2, "0")} — any timestamp must fall inside this.`
        : "",
      body.label ? `Label: ${body.label}` : "",
      (body.genres ?? []).length ? `Genres Spotify files the artist under: ${(body.genres ?? []).join(", ")}` : "",
      (body.copyrights ?? []).length
        ? `Copyright line on the release: ${(body.copyrights ?? []).join(" / ")}. The ℗ ` +
          `year and owner describe the master. If either disagrees with the original ` +
          `release, this pressing is a reissue and whoever is named bought or inherited it.`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const recent = (body.recent ?? []).filter(Boolean);
    // Artist and album are their own subjects, with their own evidence. Handing the
    // model the song's evidence and asking about the band is why it answered about the
    // song — everything in front of it was about one recording.
    if (body.mode === "artist" || body.mode === "album") {
      const isArtist = body.mode === "artist";
      const who = (body.artist ?? artists[0]).trim();
      const subject = await (isArtist ? gatherArtist(who) : gatherAlbum(body.album ?? "", who));

      const base = isArtist ? ARTIST_SYSTEM : ALBUM_SYSTEM;
      const sys = body.lang === "he" ? `${HEBREW_HEADER}${base}` : base;
      const ask =
        (isArtist ? `Artist: ${who}` : `Album: ${body.album}\nArtist: ${who}`) +
        `\n\n` +
        (subject.text
          ? `EVIDENCE\n${subject.text}\n\nEND EVIDENCE\n\n`
          : "No catalogue or encyclopedia entry was found. Be correspondingly careful.\n\n") +
        (isArtist
          ? `Write the introduction to ${who}.`
          : `Write the description of ${body.album}.`);

      let out = await ground(sys, ask, MODEL, userKeys);
      let answerText = parseAnswer(out.text);

      if (body.lang === "he" && !looksHebrew(answerText)) {
        out = await ground(
          sys,
          `${ask}\n\nYour previous attempt was in English. That was wrong. Write it in Hebrew.`,
          MODEL,
          userKeys,
        );
        answerText = parseAnswer(out.text);
      }

      return res.end(
        JSON.stringify({
          answer: answerText,
          sources: [...subject.sources, ...out.urls].slice(0, 6),
        }),
      );
    }

    const evidence = await gather(
      title,
      artists[0],
      (body.isrc ?? "").trim(),
      body.album ?? "",
      body.durationMs ?? 0,
      body.lang ?? "en",
    );
    const hebrew = body.lang === "he";

    // Synced lyrics are the only timing in the whole pipeline that is actually
    // measured. A note about a line can take that line's real timestamp instead of the
    // model's estimate, which is the difference between a dot you can trust and a dot
    // you sit waiting at.
    // Both are optional extras and neither blocks the other.
    const [lyrics, episode, mentions] = await Promise.all([
      fetchLyrics(title, artists[0], body.album ?? "", body.durationMs ?? 0),
      findEpisode(title, artists[0]).catch(() => null),
      findMentions(title, artists[0]).catch(() => []),
    ]);
    const podcastBlock = episode
      ? `THE ARTIST ON THIS SONG\nSong Exploder made an episode about this exact track: ` +
        `"${episode.title}". The show is the musician taking their own song apart, so ` +
        `anything here is first-hand — better than a catalogue on intent and process, ` +
        `though people misremember their own sessions. Say when something comes from it.\n` +
        `${episode.summary}\n\nEND\n\n`
      : "";

    const mentionBlock = mentions.length
      ? `SHOWS THAT COVERED THIS TRACK\nThese are episode summaries, not transcripts — a ` +
        `description of what was discussed rather than what was said. Treat them as a ` +
        `pointer to what is known about the recording, name the show when you use one, ` +
        `and do not put words in anyone's mouth on this basis alone.\n` +
        mentions.map((m) => `- ${m.show}: "${m.title}"\n  ${m.summary}`).join("\n") +
        `\n\nEND\n\n`
      : "";

    const lyricBlock = lyrics.found
      ? lyrics.synced
        ? `LYRICS, with the time each line is sung. When a note is about a line, or about ` +
          `something that happens as a line is sung, use that line's timestamp and set ` +
          `atBasis to "documented" — these times are measured, not guessed.\n` +
          lyrics.lines
            .map(
              (l) =>
                `[${Math.floor(l.at / 60)}:${String(Math.floor(l.at % 60)).padStart(2, "0")}] ${l.text}`,
            )
            .join("\n") +
          `\n\nEND LYRICS\n\n`
        : `LYRICS (no timings available)\n${lyrics.plain.slice(0, 3000)}\n\nEND LYRICS\n\n`
      : "";
    const evidenceBlock = evidence.text
      ? `EVIDENCE\n${evidence.text}\n\nEND EVIDENCE\n\n`
      : "No catalogue or encyclopedia entry was found for this recording. Be correspondingly careful.\n\n";

    // A question about the record, or about one note in it.
    if (body.mode === "ask") {
      const question = (body.question ?? "").trim();
      if (!question) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: "question required" }));
      }
      // An open question about a record is rarely answerable from the track's own
      // catalogue row. The artist and the album are cheap to add — both are cached per
      // track — and they are where most questions actually live.
      const [artistEv, albumEv] = await Promise.all([
        gatherArtist(artists[0]).catch(() => ({ text: "", sources: [] as [string, string][] })),
        body.album
          ? gatherAlbum(body.album, artists[0]).catch(() => ({
              text: "",
              sources: [] as [string, string][],
            }))
          : Promise.resolve({ text: "", sources: [] as [string, string][] }),
      ]);

      const wide =
        evidenceBlock +
        (artistEv.text ? `EVIDENCE ABOUT THE ARTIST\n${artistEv.text}\n\nEND\n\n` : "") +
        (albumEv.text ? `EVIDENCE ABOUT THE ALBUM\n${albumEv.text}\n\nEND\n\n` : "");

      const asked =
        `${facts}\n\n${wide}${podcastBlock}${mentionBlock}${lyricBlock}` +
        (body.about
          ? `The reader is asking about this note:\n"${body.about.title}" — ${body.about.body}\n\n`
          : "") +
        `Question: ${question}`;

      const askSystem = hebrew ? `${HEBREW_HEADER}${ASK_SYSTEM}` : ASK_SYSTEM;
      let answered = await ground(askSystem, asked, MODEL, userKeys);
      let answerText = parseAnswer(answered.text);

      if (hebrew && !looksHebrew(answerText)) {
        answered = await ground(
          askSystem,
          `${asked}\n\nYour previous attempt was written in English. That was wrong. Answer in Hebrew.`,
          MODEL,
          userKeys,
        );
        answerText = parseAnswer(answered.text);
      }

      return res.end(
        JSON.stringify({
          answer: answerText,
          sources: [
            ...evidence.sources,
            ...artistEv.sources,
            ...albumEv.sources,
            ...answered.urls,
          ].slice(0, 8),
        }),
      );
    }

    // "Wide" pulls the artist and the album in alongside the track's own evidence. It
    // is a setting rather than the default because it is slower and most notes are
    // about the recording, where the extra material is just noise to read past.
    let wideBlock = "";
    if (body.wide) {
      const [artistEv, albumEv] = await Promise.all([
        gatherArtist(artists[0]).catch(() => ({ text: "", sources: [] as [string, string][] })),
        body.album
          ? gatherAlbum(body.album, artists[0]).catch(() => ({
              text: "",
              sources: [] as [string, string][],
            }))
          : Promise.resolve({ text: "", sources: [] as [string, string][] }),
      ]);
      wideBlock =
        (artistEv.text ? `EVIDENCE ABOUT THE ARTIST\n${artistEv.text}\n\nEND\n\n` : "") +
        (albumEv.text ? `EVIDENCE ABOUT THE ALBUM\n${albumEv.text}\n\nEND\n\n` : "");
      evidence.sources = [...evidence.sources, ...artistEv.sources, ...albumEv.sources].slice(0, 8);
    }

    const already = (body.have ?? []).filter((n) => n?.title);
    const rejected = (body.rejected ?? []).filter(Boolean);

    const user =
      `${facts}\n\n` +
      (recent.length
        ? `Played just before this, most recent first:\n${recent.map((r) => `- ${r}`).join("\n")}\n\n`
        : "No listening history yet this session — set thread to null.\n\n") +
      evidenceBlock +
      podcastBlock +
      mentionBlock +
      lyricBlock +
      wideBlock +
      (rejected.length
        ? `The reader marked these earlier notes as WRONG. Do not repeat them, and do not ` +
          `write anything that depends on them being true:\n${rejected.map((r) => `- ${r}`).join("\n")}\n\n`
        : "") +
      (body.mode === "more"
        ? `These notes have already been written. Write THREE MORE on ground they do not ` +
          `cover — different kinds, different parts of the story. Do not restate or ` +
          `rephrase them:\n${already.map((n) => `- ${n.title}: ${n.body}`).join("\n")}\n\n` +
          `Return the same JSON shape containing only the new notes. Set headline to "" ` +
          `and thread to null. If there is genuinely nothing more worth saying about this ` +
          `recording, return an empty notes array rather than padding.`
        : `Write the notes.`);

    // Hebrew is a rewrite, not a translation pass — the model writes in it directly.
    const system = hebrew ? `${HEBREW_HEADER}${SYSTEM}` : SYSTEM;
    const askedIn = hebrew ? `${user}\n\nWrite all of it in Hebrew.` : user;

    let grounded = await ground(system, askedIn, MODEL, userKeys);
    let parsed = parseNotes(grounded.text);

    // Verify rather than hope. One retry, with the instruction made blunt.
    if (hebrew && !allHebrew(parsed)) {
      grounded = await ground(
        `${HEBREW_HEADER}${SYSTEM}`,
        `${askedIn}\n\nYour previous attempt had notes written in English. That was wrong. ` +
          `EVERY note — every title and every body — must be in Hebrew, not just some of them.`,
        MODEL,
        userKeys,
      );
      parsed = parseNotes(grounded.text);
    }

    const notes = (Array.isArray(parsed.notes) ? parsed.notes : [])
      .filter((n: any) => n && typeof n.body === "string" && n.body.trim())
      // After a retry, a stray English note is dropped rather than shown. Fewer notes
      // in the right language beats a set that is half in the wrong one.
      .filter((n: any) => !hebrew || looksHebrew(String(n.body)))
      .map((n: any) => {
        const at = toFraction(n.at, body.durationMs ?? 0);
        return {
        kind: String(n.kind ?? "origin"),
        at,
        atBasis: at === null ? null : n.atBasis === "documented" ? "documented" : "estimated",
        title: String(n.title ?? "")
          .replace(LINK, "$2")
          .trim(),
        body: String(n.body).trim(),
        };
      });

    // Titles identify a note when it is questioned or marked wrong, so two notes may
    // not share one — deleting a duplicate would take its twin with it.
    const seen = new Set<string>();
    for (const n of notes) {
      let title = n.title;
      for (let i = 2; seen.has(title); i++) title = `${n.title} (${i})`;
      n.title = title;
      seen.add(title);
    }

    for (const m of mentions) {
      if (m.link) evidence.sources = [...evidence.sources, [m.link, `${m.show} — ${m.title}`]];
    }

    if (episode) {
      evidence.sources = [
        [episode.link, `Song Exploder — ${episode.title}`] as [string, string],
        ...evidence.sources,
      ].slice(0, 8);
    }

    const headline = typeof parsed.headline === "string" ? parsed.headline.trim() : "";
    const links = await resolveLinks(
      [headline, ...notes.map((n: any) => n.body)],
      hebrew ? "he" : "en",
    );

    res.end(
      JSON.stringify({
        headline,
        notes,
        links,
        thread:
          typeof parsed.thread === "string" && parsed.thread.trim()
            ? parsed.thread.replace(LINK, "$2").trim()
            : null,
        confidence: parsed.confidence === "low" ? "low" : "high",
        sources: [...evidence.sources, ...grounded.urls].slice(0, 8),
        live: grounded.live,
        provider: grounded.provider,
        fellBackBecause: lastFallbackReason || undefined,
        evidence: evidence.sources.length > 0,
      }),
    );
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
