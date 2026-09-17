import type { Strings } from "./i18n";
// Note text arrives with [[names]] marked and a map of where each one goes, resolved
// against Wikipedia on the server. The model never writes a URL — it only says which
// words are worth looking up.

const LINK = /\[\[(?:(artist|song):)?([^\]|]{2,60})(?:\|[^\]]{2,80})?\]\]/g;

/**
 * Somebody's actual words, long enough to be worth hearing in their own voice.
 *
 * The notes are now written to quote people rather than report them, and a good quote
 * buried mid-paragraph in the same grey as everything around it is a quote wasted. Any
 * of the marks a model reaches for, straight or curly.
 */
const QUOTE = /["\u201c\u2018\u00ab]([^"\u201d\u2019\u00bb]{28,220})["\u201d\u2019\u00bb]/g;

type Part = string | { term: string; href: string; kind?: "artist" | "song" };

/** Wrap quoted runs so they can be set apart, leaving everything else untouched. */
function spoken(text: string, key: string) {
  if (!QUOTE.test(text)) return text;
  QUOTE.lastIndex = 0;
  const out: (string | { said: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(QUOTE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push({ said: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.map((bit, i) =>
    typeof bit === "string" ? (
      bit
    ) : (
      <span className="said" key={`${key}-${i}`}>
        {bit.said}
      </span>
    ),
  );
}

export function Linked({
  text,
  links,
  onPlay,
  onOpenArtist,
  t,
}: {
  text: string;
  links?: Record<string, string>;
  onPlay?: (query: string) => void;
  onOpenArtist?: (query: string) => void;
  t?: Strings;
}) {
  if (!text.includes("[[")) return <>{spoken(text, "q")}</>;

  const parts: Part[] = [];
  let last = 0;

  for (const match of text.matchAll(LINK)) {
    const kind = match[1] as "artist" | "song" | undefined;
    const term = match[2].trim();
    if (match.index! > last) parts.push(text.slice(last, match.index));
    const href =
      links?.[term] ??
      `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(term)}`;
    parts.push({ term, href, kind });
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return (
    <>
      {parts.map((part, i) =>
        typeof part === "string" ? (
          spoken(part, `q${i}`)
        ) : (
          <span key={i} className="entity-wrap">
            <a
              className="entity"
              href={part.href}
              target="_blank"
              rel="noreferrer"
              // The note itself is a seek target; following a link should not also
              // jump the track.
              onClick={(e) => e.stopPropagation()}
            >
              {part.term}
            </a>
            {/* The name reads about it; the button acts on it. Keeping them separate
                means a click to read never starts music by accident. */}
            {part.kind === "song" && onPlay && (
              <button
                className="act"
                title={t ? t.playThis(part.term) : `Play ${part.term}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onPlay(part.term);
                }}
              >
                ▶
              </button>
            )}
            {part.kind === "artist" && onOpenArtist && (
              <button
                className="act"
                title={t ? t.openArtist(part.term) : `Open ${part.term} on Spotify`}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenArtist(part.term);
                }}
              >
                ↗
              </button>
            )}
          </span>
        ),
      )}
    </>
  );
}
