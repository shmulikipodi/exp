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
