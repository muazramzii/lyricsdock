import { useEffect, useState } from 'react';
import type { LyricLine } from './lrc';
import {
  IDENTITY_SYNC,
  findLineIndex,
  lyricTime,
  type PlaybackAnchor,
  type SyncMapping,
} from './sync';

/**
 * Current synced line index. Instead of ticking at a fixed rate, it sleeps
 * until the next line boundary (re-checking at most every second so a
 * changed anchor or offset is picked up), so an idle overlay costs ~nothing.
 */
export function useLyricIndex(
  lines: readonly LyricLine[] | null,
  anchor: PlaybackAnchor | null,
  offsetMs: number,
  frozen: boolean,
  mapping: SyncMapping = IDENTITY_SYNC,
  now: () => number = Date.now,
): number {
  const [index, setIndex] = useState(-1);

  useEffect(() => {
    if (!lines || !anchor) {
      setIndex(-1);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const t = lyricTime(anchor, now(), offsetMs, mapping);
      const idx = findLineIndex(lines, t);
      setIndex(idx);
      if (frozen || !anchor.playing) return;
      const next = lines[idx + 1];
      const waitSec = next
        ? (next.time - t) / Math.max(anchor.playbackRate * mapping.scale, 0.0625)
        : 1;
      timer = setTimeout(tick, Math.min(1000, Math.max(16, waitSec * 1000 + 5)));
    };
    if (frozen) return;
    tick();
    return () => clearTimeout(timer);
  }, [lines, anchor, offsetMs, frozen, mapping, now]);

  return index;
}
