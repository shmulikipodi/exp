import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clientId,
  queueNext,
  recentlyPlayed,
  trackDetails,
  next as skipNext,
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
import { accentFrom } from "./palette";
import { Keys, liveKeys } from "./Keys";
import { History } from "./History";
import { history as readHistory, loadNotes, recentStamps, saveNotes, type Stored } from "./store";
import "./App.css";

type Note = { kind: string; at: number | null; title: string; body: string };
type Notes = {
  headline: string;
  notes: Note[];
  thread: string | null;
  confidence: "high" | "low";
  sources: [string, string][];
  live: boolean;
  evidence: boolean;
};

const TICK_MS = 250;

// Spotify is only asked as often as it's likely to have something new to say.
// Mid-song nothing changes, so we idle; near the end of a track a change is
// imminent, so we watch closely and catch it inside a second.
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

/** Notes without a timestamp get spread through the first three quarters, in order. */
function schedule(notes: Note[]): number[] {
  const floating = notes.filter((n) => n.at === null).length;
  let seen = 0;
  return notes.map((n) => {
    if (n.at !== null) return n.at;
    const slot = floating === 1 ? 0.15 : 0.06 + (seen / (floating - 1)) * 0.62;
    seen++;
    return slot;
  });
}

async function requestNotes(payload: Record<string, unknown>): Promise<Notes> {
  const res = await fetch("/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  // A cold start or a crashed function answers with an HTML error page, and
  // "Unexpected token 'A'" is a useless thing to show a reader.
  const body = await res.text();
  let data: Notes & { error?: string };
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
  const [showKeys, setShowKeys] = useState(false);
  const [reload, setReload] = useState(0);
  const [keyCount, setKeyCount] = useState(liveKeys().length);
  // null = we have not tried to control playback yet. false = this account can't.
  const [canControl, setCanControl] = useState<boolean | null>(null);
  const [controlNote, setControlNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [historyCount, setHistoryCount] = useState(() => readHistory().length);
  const [viewing, setViewing] = useState<{ entry: Omit<Stored, "notes">; notes: Notes } | null>(null);

  const history = useRef<string[]>([]);
  const fetchedFor = useRef<string>("");
  const cache = useRef(new Map<string, Notes>());
  const streamRef = useRef<HTMLElement | null>(null);
  const lastManual = useRef(0);

  const t = STRINGS[lang];

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
    completeLogin()
      .then((did) => did && setConnected(true))
      .catch((e) => setError(e.message));
  }, []);

  // Poll Spotify for truth; tick locally in between so the bar moves smoothly.
  // The loop reschedules itself, so the cadence can change without restarting it.
  const latest = useRef({ playing, progress });
  latest.current = { playing, progress };

  useEffect(() => {
    if (!connected && !DEMO) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const loop = async () => {
      if (!alive) return;

      if (DEMO) {
        setPlaying((prev) => prev ?? DEMO_TRACK);
      } else {
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
      }

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
        // Never run past the end — the poll only corrects us every few seconds.
        return Math.min(p + TICK_MS * (DEMO ? DEMO_SPEED : 1), cur.durationMs);
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

    (async () => {
      const up = await queueNext().catch(() => null);
      if (!alive || !up?.id) return;

      const key = `${up.id}:${lang}`;
      if (cache.current.has(key)) return;

      const extra = await trackDetails(up.albumId, up.artistId).catch(() => ({
        label: "",
        genres: [] as string[],
      }));
      if (!alive) return;

      const data = await requestNotes({
        title: up.title,
        artists: up.artists,
        album: up.album,
        released: up.released,
        isrc: up.isrc,
        label: extra.label,
        genres: extra.genres,
        recent: [`${playing.artists.join(", ")} — ${playing.title}`, ...history.current].slice(0, 5),
        lang,
        keys: liveKeys(),
      }).catch(() => null);

      if (!alive || !data) return;
      cache.current.set(key, data);
      saveNotes(
        {
          id: up.id,
          lang,
          title: up.title,
          artists: up.artists,
          album: up.album,
          art: (up as { art?: string }).art ?? "",
          at: Date.now(),
        },
        data,
      );
    })();

    return () => {
      alive = false;
    };
  }, [notes, playing?.id, lang]);

  // The sleeve sets the page's accent colour.
  useEffect(() => {
    if (!playing?.art) return setAccent(null);
    let alive = true;
    accentFrom(playing.art).then((h) => alive && setAccent(h));
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

    const cached = cache.current.get(key) ?? (loadNotes(playing.id, lang) as Notes | null);
    if (cached) {
      cache.current.set(key, cached);
      setNotes(cached);
      return;
    }

    setNotes(null);
    setLoading(true);

    (async () => {
      // Label and genres are cheap and the model would otherwise guess at them.
      const extra = await trackDetails(playing.albumId, playing.artistId).catch(() => ({
        label: "",
        genres: [] as string[],
      }));

      return requestNotes({
        title: playing.title,
        artists: playing.artists,
        album: playing.album,
        released: playing.released,
        isrc: playing.isrc,
        label: extra.label,
        genres: extra.genres,
        recent,
        lang,
        keys: liveKeys(),
      });
    })()
      .then((data) => {
        cache.current.set(key, data);
        setNotes(data);
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
        );
        setHistoryCount(readHistory().length);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [playing?.id, lang, reload]);

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
        const over = Math.max(1, window.innerWidth * 0.72);
        const c = Math.min(1, Math.max(0, el.scrollTop / over));
        stage.style.setProperty("--c", c.toFixed(3));
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
  const run = useCallback(async (action: () => Promise<string>, optimistic?: () => void) => {
    optimistic?.();
    const result = await action();
    if (result === "ok") {
      setCanControl(true);
      setControlNote("");
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
    // Whatever we guessed optimistically was wrong — let the next poll correct it.
    setPlaying((p) => (p ? { ...p } : p));
  }, [t]);

  const save = useCallback(() => {
    const next = draft.trim();
    if (!next) return;
    setClientId(next);
    setSavedId(next);
  }, [draft]);

  if (!savedId && !DEMO) {
    return (
      <main className="setup">
        <div className="controls">
        <button onClick={() => setShowHistory(true)}>{t.historyButton(historyCount)}</button>
        <button onClick={() => setShowKeys(true)}>{t.keysButton(keyCount)}</button>
        <button onClick={toggleLang}>{t.other}</button>
      </div>
      {showKeys && <Keys t={t} onClose={closeKeys} />}
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
        <div className="controls">
        <button onClick={() => setShowHistory(true)}>{t.historyButton(historyCount)}</button>
        <button onClick={() => setShowKeys(true)}>{t.keysButton(keyCount)}</button>
        <button onClick={toggleLang}>{t.other}</button>
      </div>
      {showKeys && <Keys t={t} onClose={closeKeys} />}
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
    <main className="app stage" style={accent ? ({ "--h": accent } as React.CSSProperties) : undefined}>
      <div className="controls">
        <button onClick={() => setShowHistory(true)}>{t.historyButton(historyCount)}</button>
        <button onClick={() => setShowKeys(true)}>{t.keysButton(keyCount)}</button>
        <button onClick={toggleLang}>{t.other}</button>
      </div>
      {showKeys && <Keys t={t} onClose={closeKeys} />}
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
      {track?.art && <div className="wash" style={{ backgroundImage: `url(${track.art})` }} />}

      {!track && (
        <div className="idle">
          <h2>{t.idleTitle}</h2>
          <p>{t.idleBody}</p>
          {error && <p className="error">{shownError}</p>}
        </div>
      )}

      {track && (
        <>
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
            <p className="artist">{track.artists.join(", ")}</p>
            <p className="album">
              {track.album}
              {track.released && <span> · {track.released.slice(0, 4)}</span>}
            </p>
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
              {times.map((at, i) => (
                <span
                  key={i}
                  className={`pip ${at <= fraction ? "lit" : ""}`}
                  style={{ left: `${at * 100}%` }}
                />
              ))}
            </div>
            <p className="time" dir="ltr">
              {mmss(progress)} <span>/ {mmss(track.durationMs)}</span>
            </p>

            {canControl !== false && !viewing && (
              <div className="transport" dir="ltr">
                <button aria-label={t.prevTrack} onClick={() => run(skipPrev)}>
                  <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
                    <path fill="currentColor" d="M7 6h2v12H7zm10 0v12l-8-6z" />
                  </svg>
                </button>
                <button
                  className="big"
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
                <button aria-label={t.nextTrack} onClick={() => run(skipNext)}>
                  <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
                    <path fill="currentColor" d="M15 6h2v12h-2zM7 6l8 6-8 6z" />
                  </svg>
                </button>
              </div>
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

          {viewing && (
            <p className="from-history">
              {t.fromHistory}
              <button className="ghost" onClick={() => setViewing(null)}>
                {t.backToNow}
              </button>
            </p>
          )}

          <section className="stream" ref={streamRef}>
            {loading && <p className="loading">{t.loading}</p>}

            {activeNotes && (
              <>
                {activeNotes.headline && <p className="headline">{activeNotes.headline}</p>}
                {activeNotes.thread && (
                  <p className="thread">
                    <b>{t.thread}</b> {activeNotes.thread}
                  </p>
                )}

                {shown.map((n, i) => (
                  <article key={`${n.title}-${i}`} className="note">
                    <span className={`kind ${n.kind}`}>{t.kinds[n.kind] ?? n.kind}</span>
                    {n.at !== null && canControl !== false && !viewing && track.durationMs > 0 && (
                      <button
                        className="jump"
                        title={t.jumpTo}
                        onClick={() => {
                          const target = n.at! * track.durationMs;
                          run(() => seek(target), () => setProgress(target));
                        }}
                      >
                        {mmss(n.at * track.durationMs)}
                      </button>
                    )}
                    <h3>{n.title}</h3>
                    <p>{n.body}</p>
                  </article>
                ))}

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
        </>
      )}
    </main>
  );
}
