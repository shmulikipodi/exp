import { useCallback, useEffect, useRef } from "react";
import type { Strings } from "./i18n";
import { LyricLines, inView, isReading, scrollToLine, useReading, type Line } from "./LyricLines";
import { currentLine } from "./notes-logic";

/**
 * The words on their own, for when you would rather read them beside the notes than
 * through them. Same treatment either way — one line in focus, the rest softening off,
 * everything sharp the moment you scroll.
 */
export function Words({
  t,
  lines,
  translated,
  progressMs,
  onSeek,
}: {
  t: Strings;
  lines: Line[] | null;
  translated?: string[] | null;
  progressMs: number;
  onSeek: (ms: number) => void;
}) {
  const active = currentLine(lines ?? [], progressMs / 1000);

  // The settle fires from a timer well after this render, so the line it goes to has
  // to be read at the time rather than closed over here.
  const here = useRef(active);
  here.current = active;
  const centre = useCallback((onlyIfLost = false) => {
    if (here.current < 0) return;
    const box = document.querySelector(".words");
    const el = document.querySelector(`.words [data-l="${here.current}"]`);
    if (onlyIfLost && inView(box, el)) return;
    scrollToLine(box, el);
  }, []);

  const reading = useReading(() => centre(true));
  useEffect(() => {
    if (active < 0 || isReading(reading)) return;
    centre();
  }, [active, reading, centre]);

  return (
    <aside className="words">
      {lines === null && <p className="loading">{t.loading}</p>}
      {lines?.length === 0 && <p className="help">{t.lyricsNone}</p>}
      {lines && lines.length > 0 && (
        <LyricLines lines={lines} active={active} onSeek={onSeek} translated={translated} />
      )}
    </aside>
  );
}
