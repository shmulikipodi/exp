import { useEffect, useRef, useState } from "react";
import type { Strings } from "./i18n";

type Line = { at: number; text: string };
type Loaded = { found: boolean; synced: boolean; lines: Line[]; plain: string };

export function Lyrics({
  t,
  title,
  artist,
  album,
  durationMs,
  progressMs,
  onClose,
}: {
  t: Strings;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  progressMs: number;
  onClose: () => void;
}) {
  const [state, setState] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ title, artist, album, duration: String(durationMs) });
    fetch(`/api/lyrics?${params}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setFailed(true) : setState(d)))
      .catch(() => setFailed(true));
  }, [title, artist, album, durationMs]);

  // The line currently being sung: the last one whose timestamp has passed.
  const seconds = progressMs / 1000;
  const active = state?.synced
    ? state.lines.reduce((found, line, i) => (line.at <= seconds ? i : found), -1)
    : -1;

  useEffect(() => {
    if (active < 0) return;
    box.current?.querySelector(`[data-line="${active}"]`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [active]);

  return (
    <div className="sheet" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="panel lyrics" onClick={(e) => e.stopPropagation()}>
        <h2>{t.lyricsTitle}</h2>

        {failed && <p className="help">{t.lyricsNone}</p>}
        {!failed && !state && <p className="loading">{t.loading}</p>}
        {state && !state.found && <p className="help">{t.lyricsNone}</p>}

        {state?.found && state.synced && (
          <div className="lines" ref={box}>
            {state.lines.map((line, i) => (
              <p
                key={i}
                data-line={i}
                className={i === active ? "line now" : "line"}
                dir="auto"
              >
                {line.text || "·"}
              </p>
            ))}
          </div>
        )}

        {state?.found && !state.synced && (
          <div className="lines">
            <p className="line plain" dir="auto">
              {state.plain}
            </p>
          </div>
        )}

        {state?.found && (
          <p className="usage">
            {t.lyricsFrom}{" "}
            <a href="https://lrclib.net" target="_blank" rel="noreferrer">
              LRCLIB
            </a>
          </p>
        )}

        <div className="row">
          <button className="primary" onClick={onClose}>
            {t.keysClose}
          </button>
        </div>
      </div>
    </div>
  );
}
