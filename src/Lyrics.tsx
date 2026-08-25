import { useEffect, useState } from "react";
import type { Strings } from "./i18n";
import { Wash } from "./Wash";
import { LyricLines, scrollToLine, type Line } from "./LyricLines";
import { paletteFrom, type Swatch } from "./palette";

type Loaded = { found: boolean; synced: boolean; lines: Line[]; plain: string };

/**
 * The words, alone, filling the screen — the way a phone does it. Same treatment as
 * the panel, given the whole window: the record's colours drifting behind, one line
 * in focus, the rest out of it.
 */
export function Lyrics({
  t,
  title,
  artist,
  album,
  art,
  durationMs,
  progressMs,
  onSeek,
  onClose,
}: {
  t: Strings;
  title: string;
  artist: string;
  album: string;
  art?: string;
  durationMs: number;
  progressMs: number;
  onSeek: (ms: number) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [palette, setPalette] = useState<Swatch[]>([]);

  useEffect(() => {
    const params = new URLSearchParams({ title, artist, album, duration: String(durationMs) });
    fetch(`/api/lyrics?${params}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setFailed(true) : setState(d)))
      .catch(() => setFailed(true));
  }, [title, artist, album, durationMs]);

  useEffect(() => {
    if (!art) return setPalette([]);
    let alive = true;
    paletteFrom(art).then((p) => alive && setPalette(p));
    return () => {
      alive = false;
    };
  }, [art]);

  // Escape leaves, because a view that covers everything has to have an exit that
  // doesn't require finding a button.
  useEffect(() => {
    const bail = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", bail);
    return () => window.removeEventListener("keydown", bail);
  }, [onClose]);

  const seconds = progressMs / 1000;
  const active = state?.synced
    ? state.lines.reduce((found, line, i) => (line.at <= seconds ? i : found), -1)
    : -1;

  useEffect(() => {
    if (active < 0) return;
    scrollToLine(
      document.querySelector(".lyric-full-body"),
      document.querySelector(`.lyric-full [data-l="${active}"]`),
    );
  }, [active]);

  return (
    <div className="lyric-full" role="dialog" aria-modal="true" aria-label={t.lyricsTitle}>
      <Wash art={art} colors={palette} />

      <header className="lyric-full-head">
        <div>
          <b>{title}</b>
          <span>{artist}</span>
        </div>
        <button title={t.railExit} aria-label={t.railExit} onClick={onClose}>
          ×
        </button>
      </header>

      <div className="lyric-full-body">
        {failed && <p className="help">{t.lyricsNone}</p>}
        {!failed && !state && <p className="loading">{t.loading}</p>}
        {state && !state.found && <p className="help">{t.lyricsNone}</p>}

        {state?.found && state.synced && (
          <LyricLines lines={state.lines} active={active} onSeek={onSeek} />
        )}

        {state?.found && !state.synced && (
          <p className="lyric-line plain" dir="auto">
            {state.plain}
          </p>
        )}
      </div>

      {state?.found && (
        <p className="usage lyric-credit">
          {t.lyricsFrom}{" "}
          <a href="https://lrclib.net" target="_blank" rel="noreferrer">
            LRCLIB
          </a>
        </p>
      )}
    </div>
  );
}
