#!/usr/bin/env node
/**
 * Does the app still say the things everybody knows about these records?
 *
 * A panel of songs whose stories are famous enough that a miss is not a matter of
 * taste, each with the facts a person who loves the record would certainly mention.
 * Run it after changing the prompt or the evidence pipeline and the score says whether
 * the change helped, rather than one read-through and a feeling.
 *
 *   node scripts/eval.mjs                  every song, against production
 *   node scripts/eval.mjs "Hey Jude"       one song
 *   node scripts/eval.mjs --at http://…    somewhere else
 *
 * Costs one request per song against whatever key pool the target is using.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const at = (() => {
  const i = args.indexOf("--at");
  return i >= 0 ? args[i + 1] : "https://exp-pearl.vercel.app";
})();
const only = args.filter((a) => !a.startsWith("--") && a !== at);

const panel = JSON.parse(readFileSync(join(here, "panel.json"), "utf8"));
const songs = panel.songs.filter(
  (s) => only.length === 0 || only.some((o) => s.title.toLowerCase().includes(o.toLowerCase())),
);

/** Everything the app said about a record, as one lump of lowercase text to search. */
const said = (notes) =>
  [
    notes.headline ?? "",
    notes.meaning ?? "",
    ...(notes.notes ?? []).flatMap((n) => [n.title, n.body]),
  ]
    .join("\n")
    .toLowerCase();

async function askFor(song) {
  const res = await fetch(`${at}/api/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: song.title,
      artists: song.artists,
      album: song.album,
      durationMs: song.durationMs,
      lang: "en",
      depth: "normal",
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error);
  return body;
}

const rows = [];
let hits = 0;
let total = 0;

for (const song of songs) {
  process.stdout.write(`${song.title} … `);
  let notes;
  try {
    notes = await askFor(song);
  } catch (err) {
    console.log(`FAILED — ${err.message}`);
    rows.push({ song: song.title, score: "—", missed: [String(err.message).slice(0, 40)] });
    continue;
  }

  const text = said(notes);
  const missed = [];
  for (const [fact, spellings] of Object.entries(song.wants)) {
    total++;
    if (spellings.some((s) => text.includes(s.toLowerCase()))) hits++;
    else missed.push(fact);
  }
  const want = Object.keys(song.wants).length;
  console.log(`${want - missed.length}/${want}${missed.length ? `  missing: ${missed.join(", ")}` : ""}`);
  rows.push({
    song: song.title,
    score: `${want - missed.length}/${want}`,
    missed,
    noteCount: (notes.notes ?? []).length,
    // A note nobody can source is worth knowing about even when it scores.
    unsourced: (notes.notes ?? []).filter((n) => !n.from || n.from === "memory").length,
    placed: (notes.notes ?? []).filter((n) => n.at !== null).length,
  });
}

console.log(`\n${hits}/${total} facts (${Math.round((hits / Math.max(1, total)) * 100)}%)`);
const unsourced = rows.reduce((n, r) => n + (r.unsourced ?? 0), 0);
const notes = rows.reduce((n, r) => n + (r.noteCount ?? 0), 0);
const placed = rows.reduce((n, r) => n + (r.placed ?? 0), 0);
console.log(`${notes} notes · ${placed} placed on the timeline · ${unsourced} from memory`);

mkdirSync(join(here, "../.evals"), { recursive: true });
const out = join(here, `../.evals/${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`);
writeFileSync(out, JSON.stringify({ at, hits, total, rows }, null, 2));
console.log(`\nwritten to ${out.replace(join(here, ".."), ".")}`);
