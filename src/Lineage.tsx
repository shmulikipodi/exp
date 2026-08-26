import { useEffect, useState } from "react";
import type { Strings } from "./i18n";

type Related = { kind: string; title: string; artist: string };
type Cover = { artist: string; title: string; year: string; live: boolean; instrumental: boolean };
type Tree = {
  found: boolean;
  title: string;
  artist: string;
  year: string;
  label: string;
  from: Related[];
  into: Related[];
  covers: Cover[];
  coverCount: number;
  source: string;
};

const SHOWN = 8;

const NOTHING: Tree = {
  found: false,
  title: "",
  artist: "",
  year: "",
  label: "",
  from: [],
  into: [],
  covers: [],
  coverCount: 0,
  source: "",
};

/**
 * Where the song came from and what came out of it. The column used to hold the album
 * cover, which is a picture you are already looking at in the bar underneath — this is
 * the thing about a record you cannot see anywhere else, and every line in it is
 * somewhere you can go.
 */
export function Lineage({
  t,
  title,
  artist,
  album,
  released,
  isrc,
  onPlay,
}: {
  t: Strings;
  title: string;
  artist: string;
  album: string;
  released?: string;
  isrc?: string;
  onPlay: (query: string) => void;
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

  const covers = tree?.covers ?? [];
  const from = tree?.from ?? [];
  const into = tree?.into ?? [];
  const listed = all ? covers : covers.slice(0, SHOWN);

  const row = (key: string, who: string, what: string, note: string) => (
    <li key={key}>
      <button title={t.treePlay} onClick={() => onPlay(`${who} ${what}`)}>
        <span className="tree-who">{who}</span>
        <span className="tree-what">{what}</span>
        {note && <span className="tree-note">{note}</span>}
      </button>
    </li>
  );

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

      {!tree && <p className="loading">{t.loading}</p>}
      {tree && !tree.found && <p className="help">{t.treeNone}</p>}

      {from.length > 0 && (
        <>
          <p className="tree-head">{t.treeFrom}</p>
          <ul className="tree">
            {from.map((r, i) => row(`f${i}`, r.artist || artist, r.title, r.kind))}
          </ul>
        </>
      )}

      {into.length > 0 && (
        <>
          <p className="tree-head">{t.treeInto}</p>
          <ul className="tree">
            {into.map((r, i) => row(`i${i}`, r.artist || artist, r.title, r.kind))}
          </ul>
        </>
      )}

      {covers.length > 0 && (
        <>
          <p className="tree-head">
            {t.treeCovers}
            <span>{tree?.coverCount ?? covers.length}</span>
          </p>
          <ul className="tree">
            {listed.map((c, i) =>
              row(
                `c${i}`,
                c.artist,
                c.year || c.title,
                [c.live ? t.treeLive : "", c.instrumental ? t.treeInstrumental : ""]
                  .filter(Boolean)
                  .join(" · "),
              ),
            )}
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
