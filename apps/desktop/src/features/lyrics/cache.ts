import { normalizeText } from '@lyricsdock/shared';
import type { LrclibRecord } from './lrclib';
import type { TrackQuery } from './matching';

/**
 * Small local cache of lookup results so replaying a song, seeking, or
 * reconnecting the extension never re-queries LRCLIB. Kept in localStorage
 * (WebView2 profile, per Windows user). Bounded in size and age.
 */

export type CachedResult =
  { kind: 'record'; record: LrclibRecord; manual: boolean } | { kind: 'none'; matcher?: number };

/**
 * Bumped whenever title parsing or matching improves, so "no lyrics" results
 * from an older matcher are retried instead of being trusted for an hour.
 */
export const MATCHER_VERSION = 2;

interface Entry {
  v: CachedResult;
  /** Epoch ms when stored. */
  t: number;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEY = 'lyricsdock.cache.v1';
export const MAX_ENTRIES = 200;
export const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MISS_TTL_MS = 60 * 60 * 1000;
/** Manual choices are kept longer: the user did work to pick them. */
export const MANUAL_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export function cacheKey(q: Pick<TrackQuery, 'title' | 'artist' | 'duration'>): string {
  const d = q.duration != null ? Math.round(q.duration) : '';
  return `${normalizeText(q.artist)}|${normalizeText(q.title)}|${d}`;
}

export class LyricsCache {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly store: KeyValueStore | null,
    private readonly now: () => number = Date.now,
  ) {
    this.load();
  }

  /** Re-read from storage (another window changed or cleared the cache). */
  reload() {
    this.entries.clear();
    this.load();
  }

  private load() {
    if (!this.store) return;
    try {
      const raw = this.store.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (
          Array.isArray(item) &&
          typeof item[0] === 'string' &&
          item[1]?.v &&
          typeof item[1].t === 'number'
        ) {
          this.entries.set(item[0], item[1] as Entry);
        }
      }
    } catch {
      // Corrupt cache: start empty rather than failing lookups.
      this.entries.clear();
    }
  }

  private persist() {
    if (!this.store) return;
    try {
      this.store.setItem(STORAGE_KEY, JSON.stringify([...this.entries]));
    } catch {
      // Quota exceeded or storage unavailable: drop the oldest half and retry once.
      const keep = [...this.entries].slice(Math.floor(this.entries.size / 2));
      this.entries = new Map(keep);
      try {
        this.store.setItem(STORAGE_KEY, JSON.stringify(keep));
      } catch {
        /* give up silently; cache is an optimisation */
      }
    }
  }

  private ttl(v: CachedResult): number {
    if (v.kind === 'none') return MISS_TTL_MS;
    return v.manual ? MANUAL_TTL_MS : HIT_TTL_MS;
  }

  get(key: string): CachedResult | null {
    const e = this.entries.get(key);
    if (!e) return null;
    const staleMiss = e.v.kind === 'none' && (e.v.matcher ?? 1) < MATCHER_VERSION;
    if (staleMiss || this.now() - e.t > this.ttl(e.v)) {
      this.entries.delete(key);
      this.persist();
      return null;
    }
    // Refresh LRU position.
    this.entries.delete(key);
    this.entries.set(key, e);
    return e.v;
  }

  set(key: string, v: CachedResult) {
    this.entries.delete(key);
    this.entries.set(key, { v, t: this.now() });
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.persist();
  }

  delete(key: string) {
    if (this.entries.delete(key)) this.persist();
  }

  clear() {
    this.entries.clear();
    this.persist();
  }

  get size() {
    return this.entries.size;
  }
}

export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
