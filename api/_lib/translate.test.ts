import { describe, expect, it } from "vitest";
import { parseLines } from "../translate.js";

describe("parseLines", () => {
  it("reads a plain list", () => {
    expect(parseLines('["one","two"]', 2)).toEqual(["one", "two"]);
  });

  it("reads a list the model wrapped in a fence and a sentence", () => {
    const text = 'Sure, here you go:\n```json\n["uno", "dos"]\n```\nHope that helps.';
    expect(parseLines(text, 2)).toEqual(["uno", "dos"]);
  });

  it("pads a short answer rather than sliding every line out of sync", () => {
    // The lines are read against the music. A missing translation must leave a gap in
    // place, never shift line four onto line three's timing.
    expect(parseLines('["one","two"]', 4)).toEqual(["one", "two", "", ""]);
  });

  it("cuts a long answer to the number of lines there actually are", () => {
    expect(parseLines('["a","b","c"]', 2)).toEqual(["a", "b"]);
  });

  it("keeps empty lines empty", () => {
    expect(parseLines('["a","","c"]', 3)).toEqual(["a", "", "c"]);
  });

  it("replaces anything that is not a string, rather than rendering it", () => {
    expect(parseLines('["a",null,3]', 3)).toEqual(["a", "", ""]);
  });

  it("digs the list out when the model wrapped it in an object", () => {
    expect(parseLines('{"lines":["a"]}', 1)).toEqual(["a"]);
  });

  it("says so when the model did not return a list at all", () => {
    expect(() => parseLines("I cannot translate that.", 2)).toThrow(/list/);
    expect(() => parseLines("", 2)).toThrow(/list/);
  });
});
