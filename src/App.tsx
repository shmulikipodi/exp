import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clientId,
  queueNext,
  recentlyPlayed,
  trackDetails,
  next as skipNext,
  playSearch,
  resumeAt,
  spotifySearchUrl,
  transferTo,
  pause,
  play,
  previous as skipPrev,
  seek,
  completeLogin,
  isConnected,
  login,
  logout,
  nowPlaying,
  redirectUri,
  setClientId,
  type Playing,
} from "./spotify";
import { STRINGS, storedLang, storeLang, type Lang } from "./i18n";
import { accentFrom, paletteFrom, type Swatch } from "./palette";
import { dividerWidth, grabOffset, matchesLang, schedule } from "./notes-logic";
import { Keys, liveKeys } from "./Keys";
import { onPlayer, startPlayer, type PlayerState } from "./player";
import { History } from "./History";
import { Linked } from "./Linked";
import { Lyrics } from "./Lyrics";
import { Wash } from "./Wash";
import { RAIL_ICONS, RAIL_ORDER } from "./RailIcons";
import { Lineage } from "./Lineage";
import { Rail, type RailMode } from "./Rail";
import { Settings } from "./Settings";
import {
  type Entry,
  forget,
  touch,
  history as readHistory,
  loadNotes,
  ready as storeReady,
  recentStamps,
  saveNotes,
} from "./store";
import "./App.css";

type Note = {
  kind: string;
  at: number | null;
  atBasis?: "documented" | "estimated" | "heard" | null;
  title: string;
  body: string;
};
type Answer = {
  id: string;
  question: string;
  about: string | null;
  body: string;
  sources?: [string, string][];
};
type Notes = {
  headline: string;
  notes: Note[];
  thread: string | null;
  confidence: "high" | "low";
  sources: [string, string][];
  live: boolean;
  evidence: boolean;
  links?: Record<string, string>;
  answers?: Answer[];
  rejected?: string[];
};

const TICK_MS = 250;

// Spotify is only asked as often as it's likely to have something new to say.
// Mid-song nothing changes, so we idle; near the end of a track a change is
// imminent, so we watch closely and catch it inside a second.
// Long enough that skipping through a queue costs nothing, short enough that settling
// on a track feels immediate.
const SETTLE_MS = 2500;

const POLL_IDLE_MS = 4000;
const POLL_PLAYING_MS = 3000;
const POLL_ENDING_MS = 900;
const ENDING_WINDOW_MS = 12000;

function pollDelay(p: Playing | null, progress: number): number {
  if (!p || !p.isPlaying) return POLL_IDLE_MS;
  const left = p.durationMs - progress;
  return left <= ENDING_WINDOW_MS ? POLL_ENDING_MS : POLL_PLAYING_MS;
}

// ?demo=1 runs the real notes pipeline against a fixed track, no Spotify needed.
// Playback is sped up so the timed reveal can actually be watched.
const DEMO = new URLSearchParams(location.search).has("demo");
const DEMO_SPEED = 30;
const DEMO_TRACK: Playing = {
  id: "demo",
  isrc: "GBAWA0378243",
  albumId: "",
  artistId: "",
  title: "Maggot Brain",
  artists: ["Funkadelic"],
  album: "Maggot Brain",
  released: "1971-07-12",
  art: "https://upload.wikimedia.org/wikipedia/en/9/9a/Maggot_Brain_%28Funkadelic_album_-_cover_art%29.jpg?utm_source=en.wikipedia.org&utm_campaign=imageinfo&utm_content=original",
  durationMs: 601000,
  progressMs: 0,
  isPlaying: true,
};

/**
 * What has already been said about a band, kept per artist. Band history is true of
 * every track they ever made, so without a memory the same story arrives on each one —
 * which is the thing that makes a good fact tiresome.
 */
const toldKey = (artist: string) => `ln.told.${artist.trim().toLowerCase()}`;

function readTold(artist: string): string[] {
  if (!artist) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(toldKey(artist)) ?? "[]");
    return Array.isArray(raw) ? raw.slice(-30) : [];
  } catch {
    return [];
  }
}

function rememberTold(artist: string, notes: { kind: string; title: string; body: string }[]) {
  // Every note, not only the ones tagged as band history. Hearing Dreams and then The
  // Chain produced the keyboardist's death and Stevie Nicks refusing a reunion both
  // times — neither was tagged "lore", so neither was remembered. Anything true of the
  // band rather than the track will repeat unless all of it is written down.
  const fresh = notes.map((n) => `${n.title}: ${n.body.slice(0, 180)}`);
  if (!artist || fresh.length === 0) return;
  const merged = [...new Set([...readTold(artist), ...fresh])].slice(-30);
  try {
    localStorage.setItem(toldKey(artist), JSON.stringify(merged));
  } catch {
    /* a full store is not worth failing over */
  }
}

async function post<T>(payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await fetch("/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  // A cold start or a crashed function answers with an HTML error page, and
  // "Unexpected token 'A'" is a useless thing to show a reader.
  const body = await res.text();
  let data: T & { error?: string };
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(
      res.ok
        ? "The notes service returned something unreadable."
        : `The notes service is unavailable (${res.status}).`,
    );
  }
  if (data.error) throw new Error(data.error);
  return data;
}

/** Answers written before the language was enforced sit inside otherwise-valid entries.
 *  Dropping just those beats discarding a good set of notes along with them. */
