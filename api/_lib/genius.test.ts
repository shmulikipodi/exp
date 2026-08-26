import { describe, expect, it } from "vitest";
import { people, pickSong, rank } from "./genius.js";

const hit = (id: number, title: string, artist: string) => ({
  result: { id, title, primary_artist: { name: artist } },
});

describe("pickSong", () => {
  it("takes the original over the eleven covers sharing its title", () => {
    const picked = pickSong(
      [
        hit(1, "Smells Like Teen Spirit (Nirvana Cover)", "The Used"),
        hit(2, "Smells Like Teen Spirit", "Nirvana"),
      ],
      "Smells Like Teen Spirit",
      "Nirvana",
    );
    expect(picked?.id).toBe(2);
  });

  it("takes the cover when the cover is what is playing", () => {
    const picked = pickSong(
      [hit(1, "Hurt", "Nine Inch Nails"), hit(2, "Hurt", "Johnny Cash")],
      "Hurt",
      "Johnny Cash",
    );
    expect(picked?.id).toBe(2);
  });

  it("returns nothing rather than the wrong song", () => {
    expect(pickSong([hit(1, "Something Else", "Nirvana")], "Lithium", "Nirvana")).toBeNull();
    expect(pickSong([hit(1, "Lithium", "Evanescence")], "Lithium", "Nirvana")).toBeNull();
  });
});

describe("rank", () => {
  const song = (title: string, artist: string, pageviews: number | null) => ({
    title,
    primary_artist: { name: artist },
    stats: pageviews === null ? {} : { pageviews },
  });
  const map = { interpolated_by: "interpolated by", sampled_in: "sampled in" };

  it("puts what people actually read about first", () => {
    const links = rank(
      [
        {
          relationship_type: "interpolated_by",
          songs: [song("Nobody Heard This", "Someone", null), song("Song 2", "Blur", 300000)],
        },
      ],
      map,
    );
    expect(links[0].artist).toBe("Blur");
  });

  it("drops the unread ones once there are enough read ones", () => {
    const links = rank(
      [
        {
          relationship_type: "sampled_in",
          songs: [
            song("A", "Read", 500),
            song("B", "Read", 400),
            song("C", "Read", 300),
            song("D", "Unread", null),
          ],
        },
      ],
      map,
    );
    expect(links.map((l) => l.artist)).toEqual(["Read", "Read", "Read"]);
  });

  it("keeps the unread ones when they are all there is", () => {
    const links = rank(
      [{ relationship_type: "sampled_in", songs: [song("A", "Obscure", null)] }],
      map,
    );
    expect(links).toHaveLength(1);
  });

  it("ignores relationship types it was not asked for", () => {
    expect(rank([{ relationship_type: "translations", songs: [song("A", "B", 9)] }], map)).toEqual([]);
  });
});

describe("people", () => {
  const song = {
    writer_artists: [{ name: "Kurt Cobain", image_url: "k.jpg" }],
    producer_artists: [{ name: "Butch Vig", image_url: "b.jpg" }],
    custom_performances: [
      { label: "Bass Guitar", artists: [{ name: "Krist Novoselic" }] },
      { label: "Arranger", artists: [{ name: "Butch Vig" }] },
      { label: "Publisher", artists: [{ name: "Geffen Records" }] },
      { label: "Assistant Engineer", artists: [{ name: "Jeff Sheehan" }] },
      { label: "Video Editor", artists: [{ name: "Angus Wall" }] },
    ],
  };

  it("gives one line per person, carrying everything they did", () => {
    const list = people(song);
    const vig = list.find((p) => p.name === "Butch Vig");
    expect(vig?.role).toBe("Producer, arranger");
    expect(vig?.image).toBe("b.jpg");
    expect(list.filter((p) => p.name === "Butch Vig")).toHaveLength(1);
  });

  it("leaves out the publishers and the copyright lines", () => {
    // Who owns a song is not who made it.
    expect(people(song).map((p) => p.name)).not.toContain("Geffen Records");
  });

  it("puts the people who wrote and played it above the ones who filmed it", () => {
    const names = people(song).map((p) => p.name);
    expect(names.indexOf("Krist Novoselic")).toBeLessThan(names.indexOf("Jeff Sheehan"));
    expect(names.indexOf("Jeff Sheehan")).toBeLessThan(names.indexOf("Angus Wall"));
  });

  it("says nothing rather than something when the page credits nobody", () => {
    expect(people({})).toEqual([]);
  });
});
