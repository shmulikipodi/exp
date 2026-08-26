// Song Exploder is an artist taking one of their own songs apart, track by track. That
// is the material this app wants most and neither a catalogue nor an encyclopedia has
// it. 343 episodes: silent for most songs, and worth a great deal for the ones it
// covers.
//
// The site runs WordPress with an open REST API, and each episode names its song in a
// "subhead" element — so a match can be exact rather than fuzzy.

import { sameSong } from "./evidence.js";

const WP = "https://songexploder.net/wp-json/wp/v2/posts";
const UA = "exp/1.0 ( https://github.com/ )";

export type Episode = { title: string; song: string; link: string; summary: string };

const cache = new Map<string, { at: number; value: Episode | null }>();
const TTL_MS = 6 * 60 * 60_000;

function strip(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&#8217;|&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The song an episode is about, taken from the subhead the site puts it in. */
function subhead(html: string): string {
  const m = html.match(/<div class="subhead">([\s\S]*?)<\/div>/);
  return m ? strip(m[1]).replace(/^"|"$/g, "").trim() : "";
}

export async function findEpisode(track: string, artist: string): Promise<Episode | null> {
  const key = `${artist}|${track}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let found: Episode | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const url =
      `${WP}?search=${encodeURIComponent(artist)}&per_page=8&_fields=title,link,content`;
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const posts = (await res.json()) as any[];
      for (const post of posts) {
        const html = String(post?.content?.rendered ?? "");
        const song = subhead(html);
        // The episode has to be about this song, not merely by this artist — an artist
        // with several episodes would otherwise hand over the wrong one.
        if (!song || !sameSong(song, track)) continue;
        found = {
          title: strip(String(post?.title?.rendered ?? "")),
          song,
          link: String(post?.link ?? ""),
          summary: strip(html).slice(0, 2500),
        };
        break;
      }
    }
  } catch {
    // The show is a bonus. Nothing here is worth failing a request over.
  }

  cache.set(key, { at: Date.now(), value: found });
  if (cache.size > 80) cache.delete(cache.keys().next().value as string);
  return found;
}

/* ---------- the wider podcast world ---------- */

// Apple's directory is searchable without a key, and there is a whole genre of shows
// taking songs apart. It is also full of cover-song channels, chat shows and
// AI-generated filler, and a search for "Karma Police Radiohead" returns all of it —
// so only shows known for doing the work are read.
//
// Judged on: first-hand accounts (the musician talking), documented research, or
// musical analysis. Dramatised true-crime music shows are deliberately absent; they
// are entertaining and they invent.
const TRUSTED = [
  "song exploder",
  "switched on pop",
  "dissect",
  "strong songs",
  "sodajerker",
  "tape notes",
  "broken record",
  "cocaine & rhinestones",
  "cocaine and rhinestones",
  "a history of rock music in 500 songs",
  "hit parade",
  "the opus",
  "shred with shifty",
  "twenty thousand hertz",
  "bandsplain",
  "questlove supreme",
  "lost notes",
  "rolling stone music now",
  "all songs considered",
  "sound opinions",
  // One song per episode, or one artist taken apart properly.
  "one song",
  "שיר אחד one song",
  "60 songs that explain the",
  "heat rocks",
  "and the writer is",
  "pop pantheon",
  "no dogs in space",
  "the number ones",
  "classic album sundays",
  "louder than a riot",
  "popcast",
  "song vs. song",
  "the rock n roll archaeology",
  "in the studio with redbeard",
  "vinyl emergency",
  "album mode",
  // Hebrew. Both do exactly what this app does: one song, taken apart, per episode.
  "שיר אחד",
  "האזנה מודרכת",
];

const ITUNES = "https://itunes.apple.com/search";

export type Mention = { show: string; title: string; link: string; summary: string };

const mentionCache = new Map<string, { at: number; value: Mention[] }>();

// Shows whose names begin with a trusted one but are not it.
const IMPOSTORS = ["one song from age"];

/**
 * The name has to be the start of the show's title, not merely somewhere inside it.
 * A substring test let "Best of Song Exploder Reactions" through as Song Exploder, and
 * a feed can call itself anything.
 */
export function trusted(show: string): boolean {
  const s = show.toLowerCase().trim();
  if (IMPOSTORS.some((bad) => s.startsWith(bad))) return false;
  return TRUSTED.some((name) => s === name || s.startsWith(`${name} `) || s.startsWith(`${name}:`));
}

/** Does this episode actually concern the track, or merely mention the artist? */
function aboutTrack(text: string, track: string, artist: string): boolean {
  const hay = text.toLowerCase();
  const words = (v: string) =>
    v
      .toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2);

  const title = words(track);
  const who = words(artist);
  const hasArtist = who.length === 0 || who.some((w) => hay.includes(w));
  const hasTitle = title.length === 0 || title.every((w) => hay.includes(w));
  return hasArtist && hasTitle;
}

export async function findMentions(track: string, artist: string): Promise<Mention[]> {
  const key = `${artist}|${track}`.toLowerCase();
  const hit = mentionCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let out: Mention[] = [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const url =
      `${ITUNES}?media=podcast&entity=podcastEpisode&limit=25&term=` +
      encodeURIComponent(`${track} ${artist}`);
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const data = (await res.json()) as any;
      for (const e of data?.results ?? []) {
        const show = String(e?.collectionName ?? "");
        const title = String(e?.trackName ?? "");
        const summary = strip(String(e?.description ?? ""));
        if (!trusted(show) || !title) continue;
        if (!aboutTrack(`${title} ${summary}`, track, artist)) continue;

        out.push({
          show,
          title,
          link: String(e?.trackViewUrl ?? e?.collectionViewUrl ?? ""),
          summary: summary.slice(0, 1200),
        });
        if (out.length === 2) break;
      }
    }
  } catch {
    // A bonus, never a blocker.
  }

  mentionCache.set(key, { at: Date.now(), value: out });
  if (mentionCache.size > 80) mentionCache.delete(mentionCache.keys().next().value as string);
  return out;
}
