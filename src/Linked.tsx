import type { Strings } from "./i18n";
// Note text arrives with [[names]] marked and a map of where each one goes, resolved
// against Wikipedia on the server. The model never writes a URL — it only says which
// words are worth looking up.

const LINK = /\[\[(?:(artist|song):)?([^\]|]{2,60})(?:\|[^\]]{2,80})?\]\]/g;

type Part = string | { term: string; href: string; kind?: "artist" | "song" };

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
  if (!text.includes("[[")) return <>{text}</>;

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
          part
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
