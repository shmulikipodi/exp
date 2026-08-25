import { describe, expect, it } from "vitest";
import { MIN_NOTES, dividerWidth, grabOffset, matchesLang, schedule } from "./notes-logic";

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

describe("dragging a divider", () => {
  const box = { left: 0, right: 1400, width: 1400 };

  it("does not jump when the hand lands off-centre on the divider", () => {
    // The sleeve is 400 wide and the cursor grabs the divider 6px past its edge.
    const grab = grabOffset("sleeve", false, 406, box, 400);
    // First move event, cursor has not travelled: the width must not change.
    expect(dividerWidth("sleeve", false, 406, grab, box, 300)).toBe(400);
    // And it tracks the hand one-for-one from there.
    expect(dividerWidth("sleeve", false, 456, grab, box, 300)).toBe(450);
    expect(dividerWidth("sleeve", false, 356, grab, box, 300)).toBe(350);
  });

  it("holds the same grip in Hebrew, where the column hangs off the other edge", () => {
    const grab = grabOffset("sleeve", true, 1400 - 406, box, 400);
    expect(dividerWidth("sleeve", true, 1400 - 406, grab, box, 300)).toBe(400);
    // Dragging toward the middle of a right-to-left page widens the sleeve.
    expect(dividerWidth("sleeve", true, 1400 - 456, grab, box, 300)).toBe(450);
  });

  it("moves the panel the opposite way, since it hangs off the far edge", () => {
    const grab = grabOffset("rail", false, 1400 - 306, box, 300);
    expect(dividerWidth("rail", false, 1400 - 306, grab, box, 400)).toBe(300);
    expect(dividerWidth("rail", false, 1400 - 356, grab, box, 400)).toBe(350);
  });

  it("never squeezes the reading column below what a column is", () => {
    const grab = grabOffset("sleeve", false, 400, box, 400);
    // Panel already at 640; the sleeve may not take more than what is left.
    const wide = dividerWidth("sleeve", false, 1399, grab, box, 640);
    expect(wide).toBe(1400 - 640 - MIN_NOTES);
    expect(1400 - wide - 640).toBeGreaterThanOrEqual(MIN_NOTES);
  });

  it("keeps each column inside its own limits", () => {
    const grab = grabOffset("rail", false, 1400, box, 0);
    expect(dividerWidth("rail", false, 1400, grab, box, 300)).toBe(240);
    expect(dividerWidth("rail", false, 0, grab, box, 300)).toBe(640);
  });
});
