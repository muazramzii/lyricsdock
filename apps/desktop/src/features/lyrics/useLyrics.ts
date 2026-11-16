import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LyricsCache, STORAGE_KEY, browserStore, cacheKey } from './cache';
import { contentFromRecord, type LyricsContent } from './content';
import {
  LrclibError,
  createLrclibClient,
  type LrclibClient,
  type LrclibErrorKind,
  type LrclibRecord,
} from './lrclib';
import { rankCandidates, resolveLyrics, type ScoredCandidate, type TrackQuery } from './matching';

export type LyricsStatus =
  | { phase: 'idle' }
  | { phase: 'loading'; query: TrackQuery }
  | {
      phase: 'ready';
      query: TrackQuery;
      content: LyricsContent;
      alternatives: ScoredCandidate[];
      manual: boolean;
    }
  | { phase: 'not-found'; query: TrackQuery }
  | { phase: 'ambiguous'; query: TrackQuery; candidates: ScoredCandidate[] }
  | { phase: 'error'; query: TrackQuery; error: LrclibErrorKind | 'unknown' };

export interface ManualSearchState {
  busy: boolean;
  results: ScoredCandidate[] | null;
  error: string | null;
}

export interface LyricsDeps {
  client: LrclibClient;
  cache: LyricsCache;
  debounceMs: number;
}

let defaultDeps: LyricsDeps | null = null;
function getDefaultDeps(): LyricsDeps {
  if (!defaultDeps) {
    const cache = new LyricsCache(browserStore());
    // The settings window can clear the cache; keep this window's copy in sync.
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY || e.key === null) cache.reload();
    });
    defaultDeps = { client: createLrclibClient(), cache, debounceMs: 350 };
  }
  return defaultDeps;
}

function errorKind(e: unknown): LrclibErrorKind | 'unknown' {
  return e instanceof LrclibError ? e.kind : 'unknown';
}

export const ERROR_MESSAGES: Record<LrclibErrorKind | 'unknown', string> = {
  offline: "Can't reach LRCLIB. Check your internet connection.",
  timeout: 'LRCLIB is taking too long to respond.',
  'rate-limited': 'LRCLIB asked us to slow down. Try again shortly.',
  server: 'LRCLIB is having trouble right now.',
  'bad-response': 'LRCLIB sent an unexpected response.',
  unknown: 'Something went wrong while loading lyrics.',
};

function queryKey(q: TrackQuery | null): string {
  return q ? `${q.title}\u0000${q.artist}\u0000${q.duration ?? ''}` : '';
}

/**
 * Lyrics lookup state machine for the current track. Debounces rapid track
 * changes (skipping through a playlist), aborts superseded requests, and never
 * fires duplicate lookups for the same track.
 */
export function useLyrics(track: TrackQuery | null, deps: LyricsDeps = getDefaultDeps()) {
  const [status, setStatus] = useState<LyricsStatus>({ phase: 'idle' });
  const [manual, setManual] = useState<ManualSearchState>({
    busy: false,
    results: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const key = queryKey(track);
  // `track` is a fresh object on every position update; key it by content.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableTrack = useMemo(() => track, [key]);
  const trackRef = useRef(stableTrack);
  trackRef.current = stableTrack;

  useEffect(() => {
    const q = stableTrack;
    if (!q) {
      setStatus({ phase: 'idle' });
      return;
    }
    const ck = cacheKey(q);
    const cached = attempt === 0 ? deps.cache.get(ck) : null;
    if (cached) {
      if (cached.kind === 'record') {
        const content = contentFromRecord(cached.record);
        if (content) {
          setStatus({ phase: 'ready', query: q, content, alternatives: [], manual: cached.manual });
          return;
        }
      } else {
        setStatus({ phase: 'not-found', query: q });
        return;
      }
    }

    setStatus({ phase: 'loading', query: q });
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      resolveLyrics(deps.client, q, ctrl.signal)
        .then((res) => {
          if (ctrl.signal.aborted) return;
          if (res.kind === 'match') {
            const content = contentFromRecord(res.candidate.record);
            if (content) {
              deps.cache.set(ck, { kind: 'record', record: res.candidate.record, manual: false });
              setStatus({
                phase: 'ready',
                query: q,
                content,
                alternatives: res.alternatives,
                manual: false,
              });
              return;
            }
          }
          if (res.kind === 'ambiguous') {
            setStatus({ phase: 'ambiguous', query: q, candidates: res.candidates });
            return;
          }
          deps.cache.set(ck, { kind: 'none' });
          setStatus({ phase: 'not-found', query: q });
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          setStatus({ phase: 'error', query: q, error: errorKind(e) });
        });
    }, deps.debounceMs);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [stableTrack, attempt, deps]);

  useEffect(() => setManual({ busy: false, results: null, error: null }), [key]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  const choose = useCallback(
    (record: LrclibRecord) => {
      const q = trackRef.current;
      if (!q) return;
      const content = contentFromRecord(record);
      if (!content) return;
      deps.cache.set(cacheKey(q), { kind: 'record', record, manual: true });
      setStatus({ phase: 'ready', query: q, content, alternatives: [], manual: true });
      setManual({ busy: false, results: null, error: null });
    },
    [deps],
  );

  const search = useCallback(
    async (title: string, artist: string) => {
      const t = title.trim();
      if (!t) return;
      setManual({ busy: true, results: null, error: null });
      try {
        const records = await deps.client.search(
          artist.trim() ? { trackName: t, artistName: artist.trim() } : { q: t },
        );
        const base = trackRef.current;
        const ranked = rankCandidates(
          { title: t, artist: artist.trim(), duration: base?.duration ?? null },
          records,
        ).filter((c) => contentFromRecord(c.record) !== null);
        setManual({ busy: false, results: ranked.slice(0, 12), error: null });
      } catch (e) {
        setManual({ busy: false, results: null, error: ERROR_MESSAGES[errorKind(e)] });
      }
    },
    [deps],
  );

  const forget = useCallback(() => {
    const q = trackRef.current;
    if (q) deps.cache.delete(cacheKey(q));
    setAttempt((a) => a + 1);
  }, [deps]);

  return { status, retry, choose, search, manual, forget };
}
