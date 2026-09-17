import { useEffect, useState } from "react";

export type Related = { kind: string; title: string; artist: string; art: string };
export type Person = { name: string; role: string; image: string };
export type Cover = {
  artist: string;
  title: string;
  year: string;
  live: boolean;
  instrumental: boolean;
};

export type Tree = {
  found: boolean;
  title: string;
  artist: string;
  year: string;
  label: string;
  about: string;
  people: Person[];
  readings: { line: string; note: string }[];
  original: Related[];
  uses: Related[];
  usedBy: Related[];
  coveredBy: Related[];
  versions: Related[];
  covers: Cover[];
  coverCount: number;
  source: string;
};

export const NO_TREE: Tree = {
  found: false,
  title: "",
  artist: "",
  year: "",
  label: "",
  about: "",
  people: [],
  readings: [],
  original: [],
  uses: [],
  usedBy: [],
  coveredBy: [],
  versions: [],
  covers: [],
  coverCount: 0,
  source: "",
};

/**
 * The record's family, fetched once and shared.
 *
 * It used to belong to the column that drew it. The notes want it too — a note about a
 * producer can show that producer's face, and a note about a sample can show the sleeve
 * of the record it came from, both from pictures already downloaded. Fetching it twice
 * to achieve that would be silly.
 */
export function useTree(title: string, artist: string, isrc?: string) {
  const [tree, setTree] = useState<Tree | null>(null);

  useEffect(() => {
    if (!title || !artist) return;
    setTree(null);
    let alive = true;
    const params = new URLSearchParams({ title, artist });
    if (isrc) params.set("isrc", isrc);
    fetch(`/api/lineage?${params}`)
      .then((r) => r.json())
      .then((d) => alive && setTree(d))
      .catch(() => alive && setTree(NO_TREE));
    return () => {
      alive = false;
    };
  }, [title, artist, isrc]);

  return tree;
}

/**
 * A face or a sleeve for a note, when the note is about somebody or something the tree
 * already has a picture of.
 *
 * Matched on the name appearing in the note rather than anything structured, because
 * nothing structured connects them — but a note that says "Butch Vig" and a credit that
 * says "Butch Vig" are about the same man, and a picture of him is better than another
 * paragraph of grey.
 */
export function pictureFor(
  tree: Tree | null,
  note: { kind: string; title: string; body: string },
): { src: string; round: boolean; alt: string } | null {
  if (!tree) return null;
  const hay = `${note.title} ${note.body}`.toLowerCase();

  // People first: a face is the stronger picture, and a note that names someone is
  // usually about them rather than about the record they also appear on.
  for (const p of tree.people) {
    if (p.image && p.name.length > 3 && hay.includes(p.name.toLowerCase())) {
      return { src: p.image, round: true, alt: p.name };
    }
  }

  for (const r of [...tree.original, ...tree.uses, ...tree.usedBy, ...tree.coveredBy]) {
    if (r.art && r.title.length > 3 && hay.includes(r.title.toLowerCase())) {
      return { src: r.art, round: false, alt: `${r.artist} — ${r.title}` };
    }
  }
  return null;
}
