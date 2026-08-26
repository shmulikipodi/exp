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
  | { kind: "line"; line: LyricLine; index: number };

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

    lines.forEach((line, l) => {
      out.push({ kind: "line", line, index: l });
      for (const i of under.get(l) ?? []) out.push({ kind: "note", note: notes[i], index: i });
    });
    return out;
  }

  return notes.map((note, i) => ({ kind: "note" as const, note, index: i }));
}
