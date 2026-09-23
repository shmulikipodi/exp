import { describe, expect, it } from "vitest";
import { FOCUS, scrollToLine } from "./LyricLines";

/** A scroller and a line, with only the four things scrollToLine actually touches. */
function stage(opts: { height: number; scrollTop: number; lineTop: number; lineHeight?: number }) {
  const calls: { top: number; behavior: string }[] = [];
  const scroller = {
    scrollTop: opts.scrollTop,
    getBoundingClientRect: () => ({ top: 0, height: opts.height }),
    scrollTo: (o: { top: number; behavior: string }) => calls.push(o),
  } as unknown as Element;
  const line = {
    getBoundingClientRect: () => ({ top: opts.lineTop, height: opts.lineHeight ?? 30 }),
  } as unknown as Element;
  return { scroller, line, calls };
}

describe("scrollToLine", () => {
  it("puts the line being sung a third of the way down", () => {
    const { scroller, line, calls } = stage({ height: 800, scrollTop: 1000, lineTop: 600 });
    scrollToLine(scroller, line);
    // 1000 + 600 - (800 * 0.3 - 15) = 1375
    expect(calls[0].top).toBe(1000 + 600 - (800 * FOCUS - 15));
  });

  it("eases the step from one line to the next", () => {
    const { scroller, line, calls } = stage({ height: 800, scrollTop: 1000, lineTop: 300 });
    scrollToLine(scroller, line);
    expect(calls[0].behavior).toBe("smooth");
  });

  it("jumps when the line is nowhere near the screen", () => {
    // Animating thousands of pixels takes long enough that the next line arrives
    // mid-flight, and the column spends the rest of the song chasing a position it
    // never reaches — the words sliding away while the view trails behind them.
    const { scroller, line, calls } = stage({ height: 800, scrollTop: 0, lineTop: 4000 });
    scrollToLine(scroller, line);
    expect(calls[0].behavior).toBe("auto");
  });

  it("jumps just as readily when the line is far above", () => {
    const { scroller, line, calls } = stage({ height: 800, scrollTop: 5000, lineTop: -4000 });
    scrollToLine(scroller, line);
    expect(calls[0].behavior).toBe("auto");
  });

  it("keeps a tall wrapped line's first row on screen", () => {
    // A narrow column wraps a lyric into three rows. Centring such a line on the focus
    // point would push its opening off the top, and a line you cannot see is not in
    // focus however well positioned it is.
    const { scroller, line, calls } = stage({
      height: 300,
      scrollTop: 500,
      lineTop: 100,
      lineHeight: 260,
    });
    scrollToLine(scroller, line);
    expect(calls[0].top).toBe(500 + 100 - 300 * 0.08);
  });

  it("does nothing at all when there is no line to go to", () => {
    const { scroller, calls } = stage({ height: 800, scrollTop: 0, lineTop: 0 });
    scrollToLine(scroller, null);
    scrollToLine(null, null);
    expect(calls).toHaveLength(0);
  });
});
