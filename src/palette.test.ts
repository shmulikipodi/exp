import { describe, expect, it } from "vitest";
import { dominant } from "./palette";

/** Build a flat RGBA buffer out of repeated colours. */
const pixels = (...runs: [number, number, number, number][]) => {
  const out: number[] = [];
  for (const [r, g, b, n] of runs) for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  return out;
};

describe("dominant", () => {
  it("names the colour a person would name, not the one covering most pixels", () => {
    // A grey sleeve with a small vivid red patch reads as red.
    const [first] = dominant(pixels([128, 128, 128, 400], [220, 30, 30, 30]), 4);
    expect(first.h).toBeLessThan(20);
  });

  it("keeps distinct colours apart rather than returning one hue four times", () => {
    const swatches = dominant(
      pixels([220, 30, 30, 100], [30, 200, 90, 100], [40, 90, 220, 100]),
      3,
    );
    const hues = swatches.map((s) => s.h).sort((a, b) => a - b);
    expect(hues).toHaveLength(3);
    for (let i = 1; i < hues.length; i++) expect(hues[i] - hues[i - 1]).toBeGreaterThan(25);
  });

  it("pins saturation and lightness so the words stay readable over any sleeve", () => {
    // Nearly black, nearly white, and a washed-out pastel: none may come back as either
    // a colour you cannot see or one you cannot read on.
    for (const px of [pixels([12, 10, 30, 200]), pixels([240, 238, 250, 200])]) {
      for (const s of dominant(px, 2)) {
        expect(s.s).toBeGreaterThanOrEqual(42);
        expect(s.l).toBeGreaterThanOrEqual(34);
        expect(s.l).toBeLessThanOrEqual(62);
      }
    }
  });

  it("fills the field from what the sleeve gave when it gave almost nothing", () => {
    const swatches = dominant(pixels([200, 40, 40, 300]), 4);
    expect(swatches).toHaveLength(4);
    expect(new Set(swatches.map((s) => s.h)).size).toBe(4);
  });

  it("returns nothing for a sleeve with no colour at all", () => {
    expect(dominant(pixels([0, 0, 0, 100], [255, 255, 255, 100]), 4)).toEqual([]);
  });
});
