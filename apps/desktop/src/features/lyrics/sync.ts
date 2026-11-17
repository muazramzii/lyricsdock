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

/**
 * Per-track mapping from video position to lyric time:
 * `lyric = position × scale + shift`. Identity for the original recording;
 * covers and live versions get their own shift and tempo from "Sync".
 */
export interface SyncMapping {
  scale: number;
  /** Seconds. */
  shift: number;
}

export const IDENTITY_SYNC: SyncMapping = { scale: 1, shift: 0 };

/** Position used for line lookup, including the track mapping and the global offset. */
export function lyricTime(
  anchor: PlaybackAnchor,
  nowMs: number,
  offsetMs: number,
  mapping: SyncMapping = IDENTITY_SYNC,
): number {
  return estimatePosition(anchor, nowMs) * mapping.scale + mapping.shift + offsetMs / 1000;
}

/** "This lyric time is being sung at this video position." */
export interface SyncTap {
  /** Video position, seconds. */
  position: number;
  /** Lyric timestamp, seconds, with the global offset already removed. */
  lyric: number;
}

/** Tempo is only trusted within this range (±25 %), otherwise it's a mis-tap. */
export const MIN_SCALE = 0.8;
export const MAX_SCALE = 1.25;
/**
 * Two taps closer than this (in video time) can't give a reliable tempo: a
 * half-second reaction error over 10 s is already a 5 % tempo error.
 */
export const MIN_TAP_SPAN = 30;

/**
 * Fit a mapping from the user's taps. The newest tap always lands exactly.
 * Tempo comes from the newest tap paired with the earlier tap furthest away
 * from it; with only one usable tap the previous tempo is kept.
 */
export function fitMapping(
  taps: readonly SyncTap[],
  prev: SyncMapping = IDENTITY_SYNC,
): SyncMapping {
  const last = taps[taps.length - 1];
  if (!last) return prev;
  let scale = prev.scale;
  let partner: SyncTap | null = null;
  for (const t of taps.slice(0, -1)) {
    const span = Math.abs(last.position - t.position);
    if (span >= MIN_TAP_SPAN && (!partner || span > Math.abs(last.position - partner.position)))
      partner = t;
  }
  if (partner) {
    const fitted = (last.lyric - partner.lyric) / (last.position - partner.position);
    if (fitted >= MIN_SCALE && fitted <= MAX_SCALE) scale = fitted;
  }
  return { scale, shift: last.lyric - last.position * scale };
}
