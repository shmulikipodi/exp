// Notes survive the tab now. Two reasons: you can go back to a song you heard while
// you were in another room, and re-reading a track no longer costs a model call —
// which matters a lot on a free-tier key.

export type Stored = {
  id: string;
  lang: string;
  title: string;
  artists: string[];
  album: string;
  art: string;
  at: number; // when it was first written
  notes: unknown; // the Notes payload, opaque to this module
};

const INDEX = "ln.history";
const ITEM = (id: string, lang: string) => `ln.n.${id}.${lang}`;
const LIMIT = 250;

type Entry = Omit<Stored, "notes">;

function readIndex(): Entry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(INDEX) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeIndex(entries: Entry[]) {
  try {
    localStorage.setItem(INDEX, JSON.stringify(entries));
  } catch {
    /* quota — the eviction in save() is what keeps this from happening */
  }
}

/** Most recently played first. One row per track per language. */
export function history(): Entry[] {
  return readIndex();
}

export function loadNotes(id: string, lang: string): unknown | null {
  try {
    const raw = localStorage.getItem(ITEM(id, lang));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveNotes(entry: Entry, notes: unknown) {
  const rest = readIndex().filter((e) => !(e.id === entry.id && e.lang === entry.lang));
  const next = [entry, ...rest];

  // Oldest entries fall off the end rather than letting localStorage throw.
  for (const gone of next.splice(LIMIT)) {
    try {
      localStorage.removeItem(ITEM(gone.id, gone.lang));
    } catch {
      /* nothing to do if it's already gone */
    }
  }

  try {
    localStorage.setItem(ITEM(entry.id, entry.lang), JSON.stringify(notes));
    writeIndex(next);
  } catch {
    // Out of room: drop the oldest half and try once more.
    const keep = next.slice(0, Math.floor(next.length / 2));
    for (const gone of next.slice(keep.length)) {
      try {
        localStorage.removeItem(ITEM(gone.id, gone.lang));
      } catch {
        /* already gone */
      }
    }
    try {
      localStorage.setItem(ITEM(entry.id, entry.lang), JSON.stringify(notes));
      writeIndex([entry, ...keep.filter((e) => e.id !== entry.id || e.lang !== entry.lang)]);
    } catch {
      /* give up quietly — history is a convenience, not the product */
    }
  }
}

export function forget(id: string, lang: string) {
  try {
    localStorage.removeItem(ITEM(id, lang));
  } catch {
    /* already gone */
  }
  writeIndex(readIndex().filter((e) => !(e.id === id && e.lang === lang)));
}

export function clearHistory() {
  for (const e of readIndex()) {
    try {
      localStorage.removeItem(ITEM(e.id, e.lang));
    } catch {
      /* already gone */
    }
  }
  writeIndex([]);
}

/** Seeds the session thread from what has actually been read, newest first. */
export function recentStamps(limit = 8): string[] {
  return history()
    .slice(0, limit)
    .map((e) => `${e.artists.join(", ")} — ${e.title}`);
}
