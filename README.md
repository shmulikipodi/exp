# exp

What you're listening to, explained while it plays. Connect Spotify, press play, and
the notes about the record arrive in time with the song.

Live: https://exp-pearl.vercel.app  ·  No-Spotify demo: https://exp-pearl.vercel.app/?demo=1

Not a wiki page. Every note has to carry something you couldn't have guessed from
the title — a room, a name, an argument, a take. The prompt in `api/notes.ts` is the
product's opinion about what a liner note is; edit it there, not inline.

## What it does

- Reads what's playing (`user-read-currently-playing`) and polls every 5s.
- Fires one grounded search pass per new track and caches the result per track ID,
  so re-listens are instant.
- **Reveals notes in sync with playback.** Notes tied to a moment in the recording
  surface when that moment arrives; the rest are spread through the first three
  quarters. Pips on the progress bar show what's still coming. "Reveal all" for the
  impatient.
- **Threads across the session.** Each track is told in relation to the last few you
  played — shared producer, sample, city, label, year — when a real connection exists.
  Seeded from `recently-played`, so the thread works on the first song too.
- **Writes the next song's notes while this one plays.** The queue endpoint says what
  is coming; its notes are fetched in the background and cached, so a track change
  usually lands on a cache hit instead of twenty seconds of waiting.
- **Playback control**, and a timestamp chip on any note about a specific moment —
  click it to seek there. Free accounts keep everything except the transport.
- **Notes are a conversation, not a document.** Ask for more; ask a question about one
  note or about the record; mark a note wrong and it is deleted *and remembered*, so a
  later regeneration is told not to write it again. Everything is saved with the track.

## Storage

IndexedDB, via `src/store.ts`. localStorage caps out near 5MB — a couple of thousand
notes — so note bodies live in IndexedDB instead, which is measured in hundreds of
megabytes. Anything written before the move migrates across on first run. The index is
mirrored in memory so the history list and the cache check stay synchronous, and a
browser that refuses IndexedDB (private mode) degrades to forgetting, exactly as the
app behaved before any of this existed.

Reading a track again costs no model call, which matters more than the convenience on
a free-tier key.

## Setup

1. Create an app at https://developer.spotify.com/dashboard
2. Redirect URIs — add both:
   - `http://127.0.0.1:5174/callback` (Spotify rejects the spelling `localhost`;
     it must be the loopback IP)
   - `https://exp-pearl.vercel.app/callback`
3. Tick **Web API**, save, copy the Client ID.
4. Paste it into the app's first screen, or set `VITE_SPOTIFY_CLIENT_ID`.

Auth is Authorization Code with PKCE — no client secret, nothing to leak.

Spotify apps start in development mode: only accounts you add under
**Settings → User Management** can log in, up to 25.

```bash
printf 'GEMINI_API_KEY=your-key\n' > .env.local
npm run dev          # http://127.0.0.1:5174
```

`?demo=1` runs the whole pipeline against a fixed track at 30x playback speed, no
Spotify needed. Useful for working on the notes without holding a phone.

## The notes engine

`api/notes.ts` asks for JSON: a headline, an array of notes each with a `kind`
(`origin`, `room`, `personnel`, `sample`, `lyric`, `moment`, `afterlife`) and an
optional `at` (0–1 position in the track), a `thread`, and a `confidence`.

The prompt's job is mostly refusal — no "beloved classic", no padding, and an
explicit instruction to return *fewer* notes and set `confidence: "low"` rather than
invent a producer or a session player. Covers and same-titled songs are the main way
this goes wrong, so admitting ignorance is made the cheap option.

## Evidence

`api/evidence.ts` fetches two keyless sources server-side before the model is asked
anything, and hands them over as documents:

- **MusicBrainz**, looked up by **ISRC** where Spotify provides one. The ISRC names the
  exact recording, which a title search cannot: searching "Maggot Brain" returns a
  279-second edit for a 600-second track just as happily as the real thing. An
  ISRC hit whose title does not resemble the requested one is rejected and the title
  search runs instead, so a bad code cannot quietly swap in another song. Yields
  producer, engineer, writers, performers, label and earliest release date. Its rate limit is one request a second
  and it 503s anything faster, so the calls are spaced and retried; skipping that is
  why it silently returned nothing at first.
- **Wikipedia** — the article on the song or album, truncated to 7k characters.

