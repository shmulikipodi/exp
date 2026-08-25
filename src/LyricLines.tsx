import type { CSSProperties } from "react";

export type Line = { at: number; text: string };

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
        const d = active < 0 ? 0 : Math.min(6, Math.abs(i - active));
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
