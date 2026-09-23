import { describe, expect, it } from "vitest";
import { parseLrc } from "../lyrics.js";

describe("parseLrc", () => {
  it("reads a file with unix line endings", () => {
    const out = parseLrc("[00:58.87] It's close to midnight\n[01:01.35] Something evil's lurkin'");
    expect(out.map((l) => l.text)).toEqual(["It's close to midnight", "Something evil's lurkin'"]);
  });

  it("reads a file with carriage returns in it", () => {
    // LRCLIB serves plenty of these. Splitting on \n alone left a \r on every line,
    // which the pattern could not match — so every line WITH WORDS was dropped and only
    // the blank spacers survived, giving Thriller a column of dots and nothing else.
    const out = parseLrc("[00:58.87] It's close to midnight\r\n[01:01.35] Something evil's lurkin'\r\n");
    expect(out.map((l) => l.text)).toEqual(["It's close to midnight", "Something evil's lurkin'"]);
  });

  it("keeps a blank line blank rather than losing its place", () => {
    const out = parseLrc("[01:06.04] \r\n[01:06.90] Under the moonlight\r\n");
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe("");
    expect(out[1].text).toBe("Under the moonlight");
  });

  it("puts the time in seconds", () => {
    expect(parseLrc("[01:06.90] x")[0].at).toBeCloseTo(66.9, 2);
    expect(parseLrc("[00:07.5] x")[0].at).toBeCloseTo(7.5, 2);
  });

  it("sorts by time whatever order the file is in", () => {
    const out = parseLrc("[02:00.00] later\n[01:00.00] earlier");
    expect(out.map((l) => l.text)).toEqual(["earlier", "later"]);
  });

  it("ignores the tags an LRC file carries at the top", () => {
    expect(parseLrc("[ar:Michael Jackson]\n[ti:Thriller]\n[00:58.87] words")).toHaveLength(1);
  });
});
