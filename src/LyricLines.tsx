import type { CSSProperties } from "react";

export type Line = { at: number; text: string };

/**
 * Put the line being sung a third of the way down rather than dead centre.
 * Centred means half the screen is spent on words already gone; a third leaves the
 * room where it is useful, which is under the line — the words still coming.
 */
export const FOCUS = 0.3;

export function scrollToLine(scroller: Element | null, line: Element | null) {
  if (!scroller || !line) return;
  const box = scroller.getBoundingClientRect();
  const here = line.getBoundingClientRect();
  // Centre the line on the focus point, unless the line is long enough that doing so
  // would push its first row off the top — a narrow panel wraps a lyric into three
  // rows, and the words have to be on screen before they can be in focus.
  const from = Math.max(box.height * 0.08, box.height * FOCUS - here.height / 2);
  scroller.scrollTo({
    top: scroller.scrollTop + (here.top - box.top) - from,
    behavior: "smooth",
  });
}

/**
 * The words, focused on the one being sung. Distance from that line drives both the
 * blur and the fade, so the couple of lines either side stay readable and everything
 * beyond them is atmosphere rather than text competing for the eye.
 *
 * Clicking a line jumps there — on a lyric screen the words are the timeline.
 */
export function LyricLines({
  lines,
  active,
  onSeek,
}: {
  lines: Line[];
  active: number;
  onSeek?: (ms: number) => void;
}) {
  return (
    <>
      {lines.map((line, i) => {
        // Asymmetric on purpose. What is coming matters more than what has gone, so
        // the lines below the focus stay legible further down while the ones above
        // fall away faster — the same way you read ahead of a singer, not behind.
        const from = i - active;
        const d = active < 0 ? 0 : Math.min(7, from >= 0 ? from : -from * 1.8);
        const state = active < 0 ? "" : i === active ? " now" : i < active ? " past" : "";
        return (
          <p
            key={i}
            data-l={i}
            dir="auto"
            style={{ "--d": d } as CSSProperties}
            className={`lyric-line${state}${onSeek ? " seekable" : ""}`}
            onClick={onSeek ? () => onSeek(Math.max(0, Math.round(line.at * 1000))) : undefined}
          >
            {line.text || "·"}
          </p>
        );
      })}
    </>
  );
}
