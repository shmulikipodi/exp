// Notes live in IndexedDB. localStorage caps out around 5MB, which is a few thousand
// notes at best; IndexedDB is measured in hundreds of megabytes, so the cap stops
// being something to think about. The index is mirrored in memory so the history list
// and the "do we already have this?" check stay synchronous.

export type Entry = {
  id: string;
  lang: string;
  title: string;
  artists: string[];
  album: string;
  art: string;
  at: number;
};

const DB_NAME = "exp";
const STORE = "notes";
const LIMIT = 20000;

const key = (id: string, lang: string) => `${id}:${lang}`;

let db: IDBDatabase | null = null;
let index: Entry[] = [];
let readyPromise: Promise<void> | null = null;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Anything written before the move to IndexedDB comes across on first run. */
async function migrateFromLocalStorage(store: IDBObjectStore) {
  let legacy: Entry[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem("ln.history") ?? "[]");
    legacy = Array.isArray(raw) ? raw : [];
  } catch {
    return;
  }
  if (legacy.length === 0) return;

  for (const entry of legacy) {
    try {
      const raw = localStorage.getItem(`ln.n.${entry.id}.${entry.lang}`);
      if (!raw) continue;
      store.put({ key: key(entry.id, entry.lang), entry, notes: JSON.parse(raw) });
      localStorage.removeItem(`ln.n.${entry.id}.${entry.lang}`);
    } catch {
      /* one unreadable row shouldn't stop the rest */
    }
  }
  localStorage.removeItem("ln.history");
}

export function ready(): Promise<void> {
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    try {
      db = await openDb();
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      await migrateFromLocalStorage(store);
      const rows = await request(store.getAll());
      index = rows
        .map((r: { entry: Entry }) => r.entry)
        .filter(Boolean)
        .sort((a, b) => b.at - a.at);
    } catch {
      // Private-browsing modes can refuse IndexedDB outright. The app still works;
      // it just forgets, exactly as it did before any of this existed.
      db = null;
      index = [];
    }
  })();

  return readyPromise;
}

/** Most recently written first. Synchronous — mirrors what is in the database. */
export function history(): Entry[] {
  return index;
}

export async function loadNotes(id: string, lang: string): Promise<unknown | null> {
  await ready();
  if (!db) return null;
  try {
    const row = await request(
      db.transaction(STORE, "readonly").objectStore(STORE).get(key(id, lang)),
    );
    return (row as { notes?: unknown } | undefined)?.notes ?? null;
  } catch {
    return null;
  }
}

/**
 * `indexed: false` writes the notes without listing the track in history. The queue
 * prefetch uses it: those notes are for a song that has not been played yet, and a
 * panel headed "what you've heard" should not be listing songs you haven't.
 */
export async function saveNotes(entry: Entry, notes: unknown, indexed = true): Promise<void> {
  await ready();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put({ key: key(entry.id, entry.lang), entry, notes });
    if (!indexed) return;

    index = [entry, ...index.filter((e) => !(e.id === entry.id && e.lang === entry.lang))];

    // A ceiling this high is really just a guard against something pathological.
    for (const gone of index.splice(LIMIT)) {
      store.delete(key(gone.id, gone.lang));
    }
  } catch {
    /* storage is a convenience, not the product */
  }
}

export async function forget(id: string, lang: string): Promise<void> {
  await ready();
  index = index.filter((e) => !(e.id === id && e.lang === lang));
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).delete(key(id, lang));
  } catch {
    /* already gone */
  }
}

export async function clearHistory(): Promise<void> {
  await ready();
  index = [];
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).clear();
  } catch {
    /* already empty */
  }
}

/** What the browser thinks we're using, for the history panel's footer. */
export async function usage(): Promise<{ count: number; mb: number }> {
  await ready();
  let mb = 0;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage) mb = est.usage / (1024 * 1024);
  } catch {
    /* not supported — the count alone is still useful */
  }
  return { count: index.length, mb };
}

/** Seeds the session thread from what has actually been read, newest first. */
export function recentStamps(limit = 8): string[] {
  return index.slice(0, limit).map((e) => `${e.artists.join(", ")} — ${e.title}`);
}

/** Marks a track as actually heard. Prefetched notes are only listed once played. */
export async function touch(entry: Entry): Promise<void> {
  await ready();
  const already = index.find((e) => e.id === entry.id && e.lang === entry.lang);
  if (already && already.at >= entry.at) return;
  index = [entry, ...index.filter((e) => !(e.id === entry.id && e.lang === entry.lang))];
  if (!db) return;
  try {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    const req = store.get(key(entry.id, entry.lang));
    req.onsuccess = () => {
      const row = req.result as { notes?: unknown } | undefined;
      if (row) store.put({ key: key(entry.id, entry.lang), entry, notes: row.notes });
    };
  } catch {
    /* the in-memory index is already right; the row will catch up on the next write */
  }
}
