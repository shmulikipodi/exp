import React, { useState } from "react";
import type { Strings } from "./i18n";
import { shape, type LyricLine } from "./notes-logic";
import type { Related, Tree } from "./useTree";

/**
 * Where the song came from and what came out of it, sorted into the questions someone
 * actually asks: who made this, what is it built out of, what got built out of it, who
 * else has sung it. The column used to be the album cover, which is a picture already
 * sitting in the bar underneath.
 */
export function Lineage({
  t,
  title,
  artist,
  album,
  released,
  tree,
  lines,
  durationMs,
  progressMs,
  onPlay,
  onSeek,
  onAsk,
  busy,
  artistText,
  albumText,
}: {
  t: Strings;
  title: string;
  artist: string;
  album: string;
  released?: string;
  tree: Tree | null;
  lines: LyricLine[] | null;
  durationMs: number;
  progressMs: number;
  onPlay: (query: string) => void;
  onSeek: (ms: number) => void;
  onAsk: (topic: "artist" | "album") => void;
  busy: string;
  artistText?: string;
  albumText?: string;
}) {
  const [all, setAll] = useState(false);
  const [allCrew, setAllCrew] = useState(false);

  /** A song: its sleeve, whose it is, and what it has to do with the one playing. */
  const songs = (heading: string, list: Related[]) =>
    list.length === 0 ? null : (
      <>
        <p className="tree-head">{heading}</p>
        <ul className="tree">
          {list.map((r, i) => (
            <li key={`${heading}-${i}`}>
              <button title={t.hearIt} onClick={() => onPlay(`${r.artist} ${r.title}`)}>
                {r.art ? (
                  <img src={r.art} alt="" loading="lazy" />
                ) : (
                  <span className="tree-blank" aria-hidden="true" />
                )}
                <span className="tree-text">
                  <b>{r.title}</b>
                  <span>{r.artist}</span>
                </span>
                <span className="tree-note">{r.kind}</span>
                {/* Clicking plays it and the transport grows a way back, so a detour
                    costs you nothing — that is the whole point of the row. */}
                <span className="tree-go" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="13" height="13">
                    <path fill="currentColor" d="M8 5l11 7-11 7z" />
                  </svg>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </>
    );

  // The structure of the record, read straight off the synced words. No request, no
  // model — a chorus is a block of words that comes back, and that is knowable.
  const built = shape(lines ?? [], durationMs);
  const here = progressMs / 1000;

  // Who made it, and who else was in the building. A name that wrote, produced, sang
  // or played is the answer to "who made this"; the rest are credits.
  const MAIN = /(writ|compos|lyric|produc|arrang|vocal|guitar|bass|drum|keyboard|piano|sax|violin|cell|string|horn|perform|feature)/i;
  const everyone = tree?.people ?? [];
  const people = everyone.filter((p) => MAIN.test(p.role));
  const crew = everyone.filter((p) => !MAIN.test(p.role));

  const covers = tree?.covers ?? [];
  // Two or three worth looking at, then a number. Forty rows of equal weight is a
  // contact sheet, and the one people actually know is lost in it.
  const listed = all ? covers : covers.slice(0, 3);

  return (
    <section className="lineage">
      <header>
        <h1>{title}</h1>
        <p className="artist">{artist}</p>
        <p className="album">
          {album}
          {released && <span> · {released.slice(0, 4)}</span>}
          {tree?.label && <span> · {tree.label}</span>}
        </p>
      </header>

      {tree?.about && <p className="tree-about">{tree.about}</p>}

      {!tree && <p className="loading">{t.loading}</p>}
      {/* An undocumented record is not a broken column. Say which sources were asked
          and came back with nothing, so it reads as an answer rather than a failure. */}
      {tree && !tree.found && built.length < 2 && (
        <p className="help">
          {t.treeNone}
          <span>{t.treeNoneWhy}</span>
        </p>
      )}

      {/* Who they were and what the record was, asked for rather than dumped on you.
          These used to be Spotify profile pages — followers, top tracks, a photograph.
          This is the other thing: what you would want explained about the people and
          the album, in prose, only if you ask. */}
      <p className="tree-head">{t.treeAbout}</p>
      <div className="about">
        {artistText ? (
          <p>{artistText}</p>
        ) : (
          <button className="link" disabled={busy !== ""} onClick={() => onAsk("artist")}>
            {busy === "artist" ? t.thinking : t.whoAreThey(artist)}
          </button>
        )}
        {albumText ? (
          <p>{albumText}</p>
        ) : (
          <button className="link" disabled={busy !== ""} onClick={() => onAsk("album")}>
            {busy === "album" ? t.thinking : t.whatIsRecord(album)}
          </button>
        )}
      </div>

      {songs(t.treeOriginal, tree?.original ?? [])}

      {built.length > 1 && (
        <>
          <p className="tree-head">{t.shapeTitle}</p>
          <ol className="shape">
            {built.map((part, i) => (
              <li
                key={i}
                className={`${part.label}${here >= part.at && here < part.to ? " now" : ""}`}
                style={{ "--len": part.to - part.at } as React.CSSProperties}
              >
                <button onClick={() => onSeek(part.at * 1000)}>
                  <span>{t.sections[part.label] ?? part.label}</span>
                  <span className="when">
                    {Math.floor(part.at / 60)}:{String(Math.floor(part.at % 60)).padStart(2, "0")}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}

      {people.length > 0 && (
        <>
          <p className="tree-head">{t.treeMakers}</p>
          <ul className="tree people">
            {people.map((p, i) => (
              <li key={`${p.name}-${i}`}>
                <span className="row">
                  {p.image ? (
                    <img src={p.image} alt="" loading="lazy" />
                  ) : (
                    <span className="tree-blank round" aria-hidden="true" />
                  )}
                  <span className="tree-text">
                    <b>{p.name}</b>
                    <span>{p.role}</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {/* The assistant engineer and the video producer were arriving with the same
              face, the same row and the same weight as the man who wrote it. They are
              worth keeping and not worth equal billing. */}
          {crew.length > 0 && (
            <>
              {allCrew && (
                <ul className="tree crew">
                  {crew.map((p, i) => (
                    <li key={`${p.name}-${i}`}>
                      <span className="row">
                        <span className="tree-text">
                          <b>{p.name}</b>
                          <span>{p.role}</span>
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <button className="link tree-more" onClick={() => setAllCrew((v) => !v)}>
                {allCrew ? t.treeFewer : t.treeCrew(crew.length)}
              </button>
            </>
          )}
        </>
      )}

      {songs(t.treeSamples, tree?.uses ?? [])}
      {songs(t.treeSampledBy, tree?.usedBy ?? [])}
      {songs(t.treeCoversOf, tree?.coveredBy ?? [])}
      {songs(t.treeVersions, tree?.versions ?? [])}

      {covers.length > 0 && (
        <>
          <p className="tree-head">
            {t.treeCovers}
            <span>{tree?.coverCount ?? covers.length}</span>
          </p>
          <ul className={`tree${all ? " plain" : ""}`}>
            {listed.map((c, i) => (
              <li key={`c${i}`}>
                <button title={t.treePlay} onClick={() => onPlay(`${c.artist} ${c.title}`)}>
                  <span className="tree-text">
                    <b>{c.artist}</b>
                    {!all && <span>{c.title}</span>}
                  </span>
                  <span className="tree-note">
                    {[c.year, c.live ? t.treeLive : "", c.instrumental ? t.treeInstrumental : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {covers.length > 3 && (
            <button className="link tree-more" onClick={() => setAll((v) => !v)}>
              {all ? t.treeFewer : t.treeAll(covers.length)}
            </button>
          )}
        </>
      )}
    </section>
  );
}
