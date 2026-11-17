import { useCallback, useEffect, useState } from 'react';
import { browserStore, type KeyValueStore } from './cache';
import {
  IDENTITY_SYNC,
  MAX_SCALE,
  MIN_SCALE,
  fitMapping,
  type SyncMapping,
  type SyncTap,
} from './sync';

/**
 * Per-track sync calibration made with the Sync panel, kept in localStorage.
 * Keyed by video and lyrics record: a different video (another cover) or a
 * different lyrics choice starts from scratch.
 */

export interface TrackSync {
  mapping: SyncMapping;
  taps: SyncTap[];
}

interface Entry extends TrackSync {
  t: number;
}

export const SYNC_STORAGE_KEY = 'lyricsdock.sync.v1';
export const MAX_SYNC_ENTRIES = 200;
/** Only the newest taps matter for the fit. */
export const MAX_TAPS = 6;

export function syncKey(trackId: string, recordId: number | null): string {
  return `${trackId}#${recordId ?? 'none'}`;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function validEntry(v: unknown): Entry | null {
  if (typeof v !== 'object' || v === null) return null;
  const e = v as Partial<Entry>;
  const m = e.mapping;
  if (!m || !finite(m.scale) || !finite(m.shift) || !finite(e.t)) return null;
  if (m.scale < MIN_SCALE || m.scale > MAX_SCALE || Math.abs(m.shift) > 3600) return null;
  const taps = Array.isArray(e.taps)
    ? e.taps.filter((t): t is SyncTap => finite(t?.position) && finite(t?.lyric)).slice(-MAX_TAPS)
    : [];
  return { mapping: { scale: m.scale, shift: m.shift }, taps, t: e.t };
}

export class SyncStore {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly store: KeyValueStore | null,
    private readonly now: () => number = Date.now,
  ) {
    try {
      const raw = store?.getItem(SYNC_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          const e = validEntry(v);
          if (e) this.entries.set(k, e);
        }
      }
    } catch {
      // Corrupt storage: start empty.
    }
  }

  get(key: string): TrackSync | null {
    const e = this.entries.get(key);
    return e ? { mapping: e.mapping, taps: e.taps } : null;
  }

  set(key: string, value: TrackSync) {
    this.entries.delete(key);
    this.entries.set(key, { ...value, taps: value.taps.slice(-MAX_TAPS), t: this.now() });
    while (this.entries.size > MAX_SYNC_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.save();
  }

  delete(key: string) {
    if (this.entries.delete(key)) this.save();
  }

  private save() {
    try {
      this.store?.setItem(SYNC_STORAGE_KEY, JSON.stringify(Object.fromEntries(this.entries)));
    } catch {
      // Storage full or unavailable: calibration still works for this session.
    }
  }
}

let shared: SyncStore | null = null;
function sharedStore(): SyncStore {
  shared ??= new SyncStore(browserStore());
  return shared;
}

/** Calibration for one track; `key` null means no synced lyrics are shown. */
export function useTrackSync(key: string | null, store: SyncStore = sharedStore()) {
  const [state, setState] = useState<TrackSync | null>(() => (key ? store.get(key) : null));

  useEffect(() => setState(key ? store.get(key) : null), [key, store]);

  const tap = useCallback(
    (t: SyncTap) => {
      if (!key) return;
      setState((prev) => {
        const taps = [...(prev?.taps ?? []), t].slice(-MAX_TAPS);
        const next = { mapping: fitMapping(taps, prev?.mapping ?? IDENTITY_SYNC), taps };
        store.set(key, next);
        return next;
      });
    },
    [key, store],
  );

  const reset = useCallback(() => {
    if (key) store.delete(key);
    setState(null);
  }, [key, store]);

  return { mapping: state?.mapping ?? IDENTITY_SYNC, taps: state?.taps.length ?? 0, tap, reset };
}
