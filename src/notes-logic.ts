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
