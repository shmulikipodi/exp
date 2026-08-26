import type { ReactNode } from "react";
import type { RailMode } from "./Rail";

/**
 * The four panels, as marks rather than words. A microphone for the words being sung,
 * the queue mark every music player already uses, a person for the artist and a disc
 * for the record — so the row reads at a glance and takes no room in a language that
 * writes right to left or one that doesn't.
 */
export const RAIL_ICONS: Record<RailMode, ReactNode> = {
  lyrics: (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"
      />
    </svg>
  ),
  queue: (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M3 6h15M3 11h15M3 16h7"
      />
      <path fill="currentColor" d="M14 12.5l6 3.5-6 3.5z" />
    </svg>
  ),
  artist: (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <circle cx="12" cy="8" r="3.6" fill="currentColor" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M4.8 20a7.2 7.2 0 0 1 14.4 0"
      />
    </svg>
  ),
  album: (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" />
    </svg>
  ),
};

export const RAIL_ORDER: RailMode[] = ["lyrics", "queue", "artist", "album"];
