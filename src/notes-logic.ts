// The pure parts of how notes behave: when each one surfaces, and whether a stored set
// is in the language it claims to be. Extracted so they can be tested without a browser.

import type { Lang } from "./i18n";

export type TimedNote = { at: number | null };
export type LangCheckable = { headline: string; notes: { body: string }[] };

/**
 * Where each note belongs on the track.
 *
 * A note about a moment in the recording sits at that moment. Everything else — who
 * produced it, what it samples, what happened afterwards — is true of the whole record
 * and is available from the start. Spreading those through the song implied a
 * relationship to the music that was never there: a note about a lawsuit in 1994 would
 * surface two minutes in, as though something at two minutes had caused it.
 */
export function schedule(notes: TimedNote[]): number[] {
  return notes.map((n) => (n.at === null ? 0 : n.at));
}

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
