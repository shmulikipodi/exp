import { useEffect, useState } from "react";
import type { Line } from "./LyricLines";

/**
 * The words, synced where anyone has bothered to sync them.
 *
 * Lifted out of the panel that used to own them: the words are no longer a thing you
 * open on the side, they are the column the notes are written against.
 */
export function useLyrics(title: string, artist: string, album: string, durationMs: number) {
  const [lines, setLines] = useState<Line[] | null>(null);

  useEffect(() => {
    if (!title || !artist) return;
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

  return lines;
}
