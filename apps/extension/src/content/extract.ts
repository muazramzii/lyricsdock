import {
  LIMITS,
  parseYouTubeTitle,
  tidy,
  type PlaybackState,
  type SourceType,
} from '@lyricsdock/shared';
import { SELECTORS, queryFirst, textOf } from './selectors';

export interface MediaSessionInfo {
  title: string;
  artist: string;
}

export interface MediaSample {
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  playbackRate: number;
  readyState: number;
}

export function sourceFromHost(host: string): SourceType | null {
  if (host === 'music.youtube.com') return 'youtube-music';
  if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com')
    return 'youtube';
  return null;
}

export function videoIdFromUrl(url: URL): string | null {
  const v = url.searchParams.get('v');
  const fromShorts = /^\/shorts\/([A-Za-z0-9_-]{6,32})/.exec(url.pathname)?.[1];
  const id = v ?? fromShorts ?? null;
  return id && /^[A-Za-z0-9_-]{1,32}$/.test(id) ? id : null;
}

/** Pages that can host a song. Home/search/channel pages have preview videos we must ignore. */
export function isPlaybackPage(source: SourceType, url: URL): boolean {
  if (source === 'youtube-music') return true; // the YTM player bar persists across pages
  return url.pathname === '/watch' || url.pathname.startsWith('/shorts/');
}

export function findVideo(doc: Document, source: SourceType): HTMLVideoElement | null {
  const list = source === 'youtube' ? SELECTORS.youtube.video : SELECTORS.youtubeMusic.video;
  const v = queryFirst<HTMLVideoElement>(doc, list);
  if (v) return v;
  // Fallback: the longest video in the page (avoids small inline previews).
  let best: HTMLVideoElement | null = null;
  for (const el of Array.from(doc.querySelectorAll('video'))) {
    if (!best || (el.duration || 0) > (best.duration || 0)) best = el;
  }
  return best;
}

export function isAdShowing(doc: Document, source: SourceType): boolean {
  const list = source === 'youtube' ? SELECTORS.youtube.player : SELECTORS.youtubeMusic.player;
  return queryFirst(doc, list)?.classList.contains(SELECTORS.adShowingClass) ?? false;
}

export function readMediaSession(nav: Navigator): MediaSessionInfo | null {
  try {
    const md = nav.mediaSession?.metadata;
    if (!md?.title) return null;
    return { title: tidy(md.title), artist: tidy(md.artist ?? '') };
  } catch {
    return null;
  }
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

export interface TrackInfo {
  title: string;
  artist: string;
  rawTitle: string;
  channel: string;
}

export function extractTrack(
  doc: Document,
  source: SourceType,
  session: MediaSessionInfo | null,
): TrackInfo | null {
  if (source === 'youtube-music') {
    // YouTube Music titles are already clean song names.
    const title = session?.title || textOf(doc, SELECTORS.youtubeMusic.title);
    const artist =
      session?.artist || textOf(doc, SELECTORS.youtubeMusic.artist).split(' • ')[0] || '';
    if (!title) return null;
    return { title, artist: tidy(artist), rawTitle: title, channel: tidy(artist) };
  }

  const rawTitle =
    textOf(doc, SELECTORS.youtube.title) ||
    session?.title ||
    tidy(doc.title.replace(/^\(\d+\)\s*/, '').replace(/\s+-\s+YouTube$/, ''));
  const channel = textOf(doc, SELECTORS.youtube.channel) || session?.artist || '';
  if (!rawTitle || rawTitle === 'YouTube') return null;
  const guess = parseYouTubeTitle(rawTitle, channel);
  return { title: guess.title || rawTitle, artist: guess.artist, rawTitle, channel };
}

function finiteOr(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

export function buildState(
  source: SourceType,
  track: TrackInfo,
  media: MediaSample,
  videoId: string | null,
  now: number,
): PlaybackState {
  const duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null;
  return {
    source,
    title: clip(track.title, LIMITS.title),
    artist: clip(track.artist, LIMITS.artist),
    rawTitle: clip(track.rawTitle, LIMITS.rawTitle),
    channel: clip(track.channel, LIMITS.channel),
    videoId,
    duration: duration !== null ? Math.min(duration, LIMITS.maxSeconds) : null,
    position: Math.min(Math.max(0, finiteOr(media.currentTime, 0)), LIMITS.maxSeconds),
    playing: !media.paused && !media.ended && media.readyState >= 2,
    playbackRate: Math.min(16, Math.max(0.0625, finiteOr(media.playbackRate, 1) || 1)),
    capturedAt: now,
  };
}

export function sampleMedia(v: HTMLVideoElement): MediaSample {
  return {
    currentTime: v.currentTime,
    duration: v.duration,
    paused: v.paused,
    ended: v.ended,
    playbackRate: v.playbackRate,
    readyState: v.readyState,
  };
}

/**
 * Full snapshot of the page, or null when there is no song to report
 * (unsupported page, no media, ad playing, metadata not yet available).
 */
export function snapshot(
  doc: Document,
  loc: Location,
  nav: Navigator,
  now: number,
): PlaybackState | null {
  const source = sourceFromHost(loc.hostname);
  if (!source) return null;
  const url = new URL(loc.href);
  if (!isPlaybackPage(source, url)) return null;
  const video = findVideo(doc, source);
  if (!video || !video.currentSrc) return null;
  if (isAdShowing(doc, source)) return null;
  const track = extractTrack(doc, source, readMediaSession(nav));
  if (!track) return null;
  return buildState(source, track, sampleMedia(video), videoIdFromUrl(url), now);
}
