import { describe, expect, it } from "vitest";
import { matchesLang, schedule } from "./notes-logic";

const note = (body: string) => ({ body });

describe("schedule", () => {
  it("keeps a note's own timestamp", () => {
    expect(schedule([{ at: 0.42 }])).toEqual([0.42]);
  });

  it("puts a note with no moment at the very start", () => {
    expect(schedule([{ at: null }])).toEqual([0]);
  });

  it("leaves every general note available immediately", () => {
    expect(schedule([{ at: null }, { at: null }, { at: null }])).toEqual([0, 0, 0]);
  });

  it("does not move a timed note to make room for untimed ones", () => {
    expect(schedule([{ at: null }, { at: 0.8 }, { at: null }])).toEqual([0, 0.8, 0]);
  });

  it("keeps timed notes in whatever order the track puts them", () => {
    expect(schedule([{ at: 0.9 }, { at: 0.2 }])).toEqual([0.9, 0.2]);
  });

  it("handles an empty set", () => {
    expect(schedule([])).toEqual([]);
  });
});

describe("matchesLang", () => {
  const hebrew = { headline: "כותרת", notes: [note("גוף ההערה"), note("עוד עברית")] };
  const english = { headline: "A headline", notes: [note("English body")] };

  it("passes anything when the language is English", () => {
    expect(matchesLang(english, "en")).toBe(true);
    expect(matchesLang(hebrew, "en")).toBe(true);
  });

  it("accepts a fully Hebrew set", () => {
    expect(matchesLang(hebrew, "he")).toBe(true);
  });

  it("rejects an English set stored under Hebrew", () => {
    expect(matchesLang(english, "he")).toBe(false);
  });

  it("rejects a half-and-half set — the case that survived the first fix", () => {
    const mixed = { headline: "כותרת בעברית", notes: [note("עברית"), note("English body")] };
    expect(matchesLang(mixed, "he")).toBe(false);
  });

  it("accepts an empty set rather than regenerating it forever", () => {
    expect(matchesLang({ headline: "", notes: [] }, "he")).toBe(true);
  });

  it("does not count Latin names inside Hebrew as a failure", () => {
    const withNames = {
      headline: "סולו של Eddie Hazel",
      notes: [note("הוקלט ב-United Sound Systems בדטרויט.")],
    };
    expect(matchesLang(withNames, "he")).toBe(true);
  });
});