The prompt is told the evidence outranks its own memory, and to flag a mismatch when
the credits look like a different recording — covers and re-recordings are the main
failure mode. `GET /api/notes?title=…&artist=…` returns the raw evidence with no
model call, for debugging sources cheaply.

This costs about 3 seconds of the ~24s a full track lookup takes. The first note
isn't due until roughly 6% into the song, so it lands in time.

## Grounding and quota

Search grounding runs through `api/providers.ts` (lifted from an earlier project).
On a quota error it re-runs the same prompt **without** search rather than failing,
and the UI says the notes came from model memory — but only when the evidence layer
also came up empty, since MusicBrainz and Wikipedia are the stronger backing anyway.

### Adding keys

**The easy way: in the app.** Click **keys** in the top corner, paste up to three,
press *Test keys*, then *Save*. They live in your browser's localStorage and ride
along with each request — nothing is written to disk, and the track you were on
refetches immediately. This is the route to use; the file below is for deployment.

**The file way.** `.env.local` has three slots, already laid out:

```
GEMINI_API_KEY=
GEMINI_API_KEY_2=
GEMINI_API_KEY_3=
```

Fill them, then push everything to Vercel and redeploy in one step:

```bash
npm run keys
```

**Each key must come from a different Google Cloud project.** Quota is counted per
project, so three keys made inside one project share one bucket and buy nothing. In
[aistudio.google.com/apikey](https://aistudio.google.com/apikey), "Create API key"
offers a project picker — choose **new project** every time, not the same one.

Check what the server actually loaded, without spending any generation quota:

```bash
curl -s https://exp-pearl.vercel.app/api/notes | python3 -m json.tool
```

That reports how many keys it found, the last four characters of each, whether each
is valid, and whether it is currently cooling off. `valid: true` means the key works;
it does **not** mean it has quota left.

### A second provider

Gemini's free tier is 20 requests per day, per project, per model. Groq's is far more
generous and its `compound` model carries its own web search, which is worth having
while Gemini's grounding is spent.

Get keys at [console.groq.com](https://console.groq.com/keys) — free, no card — and add
them the same way as Gemini keys:

```
GROQ_API_KEY=
GROQ_API_KEY_2=
GROQ_API_KEY_3=
```

Gemini is tried first and Groq catches what it drops, so the two allowances add up.

They are not equals, and the ordering is deliberate. Measured on the same track: Gemini
returns five notes, ten linked names and a headline that says something; Groq's
`openai/gpt-oss-120b` returns two notes, no links, and "the haunting single from OK
Computer" — the exact register the prompt bans. Groq is capacity, not quality.

`groq/compound` carries its own web search and was the first choice for that reason, but
its agentic pipeline rejects an input this size with a 413 — the prompt now carries
credits, two articles, a timed lyric sheet and sometimes a podcast episode. `GROQ_MODEL`
overrides the model; `GROQ_FIRST=1` puts Groq ahead of Gemini.

### Automatic switching

`api/keys.ts` rotates across the pool and switches keys by itself. When a key reports
exhaustion it goes on a cooldown — parsed from Google's own "please retry in 51.05s"
where offered, otherwise 90s, clamped to 20 minutes — and later requests skip it
rather than paying a round-trip to rediscover it is empty. A key that succeeds has
its cooldown cleared. If every key is cooling the pool tries them anyway, so a stale
cooldown can never make the app claim it has no keys. Keys pasted in the app are
tried before the environment ones. Setting `GROQ_API_KEY` switches to Groq's compound
model, which carries web search on its free tier.

## Spotify scopes

`user-read-currently-playing`, `user-read-playback-state`, `user-modify-playback-state`,
`user-read-recently-played`. Nothing else — every scope is a line on the consent screen
someone has to agree to. Adding a scope needs a fresh login; refresh tokens keep the
scopes they were minted with.

Playback control is Premium-only, and Spotify answers `403` both for a free account and
for a token that predates the control scope. `src/spotify.ts` reads the error body to
tell them apart: the first hides the transport, the second offers a reconnect.

**Development Mode allows 25 users, added by hand** under Settings → User Management
(Spotify email plus display name). That, not Premium, is what stops a friend logging in.

## Known limits

- Spotify deprecated `audio-features`, `audio-analysis`, `recommendations` and
  `related-artists` for apps registered after November 2024, so there is no BPM, key
  or energy here and there can't be.
- `at` positions are the model's estimate of where something happens, not an
  alignment against the audio. They're approximately right, not frame-accurate.
- Polling is 5s, so a track change takes up to five seconds to register.
