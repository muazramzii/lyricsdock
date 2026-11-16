import { sameTrack, type PlaybackState } from '@lyricsdock/shared';

/** Seconds of unexpected jump between samples that counts as a seek. */
export const SEEK_THRESHOLD = 1.5;
const MIN_INTERVAL_MS = 450;
const HEARTBEAT_MS = 2500;

/**
 * Decide whether a fresh sample is worth sending. Important changes (track,
 * play/pause, seek, rate) go out immediately; otherwise at most ~2 Hz while
 * playing and a slow heartbeat while paused.
 */
export function shouldSendNow(
  prev: PlaybackState | null,
  next: PlaybackState | null,
  sinceLastSendMs: number,
): boolean {
  if (prev === null || next === null) return prev !== next;
  if (!sameTrack(prev, next)) return true;
  if (prev.playing !== next.playing || prev.playbackRate !== next.playbackRate) return true;
  if (prev.duration !== next.duration) return true;
  const expected = prev.playing
    ? prev.position + ((next.capturedAt - prev.capturedAt) / 1000) * prev.playbackRate
    : prev.position;
  if (Math.abs(next.position - expected) > SEEK_THRESHOLD) return true;
  return sinceLastSendMs >= (next.playing ? MIN_INTERVAL_MS : HEARTBEAT_MS);
}
