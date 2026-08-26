import React, { useEffect, useState } from "react";
import type { Strings } from "./i18n";
import { shape, type LyricLine } from "./notes-logic";

type Related = { kind: string; title: string; artist: string; art: string };
type Person = { name: string; role: string; image: string };
type Cover = { artist: string; title: string; year: string; live: boolean; instrumental: boolean };

type Tree = {
  found: boolean;
  title: string;
  artist: string;
  year: string;
  label: string;
  about: string;
  people: Person[];
  original: Related[];
  uses: Related[];
  usedBy: Related[];
  coveredBy: Related[];
  versions: Related[];
  covers: Cover[];
  coverCount: number;
  source: string;
};

const NOTHING: Tree = {
  found: false,
  title: "",
  artist: "",
  year: "",
  label: "",
  about: "",
  people: [],
  original: [],
  uses: [],
  usedBy: [],
  coveredBy: [],
  versions: [],
  covers: [],
  coverCount: 0,
  source: "",
};

const SHOWN = 6;

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
  isrc,
  lines,
  durationMs,
  progressMs,
  onPlay,
  onSeek,
}: {
  t: Strings;
  title: string;
  artist: string;
  album: string;
  released?: string;
  isrc?: string;
  lines: LyricLine[] | null;
  durationMs: number;
  progressMs: number;
  onPlay: (query: string) => void;
  onSeek: (ms: number) => void;
}) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    setTree(null);
    setAll(false);
    let alive = true;
    const params = new URLSearchParams({ title, artist });
    if (isrc) params.set("isrc", isrc);
    fetch(`/api/lineage?${params}`)
      .then((r) => r.json())
      .then((d) => alive && setTree(d))
      .catch(() => alive && setTree(NOTHING));
    return () => {
      alive = false;
    };
  }, [title, artist, isrc]);

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

  const covers = tree?.covers ?? [];
  const listed = all ? covers : covers.slice(0, SHOWN);

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
      {tree && !tree.found && <p className="help">{t.treeNone}</p>}

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

      {(tree?.people?.length ?? 0) > 0 && (
        <>
          <p className="tree-head">{t.treeMakers}</p>
          <ul className="tree people">
            {tree!.people.map((p, i) => (
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
          <ul className="tree plain">
            {listed.map((c, i) => (
              <li key={`c${i}`}>
                <button title={t.treePlay} onClick={() => onPlay(`${c.artist} ${c.title}`)}>
                  <span className="tree-text">
                    <b>{c.artist}</b>
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
          {covers.length > SHOWN && (
            <button className="link tree-more" onClick={() => setAll((v) => !v)}>
              {all ? t.treeFewer : t.treeAll(covers.length)}
            </button>
          )}
        </>
      )}
    </section>
  );
}
