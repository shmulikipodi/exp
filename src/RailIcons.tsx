import type { ReactNode } from "react";

/** The two things you can turn on: the record's own column, and the words. */
export type Mark = "tree" | "words" | "split";

export const MARK_ORDER: Mark[] = ["tree", "words", "split"];

export const MARKS: Record<Mark, ReactNode> = {
  tree: (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" />
    </svg>
  ),
  // Two columns: the words stop running through the notes and stand beside them.
  split: (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <rect x="3" y="4" width="7.5" height="16" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.5" y="4" width="7.5" height="16" rx="1.4" fill="currentColor" opacity="0.55" />
    </svg>
  ),
  words: (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M4 6h16M4 11h11M4 16h14M4 21h8"
      />
    </svg>
  ),
};
