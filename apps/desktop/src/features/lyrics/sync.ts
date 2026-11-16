import type { LyricLine } from './lrc';

/**
 * Index of the line active at `time` (seconds), or -1 before the first line.
 * Binary search: called often, lyric files can have hundreds of lines.
 */
export function findLineIndex(lines: readonly LyricLine[], time: number): number {
  if (!Number.isFinite(time)) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid] as LyricLine).time <= time) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export interface LineWindow {
  previous: LyricLine | null;
  current: LyricLine | null;
  next: LyricLine | null;
  index: number;
}

export function lineWindow(lines: readonly LyricLine[], index: number): LineWindow {
  return {
    previous: index > 0 ? (lines[index - 1] ?? null) : null,
    current: index >= 0 ? (lines[index] ?? null) : null,
    next: lines[index + 1] ?? null,
    index,
  };
}

/** Seconds until the next line starts, or null if there is none. */
export function timeToNextLine(lines: readonly LyricLine[], time: number): number | null {
  const idx = findLineIndex(lines, time);
  const next = lines[idx + 1];
  return next ? Math.max(0, next.time - time) : null;
}

/**
 * A playback snapshot as last reported by the browser. The media element's
 * position is the source of truth: between reports we extrapolate with the
 * wall clock, and every new report replaces the anchor, so drift cannot
 * accumulate.
 */
export interface PlaybackAnchor {
  position: number;
  playing: boolean;
  playbackRate: number;
  /** Epoch ms at which `position` was sampled. */
  sampledAt: number;
  duration: number | null;
}

/** Never extrapolate further than this past the last report (stale data). */
export const MAX_EXTRAPOLATION_MS = 5000;

export function estimatePosition(anchor: PlaybackAnchor, nowMs: number): number {
  let pos = anchor.position;
  if (anchor.playing) {
    const elapsed = Math.min(Math.max(0, nowMs - anchor.sampledAt), MAX_EXTRAPOLATION_MS);
    pos += (elapsed / 1000) * anchor.playbackRate;
  }
  if (anchor.duration !== null && anchor.duration > 0) pos = Math.min(pos, anchor.duration);
  return Math.max(0, pos);
}

/** Position used for line lookup, including the user's sync offset. */
export function lyricTime(anchor: PlaybackAnchor, nowMs: number, offsetMs: number): number {
  return estimatePosition(anchor, nowMs) + offsetMs / 1000;
}
