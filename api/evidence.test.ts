import { describe, expect, it } from "vitest";
import { sameSong } from "./evidence.js";

describe("sameSong", () => {
  it("matches a plain title", () => {
    expect(sameSong("Maggot Brain", "Maggot Brain")).toBe(true);
  });

  it("ignores case and punctuation", () => {
    expect(sameSong("A LOVE SUPREME, PT. I", "a love supreme pt i")).toBe(true);
  });

  it("sees through a remaster suffix", () => {
    expect(sameSong("Alive (Remastered 2011)", "Alive")).toBe(true);
    expect(sameSong("Teardrop [Single Version]", "Teardrop")).toBe(true);
  });

  it("accepts a title that extends the one asked for", () => {
    expect(sameSong("Pyramid Song", "Pyramid Song (Live)")).toBe(true);
  });

  it("rejects a different song — the case that poisoned the credits", () => {
    expect(sameSong("Worrywort", "Pyramid Song")).toBe(false);
    expect(sameSong("Better Man (Pearl Jam song)", "Alive")).toBe(false);
  });

  it("matches titles in scripts other than Latin", () => {
    expect(sameSong("על כל אלה", "על כל אלה")).toBe(true);
    expect(sameSong("プラスチックラブ", "プラスチックラブ")).toBe(true);
    expect(sameSong("Кино", "Кино")).toBe(true);
  });

  it("still tells two different non-Latin titles apart", () => {
    expect(sameSong("על כל אלה", "ירושלים של זהב")).toBe(false);
  });

  it("sees through a parenthetical on a Hebrew title", () => {
    expect(sameSong("על כל אלה (גרסה חיה)", "על כל אלה")).toBe(true);
  });

  it("rejects rather than guessing when either side is missing", () => {
    expect(sameSong(undefined, "Alive")).toBe(false);
    expect(sameSong("Alive", "")).toBe(false);
    expect(sameSong("!!!", "Alive")).toBe(false);
  });
});
