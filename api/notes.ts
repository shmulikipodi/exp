// The product's opinion about what a liner note is. Edit the prompt here, not inline.

import { ground } from "./providers.js";
import { gather } from "./evidence.js";
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

/** Models fence JSON even when told not to. Dig the object out. */
function parseNotes(text: string): any {
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
    return res.end(JSON.stringify(await gather(title, artist, q.get("isrc") ?? "")));
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
    const evidence = await gather(title, artists[0], (body.isrc ?? "").trim());

    const user =
      `${facts}\n\n` +
      (recent.length
        ? `Played just before this, most recent first:\n${recent.map((r) => `- ${r}`).join("\n")}\n\n`
        : "No listening history yet this session — set thread to null.\n\n") +
      (evidence.text
        ? `EVIDENCE\n${evidence.text}\n\nEND EVIDENCE\n\n`
        : "No catalogue or encyclopedia entry was found for this recording. Be correspondingly careful.\n\n") +
      `Write the notes.`;

    // Hebrew is a rewrite, not a translation pass — the model writes in it directly.
    const system =
      body.lang === "he"
        ? `${SYSTEM}\n\nWrite every human-readable string — headline, note titles, note bodies,
and thread — in Hebrew, in the same plain, specific register. Keep the JSON keys and the
"kind" values exactly as specified, in English. Leave names of people, bands, songs,
albums, studios and labels in their original Latin script rather than transliterating
them.`
        : SYSTEM;

    const grounded = await ground(system, user, MODEL, userKeys);
    const parsed = parseNotes(grounded.text);

    const notes = (Array.isArray(parsed.notes) ? parsed.notes : [])
      .filter((n: any) => n && typeof n.body === "string" && n.body.trim())
      .map((n: any) => ({
        kind: String(n.kind ?? "origin"),
        at: typeof n.at === "number" && n.at >= 0 && n.at <= 1 ? n.at : null,
        title: String(n.title ?? "").trim(),
        body: String(n.body).trim(),
      }));

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
