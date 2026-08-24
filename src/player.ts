// Spotify's Web Playback SDK turns this tab into a device on your account, so the music
// can come from the page you are reading rather than from a phone in another room.
//
// Two hard constraints, both Spotify's: it needs Premium, and it needs the `streaming`
// scope, which means a fresh login for anyone who connected before this existed.

import { accessToken } from "./spotify";

const SDK_URL = "https://sdk.scdn.co/spotify-player.js";

export type PlayerState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "ready"; deviceId: string }
  | { status: "unsupported"; reason: string };

type Listener = (state: PlayerState) => void;

let player: any = null;
let state: PlayerState = { status: "off" };
const listeners = new Set<Listener>();

function emit(next: PlayerState) {
  state = next;
  for (const l of listeners) l(next);
}

export function onPlayer(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

function loadSdk(): Promise<void> {
  if ((window as any).Spotify) return Promise.resolve();

  return new Promise((resolve, reject) => {
    // The SDK calls this the moment it finishes loading; it has to exist first.
    (window as any).onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => reject(new Error("Spotify's player script could not be loaded."));
    document.body.appendChild(script);
  });
}

/** Registers this tab as a playback device. Safe to call more than once. */
export async function startPlayer(name = "exp"): Promise<void> {
  if (player || state.status === "loading") return;
  emit({ status: "loading" });

  try {
    await loadSdk();
  } catch (e) {
    emit({ status: "unsupported", reason: (e as Error).message });
    return;
  }

  player = new (window as any).Spotify.Player({
    name,
    volume: 0.8,
    getOAuthToken: (cb: (token: string) => void) => {
      accessToken()
        .then(cb)
        .catch(() => emit({ status: "unsupported", reason: "Not connected to Spotify." }));
    },
  });

  player.addListener("ready", ({ device_id }: { device_id: string }) => {
    emit({ status: "ready", deviceId: device_id });
  });
  player.addListener("not_ready", () => emit({ status: "off" }));

  // account_error is what a free account gets, and it is the common case worth naming.
  player.addListener("account_error", () =>
    emit({ status: "unsupported", reason: "premium" }),
  );
  player.addListener("initialization_error", ({ message }: { message: string }) =>
    emit({ status: "unsupported", reason: message }),
  );
  player.addListener("authentication_error", () =>
    emit({ status: "unsupported", reason: "reconnect" }),
  );

  const connected = await player.connect();
  if (!connected) emit({ status: "unsupported", reason: "The player could not connect." });
}

export function stopPlayer() {
  player?.disconnect();
  player = null;
  emit({ status: "off" });
}
