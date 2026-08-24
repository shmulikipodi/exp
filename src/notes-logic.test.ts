import { describe, expect, it } from "vitest";
import { matchesLang, schedule } from "./notes-logic";

const note = (body: string) => ({ body });

describe("schedule", () => {
  it("keeps a note's own timestamp", () => {
    expect(schedule([{ at: 0.42 }])).toEqual([0.42]);
  });

  it("puts a lone floating note early, not at the start", () => {
    const [only] = schedule([{ at: null }]);
    expect(only).toBeGreaterThan(0);
    expect(only).toBeLessThan(0.3);
  });

  it("spreads floating notes in order without collisions", () => {
    const times = schedule([{ at: null }, { at: null }, { at: null }, { at: null }]);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
    expect(Math.max(...times)).toBeLessThan(0.75);
  });

  it("leaves room at the end so the last note is not stranded past the fade", () => {
    const times = schedule(Array.from({ length: 12 }, () => ({ at: null })));
    expect(Math.max(...times)).toBeLessThanOrEqual(0.68);
  });

  it("interleaves fixed and floating notes without dividing by zero", () => {
    expect(() => schedule([{ at: 0.9 }, { at: null }])).not.toThrow();
    expect(schedule([{ at: 0.9 }, { at: null }])[0]).toBe(0.9);
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
