import { useEffect, useState } from "react";
import type { Line } from "./LyricLines";
import { liveKeys } from "./Keys";

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

/**
 * The same words in a language you read.
 *
 * A song in a language you have none of is the record this app is least use on and
 * would help with most — knowing what the singer is saying is the floor, not a detail.
 * Asked only when you turn it on, and once per song: it is a paid call.
 */
export function useTranslation(lines: Line[] | null, into: string, on: boolean) {
  const [out, setOut] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);

  const key = lines?.length ? `${into}|${lines[0]?.text}|${lines.length}` : "";

  useEffect(() => {
    if (!on || !lines?.length) return;
    setOut(null);
    setFailed(false);
    let alive = true;
    fetch("/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lines: lines.map((l) => l.text), into, keys: liveKeys() }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (Array.isArray(d.lines)) setOut(d.lines);
        else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [on, key, into]);

  return { lines: on ? out : null, failed };
}
