import { useCallback, useEffect, useRef } from "react";
import type { Strings } from "./i18n";
import { LyricLines, isReading, scrollToLine, useReading, type Line } from "./LyricLines";

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
  const active = lines
    ? lines.reduce((f, l, i) => (l.at <= progressMs / 1000 ? i : f), -1)
    : -1;

  // The settle fires from a timer well after this render, so the line it goes to has
  // to be read at the time rather than closed over here.
  const here = useRef(active);
  here.current = active;
  const centre = useCallback(() => {
    if (here.current < 0) return;
    scrollToLine(
      document.querySelector(".words"),
      document.querySelector(`.words [data-l="${here.current}"]`),
    );
  }, []);

  const reading = useReading(centre);
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
