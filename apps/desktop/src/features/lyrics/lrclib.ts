/**
 * LRCLIB client (https://lrclib.net/docs). Public, free, no API key.
 *
 * Endpoints used:
 *   GET /api/get?track_name&artist_name[&album_name][&duration]  -> record | 404
 *   GET /api/search?track_name[&artist_name]  or  ?q=            -> record[]
 *
 * Only the track title/artist/duration are sent. Browsers cannot set the
 * User-Agent header, so we identify the app with LRCLIB's `Lrclib-Client`
 * header, which their CORS policy explicitly allows.
 */

export const LRCLIB_BASE = 'https://lrclib.net';
export const CLIENT_ID = 'LyricsDock v0.2.0';
const TIMEOUT_MS = 10_000;

export interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  /** Seconds. */
  duration: number | null;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export type LrclibErrorKind = 'offline' | 'timeout' | 'rate-limited' | 'server' | 'bad-response';

export class LrclibError extends Error {
  constructor(
    public readonly kind: LrclibErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'LrclibError';
  }
}

function str(v: unknown, max = 100_000): string | null {
  return typeof v === 'string' && v.length <= max ? v : null;
}

/** Runtime validation of one record; returns null if the shape is wrong. */
export function parseRecord(v: unknown): LrclibRecord | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'number' || !Number.isFinite(o.id)) return null;
  const trackName = str(o.trackName ?? o.name, 1000);
  const artistName = str(o.artistName, 1000);
  if (trackName === null || artistName === null) return null;
  const duration =
    typeof o.duration === 'number' && Number.isFinite(o.duration) && o.duration >= 0
      ? o.duration
      : null;
  const plain = str(o.plainLyrics);
  const synced = str(o.syncedLyrics);
  return {
    id: o.id,
    trackName,
    artistName,
    albumName: str(o.albumName, 1000) ?? '',
    duration,
    instrumental: o.instrumental === true,
    plainLyrics: plain && plain.trim() ? plain : null,
    syncedLyrics: synced && synced.trim() ? synced : null,
  };
}

export interface GetParams {
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number | null;
}

export type SearchParams = { trackName: string; artistName?: string } | { q: string };

export interface LrclibClient {
  get(params: GetParams, signal?: AbortSignal): Promise<LrclibRecord | null>;
  search(params: SearchParams, signal?: AbortSignal): Promise<LrclibRecord[]>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createLrclibClient(
  fetchImpl: FetchLike = (i, init) => fetch(i, init),
  base = LRCLIB_BASE,
): LrclibClient {
  async function request(path: string, query: Record<string, string>, outer?: AbortSignal) {
    const url = `${base}${path}?${new URLSearchParams(query).toString()}`;
    const ctrl = new AbortController();
    const timer = setTimeout(
      () => ctrl.abort(new DOMException('timeout', 'TimeoutError')),
      TIMEOUT_MS,
    );
    const onOuterAbort = () => ctrl.abort(outer?.reason);
    outer?.addEventListener('abort', onOuterAbort, { once: true });
    try {
      return await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'Lrclib-Client': CLIENT_ID },
        signal: ctrl.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch (e) {
      if (outer?.aborted) throw e;
      if (ctrl.signal.aborted) throw new LrclibError('timeout', 'LRCLIB did not respond in time');
      throw new LrclibError('offline', 'Could not reach LRCLIB');
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuterAbort);
    }
  }

  async function json(res: Response): Promise<unknown> {
    if (res.status === 429) throw new LrclibError('rate-limited', 'LRCLIB rate limit reached');
    if (res.status >= 500) throw new LrclibError('server', `LRCLIB error ${res.status}`);
    if (!res.ok) throw new LrclibError('bad-response', `Unexpected status ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new LrclibError('bad-response', 'LRCLIB returned invalid JSON');
    }
  }

  return {
    async get(p, signal) {
      const q: Record<string, string> = { track_name: p.trackName, artist_name: p.artistName };
      if (p.albumName) q.album_name = p.albumName;
      if (p.duration != null && p.duration > 0) q.duration = String(Math.round(p.duration));
      const res = await request('/api/get', q, signal);
      if (res.status === 404) return null;
      const rec = parseRecord(await json(res));
      if (!rec) throw new LrclibError('bad-response', 'LRCLIB record had an unexpected shape');
      return rec;
    },
    async search(p, signal) {
      const q: Record<string, string> =
        'q' in p
          ? { q: p.q }
          : p.artistName
            ? { track_name: p.trackName, artist_name: p.artistName }
            : { track_name: p.trackName };
      const res = await request('/api/search', q, signal);
      const body = await json(res);
      if (!Array.isArray(body))
        throw new LrclibError('bad-response', 'Search result was not a list');
      return body
        .slice(0, 50)
        .map(parseRecord)
        .filter((r): r is LrclibRecord => r !== null);
    },
  };
}
