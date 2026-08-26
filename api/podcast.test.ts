import { describe, expect, it } from "vitest";
import { trusted } from "./podcast.js";

describe("trusted", () => {
  it("takes the shows that do the work, with whatever subtitle they carry", () => {
    for (const show of [
      "Song Exploder",
      "Hit Parade | Music History with Chris Molanphy",
      "Cocaine & Rhinestones: Country Music History",
      "A History of Rock Music in 500 Songs",
      "Broken Record with Rick Rubin, Malcolm Gladwell, Bruce Headlam and Justin Richmond",
    ]) {
      expect(trusted(show), show).toBe(true);
    }
  });

  it("takes the Hebrew shows that do the same thing", () => {
    expect(trusted("שיר אחד One Song")).toBe(true);
    expect(trusted("האזנה מודרכת")).toBe(true);
  });

  it("refuses a feed that merely has a trusted name inside it", () => {
    // Apple's directory is full of reaction channels and cover-song feeds naming the
    // shows they orbit. Matching anywhere in the title let all of them in.
    expect(trusted("Best of Song Exploder Reactions")).toBe(false);
    expect(trusted("The Unofficial Dissect Recap Show")).toBe(false);
  });

  it("keeps the children's show out of the podcast it shares a name with", () => {
    expect(trusted("One Song from Age 4 שיר אחד מגיל")).toBe(false);
    expect(trusted("One Song")).toBe(true);
  });
});
