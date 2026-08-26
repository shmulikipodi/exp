// The pure parts of how the app behaves: whether a stored set of notes is in the
// language it claims to be, and where a dragged divider should put a column. Extracted
// so they can be tested without a browser.

import type { Lang } from "./i18n";

export type LangCheckable = { headline: string; notes: { body: string }[] };

/**
 * Cached notes can be in the wrong language — anything written in Hebrew before the
 * prompt was fixed was stored under the Hebrew key while being English. Reading them
 * back would keep serving that mistake forever, so the cache is checked, not trusted.
 *
 * Every note has to pass. A set that is half Hebrew and half English is exactly the
 * thing that kept surviving, because "contains Hebrew somewhere" was true of it.
 *
 * An empty set passes: a record the model had nothing to say about would otherwise fail
 * this check on every play and be regenerated forever.
 */
export function matchesLang(notes: LangCheckable, lang: Lang): boolean {
  if (lang !== "he") return true;
  const hebrew = (s: string) => /[\u0590-\u05FF]/.test(s);
  if (notes.notes.length === 0) return true;
  return (!notes.headline || hebrew(notes.headline)) && notes.notes.every((n) => hebrew(n.body));
}

// ---------------------------------------------------------------------------
// Dragging the dividers between the three columns.

export type Side = "sleeve" | "rail";
type Box = { left: number; right: number; width: number };

/** The reading column has to survive both dividers meeting in the middle. */
export const MIN_NOTES = 340;

const LIMITS: Record<Side, [number, number]> = { sleeve: [300, 760], rail: [240, 640] };

/** How far the column's edge measures from the stage edge it is attached to. */
function reach(which: Side, rtl: boolean, x: number, box: Box): number {
  const fromStart = rtl ? box.right - x : x - box.left;
  const fromEnd = rtl ? x - box.left : box.right - x;
  return which === "sleeve" ? fromStart : fromEnd;
}

/**
 * Where inside the divider the hand landed, captured once on pointer-down.
 *
 * Without it the column snaps so its edge sits exactly under the cursor the instant
 * you move — the divider jumps out from under you and you have to chase it.
 */
export function grabOffset(which: Side, rtl: boolean, x: number, box: Box, current: number) {
  return reach(which, rtl, x, box) - current;
}

/** The width that divider should be given for a pointer now at `x`. */
export function dividerWidth(
  which: Side,
  rtl: boolean,
  x: number,
  grab: number,
  box: Box,
  other: number,
): number {
  const [min, max] = LIMITS[which];
  const room = box.width - other - MIN_NOTES;
  return Math.round(Math.min(max, Math.max(min, Math.min(reach(which, rtl, x, box) - grab, room))));
}

// ---------------------------------------------------------------------------
// The words and what there is to say about them, as one column.

export type Placeable = { at: number | null };
export type LyricLine = { at: number; text: string };

export type Woven<N> =
  | { kind: "note"; note: N; index: number }
  | { kind: "line"; line: LyricLine; index: number }
  | { kind: "section"; label: Section["label"]; at: number };

/**
 * Put every note against the line it is about.
 *
 * A note carries a position in the recording and a lyric line carries a time, so the
 * two can be married without asking anyone: a note belongs to the last line that had
 * started when the thing it describes happened. Notes that name no moment go first —
 * what the record is, before the record starts.
 *
 * With no synced words this returns the notes in their own order, which is the column
 * exactly as it was.
 */
