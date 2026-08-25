import { useEffect, useRef, useState } from "react";
import type { Strings } from "./i18n";

type Line = { at: number; text: string };

/**
 * The third column on a wide window: the words, moving with the record. The panel
 * behind the "lyrics" button stays for narrow screens, where there is no room for this.
 */
export function LyricsRail({
  t,
  title,
  artist,
  album,
  durationMs,
  progressMs,
}: {
  t: Strings;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  progressMs: number;
}) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLines(null);
    let alive = true;
    const params = new URLSearchParams({ title, artist, album, duration: String(durationMs) });
    fetch(`/api/lyrics?${params}`)
      .then((r) => r.json())
      .then((d) => alive && setLines(d.synced ? d.lines : []))
      .catch(() => alive && setLines([]));
    return () => {
      alive = false;
    };
  }, [title, artist, album, durationMs]);

  const seconds = progressMs / 1000;
  const active = lines ? lines.reduce((f, l, i) => (l.at <= seconds ? i : f), -1) : -1;

  useEffect(() => {
    if (active < 0) return;
    box.current?.querySelector(`[data-l="${active}"]`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [active]);

  // Nothing filed for this track, or none of it timed — the column stays out of the way
  // rather than showing an empty frame.
  if (!lines || lines.length === 0) return null;

  return (
    <aside className="rail" aria-label={t.lyricsTitle}>
      <div className="rail-lines" ref={box}>
        {lines.map((line, i) => (
          <p
            key={i}
            data-l={i}
            dir="auto"
            className={
              i === active ? "rail-line now" : i < active ? "rail-line past" : "rail-line"
            }
          >
            {line.text || "·"}
          </p>
        ))}
      </div>
    </aside>
  );
}
