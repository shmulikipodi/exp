import { describe, expect, it } from "vitest";
import { covers, once } from "../lineage.js";

const rel = (artist: string, title: string, attributes: string[] = [], begin = "") => ({
  "target-type": "recording",
  attributes,
  begin,
  recording: { title, "artist-credit": [{ name: artist }] },
});

describe("covers", () => {
  it("gives one row per artist, not one per take", () => {
    const list = covers(
      [
        rel("Tori Amos", "Smells Like Teen Spirit", [], "1992"),
        rel("Tori Amos", "Smells Like Teen Spirit", ["live"], "1994"),
        rel("Tori Amos", "Smells Like Teen Spirit", ["live"], "1998"),
      ],
      "Nirvana",
      "Smells Like Teen Spirit",
    );
    expect(list).toHaveLength(1);
    expect(list[0].live).toBe(false); // the studio take is the one worth showing
  });

  it("leaves out the karaoke, the medleys and the eight-second teases", () => {
    const list = covers(
      [
        rel("Backing Tracks Ltd", "Smells Like Teen Spirit", ["karaoke"]),
        rel("Red Hot Chili Peppers", "Sunday Bloody Sunday / Teen Spirit", ["medley", "live"]),
        rel("Local H", "Smells Like Teen Spirit", ["partial"]),
        rel("Patti Smith", "Smells Like Teen Spirit"),
      ],
      "Nirvana",
      "Smells Like Teen Spirit",
    );
    expect(list.map((c) => c.artist)).toEqual(["Patti Smith"]);
  });

  it("never lists the band whose recording is playing", () => {
    const list = covers([rel("Nirvana", "Smells Like Teen Spirit", ["live"])], "Nirvana", "Smells Like Teen Spirit");
    expect(list).toEqual([]);
  });

  it("puts a straight studio cover above a live one, and the earliest first", () => {
    const list = covers(
      [
        rel("Third", "Smells Like Teen Spirit", [], "2010"),
        rel("Second", "Smells Like Teen Spirit", [], "1995"),
        rel("Fourth", "Teen Spirit (live at Reading)", ["live"], "1993"),
        rel("First", "Smells Like Teen Spirit", [], "1992"),
      ],
      "Nirvana",
      "Smells Like Teen Spirit",
    );
    expect(list.map((c) => c.artist)).toEqual(["First", "Second", "Third", "Fourth"]);
  });

  it("keeps a dateless cover, at the end where an unknown year belongs", () => {
    const list = covers(
      [
        rel("Undated", "Smells Like Teen Spirit"),
        rel("Dated", "Smells Like Teen Spirit", [], "2001"),
      ],
      "Nirvana",
      "Smells Like Teen Spirit",
    );
    expect(list.map((c) => c.artist)).toEqual(["Dated", "Undated"]);
  });
});

describe("once", () => {
  const link = (kind: string, title: string, artist: string) => ({ kind, title, artist, art: "" });

  it("shows a song once, under the first relationship it had", () => {
    // Jay-Z's Holy Grail both samples this song and interpolates it. Genius lists it
    // twice; a column that does the same reads like a bug.
    const rows = once(
      [
        link("sampled in", "Holy Grail", "JAY-Z"),
        link("interpolated by", "Holy Grail", "JAY-Z"),
        link("interpolated by", "Song 2", "Blur"),
      ],
      6,
    );
    expect(rows.map((r) => r.title)).toEqual(["Holy Grail", "Song 2"]);
    expect(rows[0].kind).toBe("sampled in");
  });

  it("stops at the limit", () => {
    const rows = once(
      Array.from({ length: 12 }, (_, i) => link("covered by", `Song ${i}`, `Artist ${i}`)),
      6,
    );
    expect(rows).toHaveLength(6);
  });
});
