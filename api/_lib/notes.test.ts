import { describe, expect, it } from "vitest";
import { allHebrew, looksHebrew, parseAnswer, parseNotes, toFraction } from "../notes.js";

describe("parseNotes", () => {
  it("reads plain JSON", () => {
    expect(parseNotes('{"headline":"x"}').headline).toBe("x");
  });

  it("digs the object out of a markdown fence, which models add anyway", () => {
    expect(parseNotes('```json\n{"headline":"x"}\n```').headline).toBe("x");
    expect(parseNotes('```\n{"headline":"x"}\n```').headline).toBe("x");
  });

  it("finds the object inside surrounding chatter", () => {
    expect(parseNotes('Here you go:\n{"headline":"x"}\nHope that helps!').headline).toBe("x");
  });

  it("throws when there is no object to find", () => {
    expect(() => parseNotes("no json here at all")).toThrow(/did not return JSON/);
  });
});

describe("parseAnswer", () => {
  it("prefers the answer field", () => {
    expect(parseAnswer('{"answer":"Rick Parashar produced it."}')).toBe("Rick Parashar produced it.");
  });

  it("keeps prose rather than discarding a good sentence for want of braces", () => {
    expect(parseAnswer("Rick Parashar produced it.")).toBe("Rick Parashar produced it.");
  });

  it("strips a stray fence off prose", () => {
    expect(parseAnswer("```\nRick Parashar produced it.\n```")).toBe("Rick Parashar produced it.");
  });

  it("falls back when the JSON parses but carries no answer", () => {
    expect(parseAnswer('{"notes":[]}')).toContain("notes");
  });
});

describe("the Hebrew checks", () => {
  it("spots Hebrew anywhere", () => {
    expect(looksHebrew("שלום")).toBe(true);
    expect(looksHebrew("hello")).toBe(false);
  });

  it("requires every note, not just one — the bug that survived the first fix", () => {
    const mixed = {
      headline: "כותרת",
      notes: [{ body: "עברית" }, { body: "The Mamasan trilogy narrative" }],
    };
    expect(looksHebrew(JSON.stringify(mixed))).toBe(true);
    expect(allHebrew(mixed)).toBe(false);
  });

  it("accepts a set that is Hebrew throughout", () => {
    expect(allHebrew({ headline: "כותרת", notes: [{ body: "עברית" }] })).toBe(true);
  });

  it("rejects a Hebrew headline over English notes", () => {
    expect(allHebrew({ headline: "כותרת", notes: [{ body: "English" }] })).toBe(false);
  });

  it("survives a malformed shape instead of throwing mid-request", () => {
    expect(allHebrew({})).toBe(false);
    expect(allHebrew({ headline: "כותרת" })).toBe(true);
  });
});

describe("placing a note in the track", () => {
  const FIVE_MIN = 300_000;

  it("turns a timestamp into a position", () => {
    expect(toFraction("2:30", FIVE_MIN)).toBeCloseTo(0.5, 5);
    expect(toFraction("0:00", FIVE_MIN)).toBe(0);
  });

  it("refuses a time past the end of the song", () => {
    expect(toFraction("9:99", FIVE_MIN)).toBeNull();
    expect(toFraction("7:00", FIVE_MIN)).toBeNull();
  });

  it("refuses anything that is not a time", () => {
    expect(toFraction("about halfway", FIVE_MIN)).toBeNull();
    expect(toFraction("40%", FIVE_MIN)).toBeNull();
    expect(toFraction(null, FIVE_MIN)).toBeNull();
    expect(toFraction("2:30", 0)).toBeNull();
  });

  it("still accepts the raw fraction older stored notes used", () => {
    expect(toFraction(0.42, FIVE_MIN)).toBe(0.42);
    expect(toFraction(1.5, FIVE_MIN)).toBeNull();
  });
});
