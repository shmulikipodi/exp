import { useEffect, useRef, useState } from "react";
import type { Strings } from "./i18n";
import {
  albumProfile,
  artistProfile,
  playTrack,
  queueList,
  type AlbumProfile,
  type ArtistProfile,
  type QueueItem,
} from "./spotify";

export type RailMode = "lyrics" | "queue" | "artist" | "album";

type Line = { at: number; text: string };

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The right-hand panel: the words, what is coming, who made it, what it came from.
 * One column, four things, switchable — the alternative was four buttons each opening
 * its own overlay, which is how a reading app turns into a control panel.
 */
export function Rail({
  t,
  mode,
  setMode,
  onClose,
  title,
  artist,
  album,
  albumId,
  artistId,
  trackId,
  durationMs,
  progressMs,
  lang,
  artistText,
  albumText,
  onAsk,
}: {
  t: Strings;
  mode: RailMode;
  setMode: (m: RailMode) => void;
  onClose: () => void;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  artistId: string;
  trackId: string;
  durationMs: number;
  progressMs: number;
  lang: string;
  artistText?: string;
  albumText?: string;
  onAsk: (topic: "artist" | "album") => void;
}) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [who, setWho] = useState<ArtistProfile | null>(null);
  const [record, setRecord] = useState<AlbumProfile | null>(null);
  // Spotify has to answer for the pictures and the tracklist; the prose does not need
  // it. Tracking the two separately means a panel with no Spotify behind it still shows
  // what it can rather than an empty frame.
  const [profileTried, setProfileTried] = useState(false);

  useEffect(() => {
    if (mode !== "lyrics") return;
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
  }, [mode, title, artist, album, durationMs]);

  useEffect(() => {
    if (mode !== "queue") return;
    queueList().then(setQueue).catch(() => setQueue([]));
  }, [mode, trackId]);

  useEffect(() => {
    if (mode !== "artist") return;
    setProfileTried(false);
    artistProfile(artistId)
      .then(setWho)
      .catch(() => setWho(null))
      .finally(() => setProfileTried(true));
  }, [mode, artistId]);

  useEffect(() => {
    if (mode !== "album") return;
    setProfileTried(false);
    albumProfile(albumId)
      .then(setRecord)
      .catch(() => setRecord(null))
      .finally(() => setProfileTried(true));
  }, [mode, albumId]);

  // Prose for the two panels that have any, written on demand rather than up front —
  // and asked for exactly once per track. onAsk is rebuilt on most renders, so an
  // effect that depends on it will re-fire indefinitely: a request loop against a
  // metered API, which is the worst possible shape for this bug.
  const asked = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (mode !== "artist" && mode !== "album") return;
    const already = mode === "artist" ? artistText : albumText;
    const key = `${mode}:${trackId}:${lang}`;
    if (already || asked.current.has(key)) return;
    asked.current.add(key);
    onAsk(mode);
  }, [mode, trackId, lang, artistText, albumText, onAsk]);

  const seconds = progressMs / 1000;
  const active = lines ? lines.reduce((f, l, i) => (l.at <= seconds ? i : f), -1) : -1;

  useEffect(() => {
    if (mode !== "lyrics" || active < 0) return;
    document
      .querySelector(`.rail [data-l="${active}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [mode, active]);

  const tabs: [RailMode, string][] = [
    ["lyrics", t.railLyrics],
    ["queue", t.railQueue],
    ["artist", t.railArtist],
    ["album", t.railAlbum],
  ];

  return (
    <aside className="rail" lang={lang}>
      <header className="rail-head">
        <nav>
          {tabs.map(([id, label]) => (
            <button
              key={id}
              className={mode === id ? "on" : ""}
              onClick={() => setMode(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button className="rail-x" title={t.railClose} aria-label={t.railClose} onClick={onClose}>
          ×
        </button>
      </header>

      <div className="rail-body">
        {mode === "lyrics" &&
          (lines === null ? (
            <p className="loading">{t.loading}</p>
          ) : lines.length === 0 ? (
            <p className="help">{t.lyricsNone}</p>
          ) : (
            lines.map((line, i) => (
              <p
                key={i}
                data-l={i}
                dir="auto"
                className={i === active ? "rail-line now" : i < active ? "rail-line past" : "rail-line"}
              >
                {line.text || "·"}
              </p>
            ))
          ))}

        {mode === "queue" &&
          (queue === null ? (
            <p className="loading">{t.loading}</p>
          ) : queue.length === 0 ? (
            <p className="help">{t.railEmpty}</p>
          ) : (
            <ul className="rail-list">
              {queue.map((q, i) => (
                <li key={`${q.id}-${i}`}>
                  <button onClick={() => playTrack(q.id)}>
                    {q.art && <img src={q.art} alt="" loading="lazy" />}
                    <span>
                      <b>{q.title}</b>
                      <span>{q.artists.join(", ")}</span>
                    </span>
                    <span className="dur">{mmss(q.durationMs)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}

        {mode === "artist" && (
          <>
            {who?.image && <img className="rail-hero round" src={who.image} alt="" />}
            {!who && profileTried && <h3>{artist}</h3>}
            {who && (
              <>
                <h3>{who.name}</h3>
                <p className="rail-meta">
                  {t.followers(who.followers)}
                  {who.genres.length > 0 && <span> · {who.genres.join(", ")}</span>}
                </p>
              </>
            )}
            {artistText ? <p className="rail-prose">{artistText}</p> : <p className="loading">{t.loading}</p>}
            {who && who.topTracks.length > 0 && (
              <>
                <p className="rail-section">{t.topTracks}</p>
                <ul className="rail-list">
                  {who.topTracks.map((tr) => (
                    <li key={tr.id}>
                      <button onClick={() => playTrack(tr.id)}>
                        {tr.art && <img src={tr.art} alt="" loading="lazy" />}
                        <span>
                          <b>{tr.title}</b>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {mode === "album" && (
          <>
            {record?.art && <img className="rail-hero" src={record.art} alt="" />}
            {!record && profileTried && <h3>{album}</h3>}
            {record && (
              <>
                <h3>{record.name}</h3>
                <p className="rail-meta">
                  {record.released.slice(0, 4)}
                  {record.label && <span> · {record.label}</span>}
                  <span> · {t.trackCount(record.total)}</span>
                </p>
              </>
            )}
            {albumText ? <p className="rail-prose">{albumText}</p> : <p className="loading">{t.loading}</p>}
            {record && record.tracks.length > 0 && (
              <ul className="rail-list numbered">
                {record.tracks.map((tr) => (
                  <li key={tr.id} className={tr.id === trackId ? "here" : ""}>
                    <button onClick={() => playTrack(tr.id)}>
                      <span className="no">{tr.number}</span>
                      <span>
                        <b>{tr.title}</b>
                      </span>
                      <span className="dur">{mmss(tr.durationMs)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
