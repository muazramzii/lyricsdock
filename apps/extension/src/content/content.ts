/**
 * Content script for youtube.com and music.youtube.com.
 *
 * Reads only what is needed to look up lyrics: track title/artist, video id,
 * duration, position and play state. It never reads comments, history,
 * account details, or anything outside the player.
 */
import type { PlaybackState } from '@lyricsdock/shared';
import type { MediaStateMessage } from '../shared/messages';
import { snapshot } from './extract';
import { shouldSendNow } from './throttle';

const PLAYING_INTERVAL_MS = 500; // 2 updates per second while playing
const PAUSED_INTERVAL_MS = 3000; // heartbeat while paused
const MEDIA_EVENTS = [
  'play',
  'playing',
  'pause',
  'seeked',
  'ratechange',
  'durationchange',
  'loadedmetadata',
  'emptied',
  'ended',
];

let last: PlaybackState | null = null;
let lastSentAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let observedVideo: HTMLVideoElement | null = null;
let alive = true;

function send(state: PlaybackState | null) {
  if (!alive) return;
  const msg: MediaStateMessage = { type: 'media-state', state };
  try {
    chrome.runtime.sendMessage(msg).catch(() => {
      /* background asleep or reloading; next tick retries */
    });
  } catch {
    // "Extension context invalidated": the extension was reloaded/updated.
    shutdown();
  }
}

function update(force = false) {
  if (!alive) return;
  const now = Date.now();
  const next = snapshot(document, location, navigator, now);
  if (force || shouldSendNow(last, next, now - lastSentAt)) {
    send(next);
    lastSentAt = now;
  }
  last = next;
  attachToVideo();
}

function schedule() {
  clearTimeout(timer);
  if (!alive) return;
  timer = setTimeout(
    () => {
      update();
      schedule();
    },
    last?.playing ? PLAYING_INTERVAL_MS : PAUSED_INTERVAL_MS,
  );
}

const onMediaEvent = () => {
  update(true);
  schedule();
};

/** Re-bind listeners when YouTube swaps the <video> element. */
function attachToVideo() {
  const v = document.querySelector<HTMLVideoElement>(
    '#movie_player video, ytmusic-player video, video',
  );
  if (v === observedVideo) return;
  if (observedVideo)
    for (const e of MEDIA_EVENTS) observedVideo.removeEventListener(e, onMediaEvent);
  observedVideo = v;
  if (v) for (const e of MEDIA_EVENTS) v.addEventListener(e, onMediaEvent, { passive: true });
}

// YouTube is a single-page app: titles change without a page load.
let titleTimer: ReturnType<typeof setTimeout> | undefined;
const titleObserver = new MutationObserver(() => {
  // Throttle: YouTube can rewrite <title> several times per navigation.
  clearTimeout(titleTimer);
  titleTimer = setTimeout(() => update(true), 250);
});

function observeTitle() {
  const t = document.querySelector('head > title');
  if (t) titleObserver.observe(t, { childList: true, characterData: true, subtree: true });
}

function shutdown() {
  alive = false;
  clearTimeout(timer);
  clearTimeout(titleTimer);
  titleObserver.disconnect();
  if (observedVideo)
    for (const e of MEDIA_EVENTS) observedVideo.removeEventListener(e, onMediaEvent);
}

const onNavigate = () => update(true);
const onPageHide = () => send(null);

function shutdownListeners() {
  document.removeEventListener('yt-navigate-finish', onNavigate);
  window.removeEventListener('popstate', onNavigate);
  window.removeEventListener('pagehide', onPageHide);
}

// The background injects this script into tabs that were open at install
// time, and a reloaded extension can share the isolated world with its old,
// orphaned copy. Whichever copy runs last takes over.
const INSTANCE_KEY = '__lyricsdockContent';
type Instance = { stop: () => void };
const slot = window as unknown as Record<string, Instance | undefined>;
slot[INSTANCE_KEY]?.stop();
slot[INSTANCE_KEY] = {
  stop: () => {
    shutdown();
    shutdownListeners();
  },
};

document.addEventListener('yt-navigate-finish', onNavigate);
window.addEventListener('popstate', onNavigate);
window.addEventListener('pagehide', onPageHide);

observeTitle();
update(true);
schedule();
