// The product's opinion about what a liner note is. Edit the prompt here, not inline.

import { ground } from "./providers.js";
import { gather, gatherAlbum, gatherArtist } from "./evidence.js";
import { keyPool, poolStatus } from "./keys.js";

const MODEL = "gemini-3.6-flash";

const SYSTEM = `You write liner notes — the kind that came folded inside a record sleeve,
written by someone who was there, for someone who is listening right now.

You are NOT writing an encyclopedia entry. Hard rules:

- Every note must contain something the listener could not have guessed from the title
  and artist alone. A note that says the song is beloved, influential, iconic, a classic,
  a fan favourite, or a standout track is worthless. Delete it.
- Be specific and checkable. Names, years, rooms, instruments, takes, money, arguments.
  "Recorded quickly" is nothing. "Cut in two takes at Muscle Shoals on a Sunday because
  the studio was booked Monday" is a liner note.
- Prefer the concrete and physical over the interpretive. What was in the room beats what
  it all means.
- Never pad. Four real notes beat nine with five inventions among them.
- If you don't actually know this song — covers, remasters and same-titled songs are easy
  to confuse — return few notes and set confidence "low". Saying less is always allowed.
  Inventing a producer, a sample or a session player is the one unforgivable failure.
- You may be given EVIDENCE: catalogue credits and an encyclopedia article for this
  recording. Treat it as the most reliable thing you have. Where it contradicts your own
  memory, the evidence wins. A credit list is raw material, not a note — "Producer: X" is
  only worth writing up if you can say something about what X did here.
- Check the evidence names the same recording you were asked about. Catalogue matches go
  wrong on covers and re-recordings; if the credits look like a different version, say so
  in a note and set confidence "low".
- No second person. Don't tell the listener how to feel or what to notice emotionally.

Note kinds, pick whichever the evidence actually supports:
  origin     — where the song came from: the demo, the commission, the argument, the debt
  room       — what happened at the recording: who was there, what broke, what was improvised
  personnel  — who actually played, wrote, engineered or produced, especially uncredited
  sample     — what it samples, interpolates, quotes, or what later sampled it
  lyric      — what a specific line actually refers to, when that is documented and not guessed
  moment     — a thing audible at a specific point in the recording
  afterlife  — what happened to it after release: lawsuits, chart facts, covers, reuse

"at" is where in the song the note belongs, as a fraction from 0 to 1. Set it ONLY for
kind "moment" and for any note genuinely tied to a point in the recording. Otherwise null.

Return ONLY a JSON object, no markdown fence:
{
  "headline": "one sentence naming what this record actually is, the way someone who knows it would say it to a friend. Not a summary. Not praise.",
  "notes": [{ "kind": "origin", "at": null, "title": "four to seven words", "body": "one to three sentences" }],
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
  label?: string;
  genres?: string[];
  recent?: string[];
  lang?: string;
  isrc?: string;
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
  return { keys: keys.length, slots };
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
        JSON.stringify(await gather(title, artist, q.get("isrc") ?? "", q.get("album") ?? "")),
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
      body.label ? `Label: ${body.label}` : "",
      (body.genres ?? []).length ? `Genres Spotify files the artist under: ${(body.genres ?? []).join(", ")}` : "",
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

    const evidence = await gather(title, artists[0], (body.isrc ?? "").trim(), body.album ?? "");
    const hebrew = body.lang === "he";
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
        `${facts}\n\n${wide}` +
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

    const already = (body.have ?? []).filter((n) => n?.title);
    const rejected = (body.rejected ?? []).filter(Boolean);

    const user =
      `${facts}\n\n` +
      (recent.length
        ? `Played just before this, most recent first:\n${recent.map((r) => `- ${r}`).join("\n")}\n\n`
        : "No listening history yet this session — set thread to null.\n\n") +
      evidenceBlock +
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
      .map((n: any) => ({
        kind: String(n.kind ?? "origin"),
        at: typeof n.at === "number" && n.at >= 0 && n.at <= 1 ? n.at : null,
        title: String(n.title ?? "").trim(),
        body: String(n.body).trim(),
      }));

    // Titles identify a note when it is questioned or marked wrong, so two notes may
    // not share one — deleting a duplicate would take its twin with it.
    const seen = new Set<string>();
    for (const n of notes) {
      let title = n.title;
      for (let i = 2; seen.has(title); i++) title = `${n.title} (${i})`;
      n.title = title;
      seen.add(title);
    }

    res.end(
      JSON.stringify({
        headline: typeof parsed.headline === "string" ? parsed.headline.trim() : "",
        notes,
        thread: typeof parsed.thread === "string" && parsed.thread.trim() ? parsed.thread.trim() : null,
        confidence: parsed.confidence === "low" ? "low" : "high",
        sources: [...evidence.sources, ...grounded.urls].slice(0, 8),
        live: grounded.live,
        evidence: evidence.sources.length > 0,
      }),
    );
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