export function weave<N extends Placeable>(
  notes: N[],
  lines: LyricLine[],
  durationMs: number,
  sections: Section[] = [],
): Woven<N>[] {
  const out: Woven<N>[] = [];
  const placed = new Set<number>();

  if (lines.length > 0 && durationMs > 0) {
    // Which line each note sits under. A note at 0:00 of a song whose first line is
    // sung at 0:26 belongs above the words, not jammed under the last one.
    const seconds = (n: N) => (n.at === null ? -1 : n.at * (durationMs / 1000));
    const under = new Map<number, number[]>();
    notes.forEach((note, i) => {
      const at = seconds(note);
      if (at < 0) return;
      let line = -1;
      for (let l = 0; l < lines.length; l++) {
        if (lines[l].at <= at) line = l;
        else break;
      }
      if (line < 0) return; // before the first word: it belongs with the loose notes
      placed.add(i);
      const here = under.get(line) ?? [];
      here.push(i);
      under.set(line, here);
    });

    notes.forEach((note, i) => {
      if (!placed.has(i)) out.push({ kind: "note", note, index: i });
    });

    // A heading wherever the record changes gear. Placed before the first line of the
    // section, so reading down the column tells you what part of the song you are in.
    const heads = new Map<number, Section["label"]>();
    for (const part of sections) {
      if (part.label === "instrumental" || part.label === "intro" || part.label === "outro") {
        continue; // nobody is singing there, so there is no line to head
      }
      const first = lines.findIndex((l) => l.at >= part.at - 0.5);
      if (first >= 0 && !heads.has(first)) heads.set(first, part.label);
    }

    lines.forEach((line, l) => {
      const head = heads.get(l);
      if (head) out.push({ kind: "section", label: head, at: line.at });
      out.push({ kind: "line", line, index: l });
      for (const i of under.get(l) ?? []) out.push({ kind: "note", note: notes[i], index: i });
    });
    return out;
  }

  return notes.map((note, i) => ({ kind: "note" as const, note, index: i }));
}

// ---------------------------------------------------------------------------
// The shape of a record, worked out from the words.

export type Section = { label: "intro" | "verse" | "chorus" | "instrumental" | "outro"; at: number; to: number };

/** A silence this long between sung lines ends one block of words and starts another. */
const BREAK = 7;
/** A silence this long is a passage in its own right — an intro, a solo, an outro.
 *  Between a verse and a chorus there is often ten seconds of nobody singing, and
 *  calling that a solo would put a lie in the middle of the map. */
const PASSAGE = 13;

const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Where the verses are, which lines are the chorus, and where nobody is singing.
 *
 * Synced lyrics already contain the structure of a record; nobody just reads it out.
 * Lines that come in a run are a block, a long silence between blocks is a passage
 * with no words in it — the intro, a solo, the outro — and a block whose words turn up
 * again later is the chorus, because that is what a chorus is.
 *
 * No model, no extra request, and it works on any song anyone has bothered to sync.
 */
export function shape(lines: LyricLine[], durationMs: number): Section[] {
  const seconds = durationMs / 1000;
  if (lines.length < 2 || seconds <= 0) return [];

  // Runs of lines with no long silence inside them.
  const blocks: { from: number; to: number; text: string }[] = [];
  let start = 0;
  for (let i = 1; i <= lines.length; i++) {
    const broke = i === lines.length || lines[i].at - lines[i - 1].at > BREAK;
    if (!broke) continue;
    const words = lines.slice(start, i).map((l) => bare(l.text)).filter(Boolean);
    if (words.length > 0) {
      blocks.push({ from: lines[start].at, to: lines[i - 1].at, text: words.join(" | ") });
    }
    start = i;
  }
  if (blocks.length === 0) return [];

  // A block whose words appear more than once is the chorus. Compared whole rather
  // than line by line: a single repeated line is a refrain, not a section.
  const seen = new Map<string, number>();
  for (const b of blocks) seen.set(b.text, (seen.get(b.text) ?? 0) + 1);

  const out: Section[] = [];
  const add = (label: Section["label"], at: number, to: number) => {
    if (to - at < 1.5) return; // too short to be a place you would ever go
    out.push({ label, at, to });
  };

  if (blocks[0].from > PASSAGE) add("intro", 0, blocks[0].from);

  blocks.forEach((b, i) => {
    add((seen.get(b.text) ?? 0) > 1 ? "chorus" : "verse", b.from, b.to);
    const next = blocks[i + 1];
    if (next && next.from - b.to > PASSAGE) add("instrumental", b.to, next.from);
  });

  const last = blocks[blocks.length - 1];
  if (seconds - last.to > PASSAGE) add("outro", last.to, seconds);

  return out;
}
