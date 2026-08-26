import { describe, expect, it } from "vitest";
import { MIN_NOTES, dividerWidth, grabOffset, matchesLang, shape, weave } from "./notes-logic";

const note = (body: string) => ({ body });

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

describe("weave", () => {
  const lines = [
    { at: 26, text: "Load up on guns, bring your friends" },
    { at: 30, text: "It's fun to lose and to pretend" },
    { at: 34, text: "She's over-bored and self-assured" },
  ];
  // A 100-second recording, so a note's fraction reads as seconds directly.
  const at = (seconds: number | null) => ({ at: seconds === null ? null : seconds / 100 });

  it("puts a note under the line that was being sung", () => {
    const woven = weave([at(31)], lines, 100_000);
    const order = woven.map((w) => (w.kind === "line" ? w.line.text.slice(0, 8) : "NOTE"));
    expect(order).toEqual(["Load up ", "It's fun", "NOTE", "She's ov"]);
  });

  it("puts what the record is before the record starts", () => {
    // Notes with no moment, and notes from before the first word, both belong up top.
    const woven = weave([at(null), at(4), at(31)], lines, 100_000);
    expect(woven.slice(0, 2).every((w) => w.kind === "note")).toBe(true);
    expect(woven[2].kind).toBe("line");
  });

  it("keeps several notes on one line in the order they were written", () => {
    const woven = weave([at(35), at(36)], lines, 100_000);
    const notes = woven.filter((w) => w.kind === "note");
    expect(notes.map((n) => (n as { index: number }).index)).toEqual([0, 1]);
  });

  it("is the plain list of notes when there are no words to hang them on", () => {
    const woven = weave([at(31), at(null)], [], 100_000);
    expect(woven).toHaveLength(2);
    expect(woven.every((w) => w.kind === "note")).toBe(true);
  });

  it("does not lose a note whose moment lands after the last line", () => {
    const woven = weave([at(90)], lines, 100_000);
    expect(woven[woven.length - 1].kind).toBe("note");
  });
});

describe("shape", () => {
  const verse1 = [
    { at: 26, text: "Load up on guns" },
    { at: 29, text: "It's fun to lose" },
  ];
  const chorus = [
    { at: 40, text: "Here we are now" },
    { at: 43, text: "Entertain us" },
  ];
  const verse2 = [
    { at: 70, text: "I'm worse at what I do best" },
    { at: 73, text: "And for this gift I feel blessed" },
  ];
  const chorusAgain = [
    { at: 90, text: "Here we are now" },
    { at: 93, text: "Entertain us" },
  ];

  it("calls the words that come back the chorus", () => {
    const found = shape([...verse1, ...chorus, ...verse2, ...chorusAgain], 120_000);
    const labels = found.map((s) => s.label);
    expect(labels.filter((l) => l === "chorus")).toHaveLength(2);
    expect(labels.filter((l) => l === "verse")).toHaveLength(2);
  });

  it("finds the intro before the first word", () => {
    const [first] = shape([...verse1, ...chorus], 90_000);
    expect(first).toMatchObject({ label: "intro", at: 0, to: 26 });
  });

  it("finds the passage where nobody is singing", () => {
    // Twenty-seven seconds between the chorus ending and the next verse: a solo.
    const found = shape([...verse1, ...chorus, ...verse2], 120_000);
    const solos = found.filter((s) => s.label === "instrumental");
    expect(solos).toEqual([{ label: "instrumental", at: 43, to: 70 }]);
  });

  it("does not call the ten seconds between a verse and a chorus a solo", () => {
    // Blocks still separate there — it is a different section — but eleven seconds of
    // nobody singing is how songs change gear, not a passage worth its own row.
    const found = shape([...verse1, ...chorus], 90_000);
    expect(found.filter((s) => s.label === "instrumental")).toEqual([]);
  });

  it("finds the outro when the record runs on after the last line", () => {
    const found = shape([...verse1, ...chorus], 120_000);
    expect(found[found.length - 1]).toMatchObject({ label: "outro", to: 120 });
  });

  it("says nothing rather than guessing when there are no synced words", () => {
    expect(shape([], 200_000)).toEqual([]);
    expect(shape([{ at: 3, text: "one line" }], 200_000)).toEqual([]);
  });

  it("does not call a single repeated line a chorus", () => {
    // One line coming back is a refrain. A chorus is a block of them.
    const found = shape(
      [
        { at: 10, text: "hey" },
        { at: 13, text: "first verse here" },
        { at: 30, text: "hey" },
        { at: 33, text: "second verse here" },
      ],
      60_000,
    );
    expect(found.filter((s) => s.label === "chorus")).toHaveLength(0);
  });
});
