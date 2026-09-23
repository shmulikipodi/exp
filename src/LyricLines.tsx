import { useEffect, useRef, type CSSProperties, type RefObject } from "react";

export type Line = { at: number; text: string };

/**
 * Put the line being sung a third of the way down rather than dead centre.
 * Centred means half the screen is spent on words already gone; a third leaves the
 * room where it is useful, which is under the line — the words still coming.
 */
export const FOCUS = 0.3;

/** How long after your last scroll the words stay sharp and the song keeps its hands off. */
const READING_MS = 3500;

const SCROLLERS = ".stream, .words, .lyric-full-body";

/**
 * While you are scrolling the lyrics, all of them come into focus and the playhead
 * stops pulling you back.
 *
 * The blur exists to put one line in front of you while you listen. The moment you
 * reach for a different part of the song, that is no longer what you want — you want to
 * read, and blurred text is unreadable by design. Both effects lift together, because
 * sharpening the words while still yanking the column back every four seconds would be
 * worse than leaving them blurred.
 *
 * Keyed to wheel and touch rather than the scroll event: the app's own smooth scrolling
 * fires scroll too, and would read as the reader having taken over.
 */
export function useReading(onSettle?: () => void): RefObject<number> {
  const touched = useRef(0);
  // Kept in a ref so the listeners are attached once rather than on every render.
  const settle = useRef(onSettle);
  settle.current = onSettle;

  useEffect(() => {
    const timers = new Map<Element, number>();
    let quiet = 0;

    const touch = (e: Event) => {
      const target = e.target as Element | null;
      // "scrolling", not "reading": the explanation that sits under a single lyric
      // line is also .reading, so putting that class on the column gave the whole
      // column a 2px accent rule and a different padding the instant you scrolled —
      // a bar appearing out of nowhere and every line jumping sideways with it.
      const box = target?.closest?.(SCROLLERS);
      if (!box) return;
      touched.current = Date.now();
      box.classList.add("scrolling");
      clearTimeout(timers.get(box));
      timers.set(
        box,
        window.setTimeout(() => box.classList.remove("scrolling"), READING_MS),
      );

      // And when the scrolling stops, the record comes back to find you. Without this
      // the column only ever re-centred on the next line to be sung, so letting go
      // anywhere in a long instrumental left you stranded until the singing resumed.
      clearTimeout(quiet);
      quiet = window.setTimeout(() => settle.current?.(), READING_MS);
    };

    document.addEventListener("wheel", touch, { passive: true, capture: true });
    document.addEventListener("touchmove", touch, { passive: true, capture: true });
    return () => {
      document.removeEventListener("wheel", touch, { capture: true });
      document.removeEventListener("touchmove", touch, { capture: true });
      for (const id of timers.values()) clearTimeout(id);
      clearTimeout(quiet);
    };
  }, []);

  return touched;
}

/** True while the reader has the column, and the song should keep its hands off it. */
export const isReading = (touched: RefObject<number>) =>
  Date.now() - touched.current < READING_MS;

/**
 * Is the line already somewhere the reader can see it?
 *
 * Used by the settle, not by ordinary tracking. After a scroll the column comes back to
 * the current line — but if that line is sitting in plain view already, coming back to
 * it means moving the page under someone who was reading it.
 */
export function inView(scroller: Element | null, line: Element | null): boolean {
  if (!scroller || !line) return false;
  const box = scroller.getBoundingClientRect();
  const here = line.getBoundingClientRect();
  return here.top >= box.top + box.height * 0.05 && here.bottom <= box.top + box.height * 0.8;
}

export function scrollToLine(scroller: Element | null, line: Element | null) {
  if (!scroller || !line) return;
  const box = scroller.getBoundingClientRect();
  const here = line.getBoundingClientRect();
  // Centre the line on the focus point, unless the line is long enough that doing so
  // would push its first row off the top — a narrow panel wraps a lyric into three
  // rows, and the words have to be on screen before they can be in focus.
  const from = Math.max(box.height * 0.08, box.height * FOCUS - here.height / 2);
  const top = scroller.scrollTop + (here.top - box.top) - from;

  // Smooth for the step from one line to the next; instant when the line is nowhere
  // near the screen. Animating across a whole song takes long enough that the next
  // line arrives mid-flight, and the column ends up permanently chasing a position it
  // never reaches — which is the words sliding off the bottom while the view trails.
  const far = Math.abs(top - scroller.scrollTop) > box.height * 1.5;
  scroller.scrollTo({ top, behavior: far ? "auto" : "smooth" });
}

/**
 * The words, focused on the one being sung. Distance from that line drives both the
 * blur and the fade, so the couple of lines either side stay readable and everything
 * beyond them is atmosphere rather than text competing for the eye.
 *
 * Clicking a line jumps there — on a lyric screen the words are the timeline.
 */
export function LyricLines({
  lines,
  active,
  onSeek,
  translated,
}: {
  lines: Line[];
  active: number;
  onSeek?: (ms: number) => void;
  /** The same lines in another language, one for one, when the reader asked for them. */
  translated?: string[] | null;
}) {
  return (
    <>
      {lines.map((line, i) => {
        // A waterline, the way a phone shows it: everything already sung stays lit and
        // sharp, everything still to come is dim. The boundary between the two IS your
        // position in the record, which is the thing you lose the moment you scroll —
        // fading both directions away from the current line looked handsome and told
        // you nothing about where you were.
        const from = i - active;
        const d = active < 0 || from < 0 ? 0 : Math.min(7, from);
        const state = active < 0 ? "" : i === active ? " now" : i < active ? " sung" : "";
        return (
          <p
            key={i}
            data-l={i}
            dir="auto"
            style={{ "--d": d } as CSSProperties}
            className={`lyric-line${state}${onSeek ? " seekable" : ""}`}
            onClick={onSeek ? () => onSeek(Math.max(0, Math.round(line.at * 1000))) : undefined}
          >
            {line.text || "·"}
            {translated?.[i] ? <span className="rendered">{translated[i]}</span> : null}
          </p>
        );
      })}
    </>
  );
}