function pruneAnswers(notes: Notes | null, lang: Lang): Notes | null {
  if (!notes || lang !== "he" || !notes.answers?.length) return notes;
  const kept = notes.answers.filter((a) => /[\u0590-\u05FF]/.test(a.body));
  return kept.length === notes.answers.length ? notes : { ...notes, answers: kept };
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function App() {
  const [lang, setLang] = useState<Lang>(storedLang());
  const [draft, setDraft] = useState(clientId());
  // What is actually stored, kept separate from what is being typed — setting state to
  // the value it already holds is a no-op, which is what silently broke Save.
  const [savedId, setSavedId] = useState(clientId());
  const [connected, setConnected] = useState(isConnected());
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [progress, setProgress] = useState(0);
  const [notes, setNotes] = useState<Notes | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revealAll, setRevealAll] = useState(false);
  const [accent, setAccent] = useState<string | null>(null);
  const [palette, setPalette] = useState<Swatch[]>([]);
  const [showKeys, setShowKeys] = useState(false);
  const [reload, setReload] = useState(0);
  const [keyCount, setKeyCount] = useState(liveKeys().length);
  const [wide, setWide] = useState(() => localStorage.getItem("ln.wide") === "1");
  // The phone keeps the sleeve: there are no columns there, the artwork is the whole
  // first screen and it collapses into a bar as you scroll. Only the desktop's first
  // column was a picture you could already see somewhere else.
  const [phone, setPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches,
  );
  const [player, setPlayer] = useState<PlayerState>({ status: "off" });
  const [upNext, setUpNext] = useState<{ label: string; headline: string } | null>(null);
  // null = we have not tried to control playback yet. false = this account can't.
  const [canControl, setCanControl] = useState<boolean | null>(null);
  const [controlNote, setControlNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [rails, setRails] = useState<RailMode[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("ln.rails") ?? "null");
      if (Array.isArray(saved)) return saved as RailMode[];
    } catch {
      /* first run, or something unparseable */
    }
    return ["lyrics"];
  });
  const [zoom, setZoom] = useState(() => Number(localStorage.getItem("ln.zoom") ?? 1) || 1);
  const [showSettings, setShowSettings] = useState(false);
  // Column widths, dragged by hand and remembered. Empty means "whatever the layout
  // would have chosen", so an untouched app looks the way it was designed to.
  const [sleeveW, setSleeveW] = useState(() => localStorage.getItem("ln.sleeveW") ?? "");
  const [railW, setRailW] = useState(() => localStorage.getItem("ln.railW") ?? "");
  // Temporary: four candidate type sets, switchable so they can be seen rather than
  // described. Once one is chosen the rest come out.
  const [typeSet, setTypeSet] = useState(() => localStorage.getItem("ln.type") ?? "a");
  const [historyCount, setHistoryCount] = useState(0);
  const [viewing, setViewing] = useState<{ entry: Entry; notes: Notes } | null>(null);
  const [busy, setBusy] = useState("");
  const [askingAbout, setAskingAbout] = useState<string | null>(null);
  const [draftQ, setDraftQ] = useState("");

  const history = useRef<string[]>([]);
  const fetchedFor = useRef<string>("");
  const cache = useRef(new Map<string, Notes>());
  const streamRef = useRef<HTMLElement | null>(null);
  const viewingRef = useRef<string>("");
  const pullRef = useRef<(() => Promise<void>) | null>(null);
  const queuedRef = useRef<Awaited<ReturnType<typeof queueNext>>>(null);
  const lastManual = useRef(0);
  // Where you were before a click in the family tree sent you somewhere else, so there
  // is a way back to it — at the second it was interrupted, in the queue it came from.
  const [detour, setDetour] = useState<{
    contextUri: string;
    id: string;
    title: string;
    positionMs: number;
  } | null>(null);

  const t = STRINGS[lang];

  useEffect(() => {
    localStorage.setItem("ln.rails", JSON.stringify(rails));
  }, [rails]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => setPhone(mq.matches);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // CSS zoom rather than a font-size scale: every size in this stylesheet is in px, so
  // scaling the root font would move nothing.
  //
  // But zoom scales the CSS pixel, which means 100dvh renders taller than the window —
  // at 1.2 the layout became 1080px inside a 900px screen and pushed the transport off
  // the bottom. So the full-height columns measure against a value that divides it back
  // out, and the window keeps its actual height at any zoom.
  useEffect(() => {
    const root = document.documentElement;
    root.style.zoom = String(zoom);
    localStorage.setItem("ln.zoom", String(zoom));

    const fit = () => root.style.setProperty("--app-h", `${window.innerHeight / zoom}px`);
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [zoom]);

  /**
   * Drag a divider. Width is measured from the stage edge the column is attached to,
   * which flips in Hebrew — otherwise dragging left would widen a column on the right.
   */
  const drag = useCallback(
    (which: "sleeve" | "rail") => (down: React.PointerEvent) => {
      down.preventDefault();
      const stage = down.currentTarget.parentElement as HTMLElement | null;
      if (!stage) return;
      const rtl = document.documentElement.dir === "rtl";

      // Everything here has to be in one unit, and zoom means there are two.
      // getBoundingClientRect and clientX are both in screen pixels; the width we then
      // write is a CSS length, which the page multiplies by the zoom again. At 1.2 the
      // column came back twenty percent wider than asked for, the divider ran away from
      // the cursor and the whole thing bolted to its limit — which is why dragging only
      // felt right at the default zoom. offsetWidth is the same box in CSS pixels, so
      // dividing the two gives the factor without having to know how zoom is spelt.
      const rect = stage.getBoundingClientRect();
      const scale = stage.offsetWidth > 0 ? rect.width / stage.offsetWidth : 1;

      const widthOf = (sel: string) =>
        (stage.querySelector(sel)?.getBoundingClientRect().width ?? 0) / scale;
      const boxOf = () => {
        const r = stage.getBoundingClientRect();
        return { left: r.left / scale, right: r.right / scale, width: r.width / scale };
      };

      const FIRST = ".lineage, .sleeve";
      const mine = which === "sleeve" ? FIRST : ".rail";
      const other = which === "sleeve" ? ".rail" : FIRST;
      const grab = grabOffset(which, rtl, down.clientX / scale, boxOf(), widthOf(mine));

      const move = (e: PointerEvent) => {
        const w = dividerWidth(which, rtl, e.clientX / scale, grab, boxOf(), widthOf(other));
        const set = which === "sleeve" ? setSleeveW : setRailW;
        set(`${w}px`);
        localStorage.setItem(which === "sleeve" ? "ln.sleeveW" : "ln.railW", `${w}px`);
      };

      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.classList.remove("dragging");
      };

      document.body.classList.add("dragging");
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [],
  );

  const toggleRail = useCallback((m: RailMode) => {
    setRails((open) => (open.includes(m) ? open.filter((x) => x !== m) : [...open, m]));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.type = typeSet;
    localStorage.setItem("ln.type", typeSet);
  }, [typeSet]);

  useEffect(() => {
    document.documentElement.dir = t.dir;
    document.documentElement.lang = lang;
  }, [lang, t.dir]);

  const toggleLang = useCallback(() => {
    setLang((l) => {
      const next: Lang = l === "he" ? "en" : "he";
      storeLang(next);
      return next;
    });
  }, []);

  useEffect(() => {
    storeReady().then(() => setHistoryCount(readHistory().length));
  }, []);

  useEffect(() => {
    completeLogin()
      .then((did) => did && setConnected(true))
      .catch((e) => setError(e.message));
  }, []);

  // Poll Spotify for truth; tick locally in between so the bar moves smoothly.
  // The loop reschedules itself, so the cadence can change without restarting it.
  const latest = useRef({ playing, progress });
  // Written after render, not during it: mutating a ref mid-render is not safe under
  // concurrent rendering, and oxlint has been saying so.
  useEffect(() => {
    latest.current = { playing, progress };
  });

  // What the reader is actually looking at, for work that finishes later.
  const onScreen = useRef<{ id: string; lang: string }>({ id: "", lang: "en" });
  useEffect(() => {
    onScreen.current = viewing
      ? { id: viewing.entry.id, lang: viewing.entry.lang }
      : { id: playing?.id ?? "", lang };
    viewingRef.current = viewing ? viewing.entry.id : "";
  }, [viewing, playing?.id, lang]);

  useEffect(() => {
    if (!connected && !DEMO) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const pull = async () => {
      if (!alive) return;

      if (DEMO) {
        setPlaying((prev) => prev ?? DEMO_TRACK);
        return;
      }
      try {
        const p = await nowPlaying();
        if (!alive) return;
        setPlaying(p);
        setProgress(p?.progressMs ?? 0);
        setError("");
      } catch (e) {
        if (!alive) return;
        const msg = (e as Error).message;
        setError(msg);
        if (msg === "session expired") setConnected(false);
      }
    };
    // When the app is the one that pressed the button, it does not have to wait for the
    // next scheduled poll to find out what happened.
    pullRef.current = pull;

    const loop = async () => {
      if (!alive) return;
      await pull();
      const { playing: cur, progress: at } = latest.current;
      timer = setTimeout(loop, DEMO ? 2000 : pollDelay(cur, at));
    };

    loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [connected]);

  // Local clock between polls, so the bar and the reveals stay smooth.
  useEffect(() => {
    const tick = setInterval(() => {
      setProgress((p) => {
        const cur = latest.current.playing;
        if (!cur?.isPlaying) return p;
        const next = p + TICK_MS * (DEMO ? DEMO_SPEED : 1);
        // The demo loops, so the preview shows a bar that is actually moving rather
        // than one frozen at 100%.
        if (DEMO) return next >= cur.durationMs ? 0 : next;
        // Never run past the end — the poll only corrects us every few seconds.
        return Math.min(next, cur.durationMs);
      });
    }, TICK_MS);
    return () => clearInterval(tick);
  }, []);

  // The thread has nothing to connect to on the first song of a session, so it starts
  // from what Spotify already knows you were listening to.
  useEffect(() => {
    if (!connected || DEMO || history.current.length > 0) return;

    const read = recentStamps();
    if (read.length > 0) {
      history.current = read;
      return;
    }

    let alive = true;
    recentlyPlayed()
      .then((recent) => {
        if (alive && history.current.length === 0) history.current = recent.slice(0, 8);
      })
      .catch(() => {
        /* history is a nicety — never block the app for it */
      });
    return () => {
      alive = false;
    };
  }, [connected]);

  // While this song plays, write the next one's notes. A track change then lands on a
  // cache hit instead of twenty seconds of "Reading the sleeve…".
  useEffect(() => {
    if (DEMO || !notes || !playing) return;
    let alive = true;
    setUpNext(null);

    let queued: Awaited<ReturnType<typeof queueNext>> = null;
    queueNext()
      .then((up) => {
        if (!alive || !up?.id) return;
        queued = up;
        queuedRef.current = up;
        setUpNext({ label: `${up.artists.join(", ")} — ${up.title}`, headline: "" });
      })
      .catch(() => {
        /* no queue is an ordinary state */
      });

    // Only worth writing the next track's notes once this one has been left playing.
    const timer = setTimeout(() => {
    (async () => {
      const up = queued ?? (await queueNext().catch(() => null));
      if (!alive || !up?.id) return;

      const key = `${up.id}:${lang}`;
      const already = cache.current.get(key);
      if (already) {
        setUpNext({ label: `${up.artists.join(", ")} — ${up.title}`, headline: already.headline });
        return;
      }

      const extra = await trackDetails(up.albumId, up.artistId).catch(() => ({
        label: "",
        genres: [] as string[],
        copyrights: [] as string[],
      }));
      if (!alive) return;

      const data = await post<Notes>({
        title: up.title,
        artists: up.artists,
        album: up.album,
        released: up.released,
        durationMs: up.durationMs,
        isrc: up.isrc,
        label: extra.label,
        genres: extra.genres,
        copyrights: extra.copyrights,
        recent: [`${playing.artists.join(", ")} — ${playing.title}`, ...history.current].slice(0, 5),
        lang,
        told: readTold(up.artists[0] ?? ""),
        keys: liveKeys(),
      }).catch(() => null);

      if (!alive || !data) return;
      cache.current.set(key, data);
      setUpNext({ label: `${up.artists.join(", ")} — ${up.title}`, headline: data.headline ?? "" });
      saveNotes(
        {
          id: up.id,
          lang,
          title: up.title,
          artists: up.artists,
          album: up.album,
          art: up.art,
          at: Date.now(),
        },
        data,
        false, // not heard yet — it is only next in the queue
      );
    })();
    }, 20_000);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [notes, playing?.id, lang]);

  // The in-tab player is parked. src/player.ts and the streaming scope are left in
  // place — removing the scope would force everyone through a fresh login — but the SDK
  // is not loaded and the button is not shown. Flip this to bring it back.
  const PLAYER_ENABLED = false;

  useEffect(() => onPlayer(setPlayer), []);

  useEffect(() => {
    if (!PLAYER_ENABLED || !connected || DEMO || canControl === false) return;
    startPlayer();
  }, [connected, canControl]);

  // The sleeve sets the page's accent colour, and the field of light behind everything.
  useEffect(() => {
    if (!playing?.art) {
      setAccent(null);
      setPalette([]);
      return;
    }
    let alive = true;
    const art = playing.art;
    accentFrom(art).then((h) => alive && setAccent(h));
    paletteFrom(art).then((p) => alive && setPalette(p));
    return () => {
      alive = false;
    };
  }, [playing?.art]);

  // New track → new notes.
  useEffect(() => {
    if (!playing) return;
    const key = `${playing.id}:${lang}`;
    if (key === fetchedFor.current) return;
    fetchedFor.current = key;
    setRevealAll(false);

    const stamp = `${playing.artists.join(", ")} — ${playing.title}`;
    const recent = history.current.slice(0, 5);
    history.current = [stamp, ...history.current.filter((h) => h !== stamp)].slice(0, 8);

    const inMemory = cache.current.get(key);
    if (inMemory && matchesLang(inMemory, lang)) {
      setNotes(inMemory);
      return;
    }
    if (inMemory) cache.current.delete(key);

    setNotes(null);
    setLoading(true);

    const abort = new AbortController();
    let settled = false;

    const timer = setTimeout(() => {
    (async () => {
      const stored = pruneAnswers((await loadNotes(playing.id, lang)) as Notes | null, lang);
      if (stored && matchesLang(stored, lang)) {
        cache.current.set(key, stored);
        // Prefetched notes are written unlisted; playing the track is what lists it.
        touch({
          id: playing.id,
          lang,
          title: playing.title,
          artists: playing.artists,
          album: playing.album,
          art: playing.art,
          at: Date.now(),
        }).then(() => setHistoryCount(readHistory().length));
        return stored;
      }
      if (stored) await forget(playing.id, lang); // wrong language — write it again

      // Label and genres are cheap and the model would otherwise guess at them.
      const extra = await trackDetails(playing.albumId, playing.artistId).catch(() => ({
        label: "",
        genres: [] as string[],
        copyrights: [] as string[],
      }));

      return post<Notes>({
        title: playing.title,
        artists: playing.artists,
        album: playing.album,
        released: playing.released,
        durationMs: playing.durationMs,
        isrc: playing.isrc,
        label: extra.label,
        genres: extra.genres,
        copyrights: extra.copyrights,
        recent,
        lang,
        wide,
        told: readTold(playing.artists[0] ?? ""),
        keys: liveKeys(),
      }, abort.signal);
    })()
      .then((data) => {
        settled = true;
        const fresh = !cache.current.has(key);
        cache.current.set(key, data);
        setNotes(data);
        if (!fresh) return;
        // saveNotes awaits the store opening before it touches the index, so reading
        // the count on the next line always saw the length from before the save.
        rememberTold(playing.artists[0] ?? "", data.notes ?? []);
        saveNotes(
          {
            id: playing.id,
            lang,
            title: playing.title,
            artists: playing.artists,
            album: playing.album,
            art: playing.art,
            at: Date.now(),
          },
          data,
        ).then(() => setHistoryCount(readHistory().length));
      })
      .catch((e) => {
        if (abort.signal.aborted) return; // the track changed; this answer is stale
        settled = true;
        setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    }, SETTLE_MS);

    return () => {
      clearTimeout(timer);
      abort.abort();
      // Nothing was written for this track, so it must not look as though it was.
      if (!settled) fetchedFor.current = "";
    };
  }, [playing?.id, lang, reload, wide]);

  // Reading from history reuses the whole player view — same sleeve, same notes, just
  // a track that isn't playing, with everything already revealed.
  const track: Playing | null = viewing
    ? {
        id: viewing.entry.id,
        isrc: "",
        albumId: "",
        artistId: "",
        title: viewing.entry.title,
        artists: viewing.entry.artists,
        album: viewing.entry.album,
        released: "",
        art: viewing.entry.art,
        durationMs: 0,
        progressMs: 0,
        isPlaying: false,
      }
    : playing;
  const activeNotes = viewing ? viewing.notes : notes;
  const openAll = revealAll || Boolean(viewing);

  const fraction = track?.durationMs ? Math.min(1, progress / track.durationMs) : 0;
  const times = useMemo(() => (activeNotes ? schedule(activeNotes.notes) : []), [activeNotes]);
  const shown = activeNotes
    ? activeNotes.notes.filter((_, i) => openAll || times[i] <= fraction)
    : [];
  const pending = activeNotes ? activeNotes.notes.length - shown.length : 0;
  const nextAt = activeNotes
    ? times.filter((t) => t > fraction).sort((a, b) => a - b)[0]
    : undefined;

  // Apple-Music-lyrics focus: whatever sits nearest the middle of the column is sharp,
  // everything else softens with distance. Written straight to the DOM because this
  // runs on every scroll frame and must never trigger a React render.
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    let frame = 0;

    const apply = () => {
      frame = 0;

      // Mobile hero: the sleeve owns the first screen, then collapses out of the way.
      // 0…1 across roughly one cover-height of scrolling. Read by the CSS; the cover
      // shrinks with a transform so the notes still scroll at a normal 1:1 rate.
      const stage = el.parentElement;
      if (stage) {
        const over = Math.max(1, window.innerWidth * 0.62);
        const c = Math.min(1, Math.max(0, el.scrollTop / over));
        stage.style.setProperty("--c", c.toFixed(3));
        // The controls sit on the picture, so they leave with it. A calc() on opacity
        // cannot also switch off pointer events, hence the flag.
        stage.dataset.collapsed = c > 0.8 ? "1" : "0";
      }

      const nodes = Array.from(el.querySelectorAll<HTMLElement>(".note"));
      if (nodes.length === 0) return;

      const box = el.getBoundingClientRect();
      const mid = box.top + box.height / 2;
      const distances = nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return Math.abs(r.top + r.height / 2 - mid) / box.height;
      });

      // Whichever note is closest to the middle is always fully sharp, even if it is
      // nowhere near the centre. Blur is a way of pointing at one thing — a screen
      // where everything is blurred points at nothing and just looks broken.
      let nearest = 0;
      for (let i = 1; i < distances.length; i++) {
        if (distances[i] < distances[nearest]) nearest = i;
      }

      nodes.forEach((node, i) => {
        if (i === nearest) {
          node.style.filter = "none";
          node.style.opacity = "1";
          return;
        }
        const d = distances[i];
        const blur = Math.min(4, Math.max(0.8, (d - 0.09) * 14));
        node.style.filter = `blur(${blur.toFixed(2)}px)`;
        node.style.opacity = String(Math.max(0.32, 1 - Math.max(0, d - 0.07) * 1.5));
      });
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    // Only a real gesture counts as taking control — a smooth programmatic scroll
    // fires "scroll" too, and must not look like the reader grabbing the wheel.
    const onIntent = () => {
      lastManual.current = Date.now();
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onIntent, { passive: true });
    el.addEventListener("touchstart", onIntent, { passive: true });
    window.addEventListener("resize", apply);
    apply();

    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onIntent);
      el.removeEventListener("touchstart", onIntent);
      window.removeEventListener("resize", apply);
      cancelAnimationFrame(frame);
    };
  }, [activeNotes, shown.length]);

  // A newly revealed note walks itself into focus, unless the reader is browsing.
  useEffect(() => {
    const el = streamRef.current;
    if (!el || shown.length === 0 || openAll) return;
    if (Date.now() - lastManual.current < 8000) return;
    // On a phone the sleeve owns the first screen. Auto-centring would scroll straight
    // past it and collapse the picture before it has been seen, so it waits until the
    // reader has scrolled into the notes themselves.
    if (window.innerWidth <= 900 && el.scrollTop < window.innerWidth * 0.72) return;
    const nodes = el.querySelectorAll<HTMLElement>(".note");
    nodes[nodes.length - 1]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [shown.length, revealAll]);

  // Notes are no longer a finished document — they can grow, shrink and be questioned.
  // Every change is written straight back to storage, so it survives the track change.
  /** The track an in-flight question belongs to, captured when it is asked. */
  const targetOf = useCallback((): Entry | null => {
    if (viewing) return viewing.entry;
    if (!playing) return null;
    return {
      id: playing.id,
      lang,
      title: playing.title,
      artists: playing.artists,
      album: playing.album,
      art: playing.art,
      at: Date.now(),
    };
  }, [viewing, playing, lang]);

  // Answers take twenty seconds. The track can change in that time, and writing the
  // result into whatever is on screen now would both lose the answer and replace the
  // new track's notes with the old track's. It always saves; it only redraws if the
  // reader is still looking at the thing they asked about.
  const persist = useCallback((next: Notes, target: Entry) => {
    cache.current.set(`${target.id}:${target.lang}`, next);
    saveNotes(target, next);
    if (onScreen.current.id !== target.id || onScreen.current.lang !== target.lang) return;
    if (target.id === viewingRef.current) setViewing((v) => (v ? { ...v, notes: next } : v));
    else setNotes(next);
  }, []);

  const subject = useCallback(() => {
    if (viewing) {
      return {
        title: viewing.entry.title,
        artists: viewing.entry.artists,
        album: viewing.entry.album,
        lang: viewing.entry.lang,
      };
    }
    return {
      title: playing?.title ?? "",
      artists: playing?.artists ?? [],
      album: playing?.album ?? "",
      released: playing?.released ?? "",
      isrc: playing?.isrc ?? "",
      lang,
    };
  }, [viewing, playing, lang]);

  const current = viewing ? viewing.notes : notes;

  const askMore = useCallback(async () => {
    const target = targetOf();
    if (!current || !target) return;
    setBusy("more");
    setError("");
    try {
      const data = await post<Notes>({
        ...subject(),
        mode: "more",
        have: current.notes.map((n) => ({ title: n.title, body: n.body })),
        rejected: current.rejected ?? [],
        wide,
        keys: liveKeys(),
      });
      const fresh = (data.notes ?? []).filter(
        (n) => !current.notes.some((existing) => existing.title === n.title),
      );
      if (fresh.length === 0) {
        setError(t.nothingMore);
      } else {
        persist({ ...current, notes: [...current.notes, ...fresh] }, target);
        setRevealAll(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }, [current, subject, persist, targetOf, t]);

  // Marking a note wrong removes it and records why, so a later regeneration is told
  // not to produce it again. The record of what it got wrong is the valuable half.
  const rejectNote = useCallback(
    (note: Note) => {
      const target = targetOf();
      if (!current || !target) return;
      persist(
        {
          ...current,
          notes: current.notes.filter((n) => n.title !== note.title),
          answers: (current.answers ?? []).filter((a) => a.about !== note.title),
          rejected: [...new Set([...(current.rejected ?? []), `${note.title}: ${note.body}`])],
        },
        target,
      );
    },
    [current, persist, targetOf],
  );

  const askTopic = useCallback(
    async (topic: "artist" | "album") => {
      const target = targetOf();
      // A second request while the first is in flight achieves nothing but spend.
      if (!current || !target || busy !== "") return;
      const who = viewing ? viewing.entry.artists.join(", ") : (playing?.artists ?? []).join(", ");
      const album = viewing ? viewing.entry.album : (playing?.album ?? "");
      const heading = topic === "artist" ? t.artistHeading(who) : t.albumHeading(album);

      setBusy(topic);
      setError("");
      try {
        const data = await post<{ answer: string; sources?: [string, string][] }>({
          ...subject(),
          mode: topic,
          artist: who,
          album,
          keys: liveKeys(),
        });
        persist(
          {
          ...current,
          answers: [
            // One answer per subject — asking twice replaces rather than stacks.
            ...(current.answers ?? []).filter((x) => x.about !== `topic:${topic}`),
            {
              id: `${Date.now()}`,
              question: heading,
              about: `topic:${topic}`,
              body: data.answer,
              sources: data.sources ?? [],
            },
          ],
          },
          target,
        );
        requestAnimationFrame(() => {
          const el = streamRef.current;
          el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy("");
      }
    },
    [current, subject, persist, targetOf, viewing, playing, busy, t],
  );

  // The model can place a moment to within a few seconds; a listener can place it
  // exactly. Pressing this while the thing is happening is the only way to be certain,
  // and it sticks — the note is saved where you heard it.
  const setNoteHere = useCallback(
    (note: Note) => {
      const target = targetOf();
      if (!current || !target || !playing?.durationMs) return;
      const at = Math.min(1, Math.max(0, latest.current.progress / playing.durationMs));
      persist(
        {
          ...current,
          notes: current.notes.map((n) =>
            n.title === note.title ? { ...n, at, atBasis: "heard" as const } : n,
          ),
        },
        target,
      );
    },
    [current, persist, targetOf, playing?.durationMs],
  );

  const ask = useCallback(
    async (question: string, about: Note | null) => {
      const target = targetOf();
      if (!current || !target || !question.trim()) return;
      const tag = about ? about.title : "general";
      setBusy(tag);
      setError("");
      try {
        const data = await post<{ answer: string; sources?: [string, string][] }>({
          ...subject(),
          mode: "ask",
          question: question.trim(),
          about: about ? { title: about.title, body: about.body } : null,
          keys: liveKeys(),
        });
        persist(
          {
            ...current,
            answers: [
              ...(current.answers ?? []),
              {
                id: `${Date.now()}`,
                question: question.trim(),
                about: about ? about.title : null,
                body: data.answer,
                sources: data.sources ?? [],
              },
            ],
          },
          target,
        );
        setDraftQ("");
        setAskingAbout(null);
        if (!about) {
          // Answers about the record collect at the end — take the reader to it.
          requestAnimationFrame(() => {
            const el = streamRef.current;
            el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          });
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy("");
      }
    },
    [current, subject, persist, targetOf],
  );

  // Quota exhaustion is the one failure a user can actually act on, so it gets said
  // in plain language instead of relaying Google's paragraph of URLs.
  const shownError = /quota|exhausted|rate limit|429/i.test(error) ? t.quota : error;

  // New keys mean the track that just failed deserves another go.
  const closeKeys = useCallback((changed: boolean) => {
    setShowKeys(false);
    if (!changed) return;
    setKeyCount(liveKeys().length);
    cache.current.clear();
    fetchedFor.current = "";
    setError("");
    setReload((r) => r + 1);
  }, []);

  // Every control funnels through here so the free-account and stale-scope cases are
  // handled once. Spotify answers 403 for both, and they need opposite responses.
  // Spotify only refuses outright for a free account; everything else is a device
  // problem the buttons can still try to solve.
  const locked = canControl === false;

  /** Go somewhere the family tree pointed, remembering where you were standing. */
  const wander = useCallback(
    (query: string) => {
      const now = latest.current.playing;
      if (now?.id) {
        setDetour({
          contextUri: now.contextUri ?? "",
          id: now.id,
          title: now.title,
          positionMs: latest.current.progress ?? now.progressMs ?? 0,
        });
      }
      run(() => playSearch(query));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const goBack = useCallback(() => {
    const back = detour;
    if (!back) return;
    setDetour(null);
    run(() => resumeAt(back.contextUri, back.id, back.positionMs));
  }, [detour]);

  const run = useCallback(async (action: () => Promise<string>, optimistic?: () => void) => {
    const before = latest.current.playing;
    optimistic?.();
    // The demo has no Spotify behind it; the optimistic move IS the behaviour.
    if (DEMO) return;
    const result = await action();
    if (result === "ok") {
      setCanControl(true);
      setControlNote("");
      // Spotify takes a moment to report a change it has just been told to make, so
      // ask now and again shortly after rather than waiting out the poll interval.
      pullRef.current?.();
      setTimeout(() => pullRef.current?.(), 600);
      setTimeout(() => pullRef.current?.(), 1800);
      return;
    }
    if (result === "premium-required") {
      setCanControl(false);
      setControlNote(t.freeAccount);
    } else if (result === "needs-reconnect") {
      setControlNote(t.reconnect);
    } else if (result === "no-device") {
      setControlNote(t.noDevice);
    } else {
      setControlNote("");
    }
    // The optimistic guess was wrong. Put it back rather than leaving a paused-looking
    // button on a playing track until the next poll happens to correct it.
    if (before) setPlaying(before);
  }, [t]);

  // A song named in a note is a song you can hear; an artist is a page you can open.
  const playNamed = useCallback(
    (query: string) => {
      const who = (playing?.artists ?? []).join(" ");
      run(() => playSearch(`${query} ${who}`.trim()));
    },
    [playing, run],
  );

  const openArtist = useCallback((query: string) => {
    window.open(spotifySearchUrl(query, "artist"), "_blank", "noreferrer");
  }, []);

  const playHere = useCallback(async () => {
    if (player.status !== "ready") return;
    await run(() => transferTo(player.deviceId));
  }, [player, run]);

  const save = useCallback(() => {
    const next = draft.trim();
    if (!next) return;
    setClientId(next);
    setSavedId(next);
  }, [draft]);

  // One copy. It was pasted into all three screens, and two of the three had picked up
  // broken indentation on the way — the usual evidence of copy-paste.
  const chrome = (
    <>
      <div className="controls">
        <button
          className="gear"
          title={t.settingsOpen}
          aria-label={t.settingsOpen}
          onClick={() => setShowSettings(true)}
        >
          ☰
        </button>
      </div>
      {showSettings && (
        <Settings
          t={t}
          onClose={() => setShowSettings(false)}
          toggleLang={toggleLang}
          typeSet={typeSet}
          setTypeSet={setTypeSet}
          zoom={zoom}
          setZoom={setZoom}
          openKeys={() => {
            setShowSettings(false);
            setShowKeys(true);
          }}
          openHistory={() => {
            setShowSettings(false);
            setShowHistory(true);
          }}
          historyCount={historyCount}
          keyCount={keyCount}
        />
      )}
      {showKeys && <Keys t={t} onClose={closeKeys} />}
      {showLyrics && track && (
        <Lyrics
          t={t}
          title={track.title}
          artist={track.artists[0] ?? ""}
          album={track.album}
          art={track.art}
          durationMs={track.durationMs}
          progressMs={progress}
          onSeek={(ms) => run(() => seek(ms), () => setProgress(ms))}
          onClose={() => setShowLyrics(false)}
        />
      )}
      {showHistory && (
        <History
          t={t}
          onOpen={(entry, notes) => {
            setViewing({ entry, notes: notes as Notes });
            setShowHistory(false);
            streamRef.current?.scrollTo({ top: 0 });
          }}
          onClose={() => {
            setShowHistory(false);
            setHistoryCount(readHistory().length);
          }}
        />
      )}
    </>
  );

  if (!savedId && !DEMO) {
    return (
      <main className="setup">
      {chrome}
        <h1>exp</h1>
        <p>{t.tagline}</p>
        <ol>
          <li>
            {t.setup1} <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">developer.spotify.com/dashboard</a>
          </li>
          <li>
            {t.setup2} <code dir="ltr">{redirectUri()}</code>
          </li>
          <li>{t.setup3a} <b>Web API</b>{t.setup3b}</li>
        </ol>
        <div className="row">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder={t.clientId}
            dir="ltr"
            spellCheck={false}
          />
          <button className="primary" onClick={save} disabled={!draft.trim()}>
            {t.save}
          </button>
        </div>
      </main>
    );
  }

  if (!connected && !DEMO) {
    return (
      <main className="setup">
      {chrome}
        <h1>exp</h1>
        <p>{t.connectPrompt}</p>
        {error && <p className="error">{shownError}</p>}
        <div className="row">
          <button className="primary" onClick={login}>{t.connect}</button>
          <button
            onClick={() => {
              localStorage.removeItem("ln.clientId");
              setDraft("");
              setSavedId("");
            }}
          >
            {t.changeId}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main
      className="app stage"
      style={
        {
          ...(accent ? { "--h": accent } : {}),
          ...(sleeveW ? { "--sleeve-w": sleeveW } : {}),
          ...(railW ? { "--rail-w": railW } : {}),
        } as React.CSSProperties
      }
    >
      {chrome}
      <Wash art={track?.art} colors={palette} page />

      {!track && (
        <div className="idle">
          <h2>{t.idleTitle}</h2>
          <p>{t.idleBody}</p>
          {error && <p className="error">{shownError}</p>}
        </div>
      )}

      {track && (
        <>
          <div className="columns">
          {phone ? (
            <section className="sleeve">
              {track.art && (
                <img
                  className="cover"
                  src={track.art}
                  alt=""
                  // Must match the crossOrigin of the palette sampler's request, or the
                  // browser caches a non-CORS copy and tainting kills colour extraction.
                  crossOrigin="anonymous"
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              )}
              <h1>{track.title}</h1>
              <p className="artist">
                <button
                  className={`link${busy === "artist" ? " busy" : ""}`}
                  disabled={!activeNotes || busy !== ""}
                  onClick={() => askTopic("artist")}
                >
                  {track.artists.join(", ")}
                </button>
              </p>
              <p className="album">
                <button
                  className={`link${busy === "album" ? " busy" : ""}`}
                  disabled={!activeNotes || busy !== ""}
                  onClick={() => askTopic("album")}
                >
                  {track.album}
                </button>
                {track.released && <span> · {track.released.slice(0, 4)}</span>}
              </p>




              {!viewing && upNext && (
                <p className="up-next">
                  <b>{t.upNext}</b> {upNext.label}
                  {upNext.headline && <span>{upNext.headline}</span>}
                </p>
              )}

              {PLAYER_ENABLED && !viewing && player.status !== "off" && (
                <p className="player-line">
                  {player.status === "loading" && t.playerStarting}
                  {player.status === "ready" && (
                    <button className="link" onClick={playHere}>
                      {t.playHere}
                    </button>
                  )}
                  {player.status === "unsupported" &&
                    (player.reason === "premium"
                      ? t.playerPremium
                      : player.reason === "reconnect"
                        ? t.playerReconnect
                        : player.reason)}
                </p>
              )}

              {controlNote && (
                <p className="control-note">
                  {controlNote}
                  {controlNote === t.reconnect && (
                    <button className="ghost" onClick={login}>
                      Spotify →
                    </button>
                  )}
                </p>
              )}
            </section>
          ) : (
            <Lineage
              t={t}
              title={track.title}
              artist={track.artists[0] ?? ""}
              album={track.album}
              released={track.released}
              isrc={track.isrc}
              onPlay={wander}
            />
          )}

          {(controlNote || (PLAYER_ENABLED && !viewing && player.status !== "off")) && (
            <div className="column-foot">
              {PLAYER_ENABLED && !viewing && player.status !== "off" && (
                <p className="player-line">
                  {player.status === "loading" && t.playerStarting}
                  {player.status === "ready" && (
                    <button className="link" onClick={playHere}>
                      {t.playHere}
                    </button>
                  )}
                  {player.status === "unsupported" &&
                    (player.reason === "premium"
                      ? t.playerPremium
                      : player.reason === "reconnect"
                        ? t.playerReconnect
                        : player.reason)}
                </p>
              )}
              {controlNote && (
                <p className="control-note">
                  {controlNote}
                  {controlNote === t.reconnect && (
                    <button className="ghost" onClick={login}>
                      Spotify →
                    </button>
                  )}
                </p>
              )}
            </div>
          )}

          {viewing && (
            <p className="from-history">
              {t.fromHistory}
              <button className="ghost" onClick={() => setViewing(null)}>
                {t.backToNow}
              </button>
            </p>
          )}

          <div
            className="grip"
            role="separator"
            aria-label={t.resize}
            onPointerDown={drag("sleeve")}
            onDoubleClick={() => {
              setSleeveW("");
              localStorage.removeItem("ln.sleeveW");
            }}
          />

          <section className="stream" ref={streamRef}>
            {loading && <p className="loading">{t.loading}</p>}

            {activeNotes && (
              <>
                {activeNotes.headline && (
                  <p className="headline">
                    <Linked
                      text={activeNotes.headline}
                      links={activeNotes.links}
                      onPlay={playNamed}
                      onOpenArtist={openArtist}
                      t={t}
                    />
                  </p>
                )}
                {activeNotes.thread && (
                  <p className="thread">
                    <b>{t.thread}</b> {activeNotes.thread}
                  </p>
                )}

                {shown.map((n, i) => {
                  // Only a note that names a moment is a place you can go. A note with
                  // no moment schedules at 0, which is "available from the start" — not
                  // "the song starts here".
                  const seekable =
                    n.at !== null && !viewing && canControl !== false && track.durationMs > 0;

                  return (
                  <article
                    key={`${n.title}-${i}`}
                    className={`note${seekable ? " seekable" : ""}`}
                    onClick={(e) => {
                      // The buttons inside a note do their own thing.
                      if ((e.target as HTMLElement).closest("button, a, input, form")) return;
                      if (!seekable) return;
                      const to = n.at! * track.durationMs;
                      run(() => seek(to), () => setProgress(to));
                    }}
                  >
                    <span className={`kind ${n.kind}`}>{t.kinds[n.kind] ?? n.kind}</span>
                    {n.at !== null && canControl !== false && !viewing && track.durationMs > 0 && (
                      <button
                        className={`jump${
                          n.atBasis === "documented" || n.atBasis === "heard" ? " sure" : ""
                        }`}
                        title={
                          n.atBasis === "documented" || n.atBasis === "heard"
                            ? t.jumpTo
                            : t.jumpToApprox
                        }
                        onClick={() => {
                          const target = n.at! * track.durationMs;
                          run(() => seek(target), () => setProgress(target));
                        }}
                      >
                        {mmss(n.at * track.durationMs)}
                      </button>
                    )}
                    <h3>{n.title}</h3>
                    <p>
                      <Linked
                        text={n.body}
                        links={activeNotes.links}
                        onPlay={playNamed}
                        onOpenArtist={openArtist}
                      t={t}
                      />
                    </p>

                    <div className="note-actions">
                      <button
                        onClick={() => {
                          setAskingAbout(askingAbout === n.title ? null : n.title);
                          setDraftQ("");
                        }}
                      >
                        {t.askAbout}
                      </button>
                      {!viewing && track.durationMs > 0 && (
                        <button title={t.setHereHint} onClick={() => setNoteHere(n)}>
                          {t.setHere}
                        </button>
                      )}
                      <button className="reject" onClick={() => rejectNote(n)}>
                        {t.markWrong}
                      </button>
                    </div>

                    {askingAbout === n.title && (
                      <form
                        className="ask"
                        onSubmit={(e) => {
                          e.preventDefault();
                          ask(draftQ, n);
                        }}
                      >
                        <input
                          autoFocus
                          value={draftQ}
                          placeholder={t.askPlaceholder}
                          onChange={(e) => setDraftQ(e.target.value)}
                        />
                        <button disabled={!draftQ.trim() || busy === n.title}>
                          {busy === n.title ? t.asking : t.askSend}
                        </button>
                      </form>
                    )}

                    {(activeNotes.answers ?? [])
                      .filter((a) => a.about === n.title)
                      .map((a) => (
                        <div className="answer" key={a.id}>
                          <p className="q">{a.question}</p>
                          <p>
                            <Linked
                            text={a.body}
                            links={activeNotes.links}
                            onPlay={playNamed}
                            onOpenArtist={openArtist}
                      t={t}
                          />
                          </p>
                          {(a.sources ?? []).length > 0 && (
                            <p className="sources">
                              {(a.sources ?? []).slice(0, 4).map(([url, title]) => (
                                <a key={url} href={url} target="_blank" rel="noreferrer">
                                  {title}
                                </a>
                              ))}
                            </p>
                          )}
                        </div>
                      ))}
                  </article>
                  );
                })}

                {(activeNotes.answers ?? [])
                  .filter((a) => a.about === null || String(a.about).startsWith("topic:"))
                  .map((a) => (
                    <div className={`answer standalone${String(a.about).startsWith("topic:") ? " topic" : ""}`} key={a.id}>
                      <p className="q">{a.question}</p>
                      <p>
                        <Linked
                            text={a.body}
                            links={activeNotes.links}
                            onPlay={playNamed}
                            onOpenArtist={openArtist}
                      t={t}
                          />
                      </p>
                      {(a.sources ?? []).length > 0 && (
                        <p className="sources">
                          {(a.sources ?? []).slice(0, 4).map(([url, title]) => (
                            <a key={url} href={url} target="_blank" rel="noreferrer">
                              {title}
                            </a>
                          ))}
                        </p>
                      )}
                    </div>
                  ))}

                <div className="conversation">
                  <div className="row">
                    <button onClick={askMore} disabled={busy === "more"}>
                      {busy === "more" ? t.thinking : t.moreNotes}
                    </button>
                    <button
                      className={`toggle${wide ? " on" : ""}`}
                      title={t.wideHint}
                      onClick={() => {
                        const next = !wide;
                        setWide(next);
                        localStorage.setItem("ln.wide", next ? "1" : "0");
                        // The notes were written from a narrower set of sources, so they
                        // are worth writing again.
                        cache.current.clear();
                        fetchedFor.current = "";
                        setReload((r) => r + 1);
                      }}
                    >
                      {wide ? t.wideOn : t.wideOff}
                    </button>
                  </div>
                  <form
                    className="ask"
                    onSubmit={(e) => {
                      e.preventDefault();
                      ask(draftQ, null);
                      setAskingAbout(null);
                    }}
                  >
                    <input
                      value={askingAbout === null ? draftQ : ""}
                      placeholder={t.askGeneral}
                      onChange={(e) => {
                        setAskingAbout(null);
                        setDraftQ(e.target.value);
                      }}
                    />
                    <button disabled={!draftQ.trim() || busy === "general"}>
                      {busy === "general" ? t.asking : t.askSend}
                    </button>
                  </form>
                </div>

                {pending > 0 && (
                  <div className="pending">
                    <span>
                      {t.more(pending)}
                      {nextAt !== undefined && track.durationMs
                        ? t.nextAt(mmss(nextAt * track.durationMs))
                        : ""}
                    </span>
                    <button onClick={() => setRevealAll(true)}>{t.revealAll}</button>
                  </div>
                )}

                <footer>
                  {activeNotes.confidence === "low" && <p className="warn">{t.lowConfidence}</p>}
                  {!activeNotes.live && !activeNotes.evidence && <p className="warn">{t.noEvidence}</p>}
                  {activeNotes.sources.length > 0 && (
                    <p className="sources">
                      {activeNotes.sources.slice(0, 6).map(([url, title]) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer">
                          {title}
                        </a>
                      ))}
                    </p>
                  )}
                  <button className="ghost" onClick={() => { logout(); setConnected(false); }}>
                    {t.disconnect}
                  </button>
                </footer>
              </>
            )}

            {error && <p className="error">{shownError}</p>}
          </section>

          {rails.length > 0 && (
            <div
              className="grip"
              role="separator"
              aria-label={t.resize}
              onPointerDown={drag("rail")}
              onDoubleClick={() => {
                setRailW("");
                localStorage.removeItem("ln.railW");
              }}
            />
          )}

          {rails.length > 0 && (
            <Rail
              t={t}
              modes={rails}
              toggle={toggleRail}
              title={track.title}
              artist={track.artists[0] ?? ""}
              album={track.album}
              albumId={track.albumId}
              artistId={track.artistId}
              trackId={track.id}
              durationMs={track.durationMs}
              progressMs={progress}
              lang={lang}
              artistText={
                (activeNotes?.answers ?? []).find((a) => a.about === "topic:artist")?.body
              }
              albumText={
                (activeNotes?.answers ?? []).find((a) => a.about === "topic:album")?.body
              }
              onAsk={askTopic}
              onSeek={(ms) => run(() => seek(ms), () => setProgress(ms))}
              onExpand={() => setShowLyrics(true)}
            />
          )}
          </div>

          <div className="playerbar">
            <div className="pb-track">
              {track.art && <img src={track.art} alt="" crossOrigin="anonymous" />}
              <span>
                <b>{track.title}</b>
                <span>{track.artists.join(", ")}</span>
              </span>
            </div>

            <div className="pb-mid">
              {/* Always here. It used to vanish the moment Spotify refused a command,
                  which is how the controls "disappeared": a row of buttons that is not
                  there tells you nothing, and a disabled one tells you why. */}
              <div className="transport" dir="ltr">
                  {detour && (
                    <button
                      className="back"
                      title={t.backTo(detour.title)}
                      aria-label={t.backTo(detour.title)}
                      onClick={goBack}
                    >
                      <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
                        <path
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9 5 3 11l6 6M3 11h10a7 7 0 0 1 0 14h-1"
                        />
                      </svg>
                    </button>
                  )}
                  <button disabled={locked} aria-label={t.prevTrack} onClick={() => run(skipPrev)}>
                    <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
                      <path fill="currentColor" d="M7 6h2v12H7zm10 0v12l-8-6z" />
                    </svg>
                  </button>
                  <button
                    className="big"
                    disabled={locked}
                    title={locked ? controlNote || t.freeAccount : t.playPause}
                    aria-label={t.playPause}
                    onClick={() =>
                      run(
                        track.isPlaying ? pause : play,
                        () => setPlaying((p) => (p ? { ...p, isPlaying: !p.isPlaying } : p)),
                      )
                    }
                  >
                    {track.isPlaying ? (
                      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
                        <path fill="currentColor" d="M7 5h4v14H7zm6 0h4v14h-4z" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
                        <path fill="currentColor" d="M8 5l11 7-11 7z" />
                      </svg>
                    )}
                  </button>
                  <button
                    disabled={locked}
                    aria-label={t.nextTrack}
                    onClick={() =>
                      run(skipNext, () => {
                        // The queued track and its notes are already in hand, so the
                        // change can be shown before Spotify confirms it.
                        const up = queuedRef.current;
                        if (!up?.id) return;
                        setPlaying({
                            ...up,
                            progressMs: 0,
                            isPlaying: true,
                        });
                        setProgress(0);
                        setUpNext(null);
                      })
                    }
                  >
                    <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
                      <path fill="currentColor" d="M15 6h2v12h-2zM7 6l8 6-8 6z" />
                    </svg>
                  </button>
              </div>
              <div className="pb-line">
                <span className="pb-time">{mmss(progress)}</span>
                <div
                  className="bar"
                  dir="ltr"
                  onClick={(e) => {
                    if (canControl === false || viewing || !track.durationMs) return;
                    const box = e.currentTarget.getBoundingClientRect();
                    const at = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
                    const target = at * track.durationMs;
                    run(() => seek(target), () => setProgress(target));
                  }}
                >
                  <div className="fill" style={{ width: `${fraction * 100}%` }} />
                  {(activeNotes?.notes ?? []).map((n, i) =>
                    n.at === null ? null : (
                      <span
                        key={i}
                        className={`pip${n.at <= fraction ? " lit" : ""}${
                          n.atBasis === "documented" || n.atBasis === "heard" ? " sure" : ""
                        }`}
                        style={{ left: `${n.at * 100}%` }}
                        title={n.title}
                      />
                    ),
                  )}
                </div>
                <p className="time" dir="ltr">
                  {mmss(progress)} <span>/ {mmss(track.durationMs)}</span>
                </p>
                <span className="pb-time">{mmss(track.durationMs)}</span>
              </div>
            </div>

            <div className="pb-end">
              {upNext && <span className="pb-next">{t.upNext} {upNext.label}</span>}
              <div className="pb-panels">
                {RAIL_ORDER.map((id) => {
                  const open = rails.includes(id);
                  const label = { lyrics: t.railLyrics, queue: t.railQueue, artist: t.railArtist, album: t.railAlbum }[id];
                  return (
                    <button
                      key={id}
                      className={open ? "on" : ""}
                      aria-pressed={open}
                      title={label}
                      aria-label={label}
                      onClick={() => toggleRail(id)}
                    >
                      {RAIL_ICONS[id]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

        </>
      )}
    </main>
  );
}
