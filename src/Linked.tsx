// Note text arrives with [[names]] marked and a map of where each one goes, resolved
// against Wikipedia on the server. The model never writes a URL — it only says which
// words are worth looking up.

const LINK = /\[\[([^\]]{2,60})\]\]/g;

export function Linked({ text, links }: { text: string; links?: Record<string, string> }) {
  if (!text.includes("[[")) return <>{text}</>;

  const parts: (string | { term: string; href: string })[] = [];
  let last = 0;

  for (const match of text.matchAll(LINK)) {
    const term = match[1].trim();
    if (match.index! > last) parts.push(text.slice(last, match.index));
    const href =
      links?.[term] ??
      `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(term)}`;
    parts.push({ term, href });
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return (
    <>
      {parts.map((part, i) =>
        typeof part === "string" ? (
          part
        ) : (
          <a
            key={i}
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
        ),
      )}
    </>
  );
}
