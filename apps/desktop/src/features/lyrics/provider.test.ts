import { describe, expect, it, vi } from 'vitest';
import {
  LyricsCache,
  MATCHER_VERSION,
  MAX_ENTRIES,
  MISS_TTL_MS,
  cacheKey,
  type KeyValueStore,
} from './cache';
import { contentFromRecord } from './content';
import {
  LrclibError,
  createLrclibClient,
  parseRecord,
  type LrclibClient,
  type LrclibRecord,
} from './lrclib';
import {
  artistSimilarity,
  manualSearch,
  queryReadings,
  rankCandidates,
  resolveLyrics,
  scoreCandidate,
  stripCover,
  titleSimilarity,
} from './matching';

function rec(over: Partial<LrclibRecord> = {}): LrclibRecord {
  return {
    id: 1,
    trackName: 'Song',
    artistName: 'Artist',
    albumName: 'Album',
    duration: 200,
    instrumental: false,
    plainLyrics: 'a\nb',
    syncedLyrics: '[00:01.00]a\n[00:02.00]b',
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('parseRecord (API mapping)', () => {
  it('maps the live LRCLIB shape', () => {
    const r = parseRecord({
      id: 33061899,
      name: 'Never Gonna Give You Up',
      trackName: 'Never Gonna Give You Up',
      artistName: 'Rick Astley',
      albumName: 'Whenever You Need Somebody',
      duration: 212.0,
      instrumental: false,
      hasWordSync: false,
      plainLyrics: 'x',
      syncedLyrics: '[00:01.00]x',
    });
    expect(r).toMatchObject({ id: 33061899, trackName: 'Never Gonna Give You Up', duration: 212 });
  });

  it('rejects wrong shapes and normalizes empty lyrics to null', () => {
    expect(parseRecord(null)).toBeNull();
    expect(parseRecord({ id: 'x', trackName: 'a', artistName: 'b' })).toBeNull();
    expect(parseRecord({ id: 1, trackName: 5, artistName: 'b' })).toBeNull();
    const r = parseRecord({
      id: 1,
      trackName: 'a',
      artistName: 'b',
      plainLyrics: '  ',
      syncedLyrics: null,
    });
    expect(r).toMatchObject({
      plainLyrics: null,
      syncedLyrics: null,
      duration: null,
      albumName: '',
    });
  });
});

describe('LRCLIB client', () => {
  it('builds /api/get with rounded duration and identifies the client', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(rec()));
    const client = createLrclibClient(fetchMock, 'https://lrclib.test');
    const r = await client.get({ trackName: 'Song & Co', artistName: 'Artist', duration: 199.6 });
    expect(r?.id).toBe(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://lrclib.test/api/get?track_name=Song+%26+Co&artist_name=Artist&duration=200',
    );
    expect((init.headers as Record<string, string>)['Lrclib-Client']).toMatch(/^LyricsDock/);
    expect(init.credentials).toBe('omit');
  });

  it('returns null on 404 and maps errors', async () => {
    const make = (res: () => Promise<Response>) => createLrclibClient(vi.fn(res), 'https://x');
    expect(
      await make(async () => jsonResponse({}, 404)).get({ trackName: 'a', artistName: 'b' }),
    ).toBeNull();
    await expect(make(async () => jsonResponse({}, 429)).search({ q: 'a' })).rejects.toMatchObject({
      kind: 'rate-limited',
    });
    await expect(make(async () => jsonResponse({}, 503)).search({ q: 'a' })).rejects.toMatchObject({
      kind: 'server',
    });
    await expect(
      make(async () => {
        throw new TypeError('Failed to fetch');
      }).search({ q: 'a' }),
    ).rejects.toMatchObject({ kind: 'offline' });
    await expect(
      make(async () => new Response('<html>', { status: 200 })).search({ q: 'a' }),
    ).rejects.toMatchObject({ kind: 'bad-response' });
    await expect(
      make(async () => jsonResponse({ not: 'array' })).search({ q: 'a' }),
    ).rejects.toBeInstanceOf(LrclibError);
  });

  it('drops malformed records from search results', async () => {
    const client = createLrclibClient(
      vi.fn(async () => jsonResponse([rec(), { id: 'bad' }, rec({ id: 2 })])),
      'https://x',
    );
    expect((await client.search({ trackName: 'Song' })).map((r) => r.id)).toEqual([1, 2]);
  });
});

describe('matching', () => {
  it('scores title similarity tolerant of case, punctuation and features', () => {
    expect(titleSimilarity("Don't Stop Me Now", 'Dont Stop Me Now')).toBe(1);
    expect(titleSimilarity('Levels (feat. X)', 'Levels')).toBeGreaterThanOrEqual(0.85);
    expect(titleSimilarity('Hello', 'Goodbye')).toBeLessThan(0.3);
  });

  it('scores artists including multi-artist credits and joined channel names', () => {
    expect(artistSimilarity('Calvin Harris, Dua Lipa', 'Dua Lipa')).toBeGreaterThan(0.75);
    expect(artistSimilarity('TaylorSwift', 'Taylor Swift')).toBeGreaterThan(0.9);
    expect(artistSimilarity('', 'Anyone')).toBe(0.5);
    expect(artistSimilarity('Metallica', 'Adele')).toBeLessThan(0.3);
  });

  it('penalizes version mismatches and large duration gaps', () => {
    const q = { title: 'Song', artist: 'Artist', duration: 200 };
    const studio = scoreCandidate(q, rec());
    const live = scoreCandidate(q, rec({ trackName: 'Song (Live)' }));
    const long = scoreCandidate(q, rec({ duration: 320 }));
    expect(studio.score).toBeGreaterThan(live.score);
    expect(studio.score).toBeGreaterThan(long.score);
  });

  it('ranks deterministically: score, synced, duration gap, id', () => {
    const q = { title: 'Song', artist: 'Artist', duration: 200 };
    const ranked = rankCandidates(q, [
      rec({ id: 5, syncedLyrics: null }),
      rec({ id: 3 }),
      rec({ id: 2 }),
      rec({ id: 3 }), // duplicate id removed
    ]);
    expect(ranked.map((c) => c.record.id)).toEqual([2, 3, 5]);
  });
});

function fakeClient(over: Partial<LrclibClient>): LrclibClient {
  return {
    get: vi.fn(async () => null),
    search: vi.fn(async () => []),
    ...over,
  };
}

describe('resolveLyrics', () => {
  const q = {
    title: 'Song',
    artist: 'Artist',
    duration: 200,
    rawTitle: 'Artist - Song (Official Video)',
  };

  it('accepts an exact /api/get hit without searching', async () => {
    const client = fakeClient({ get: vi.fn(async () => rec()) });
    const r = await resolveLyrics(client, q);
    expect(r.kind).toBe('match');
    expect(client.search).not.toHaveBeenCalled();
  });

  it('falls back to search and picks a confident match', async () => {
    const client = fakeClient({ search: vi.fn(async () => [rec({ id: 9, duration: 201 })]) });
    const r = await resolveLyrics(client, q);
    expect(r).toMatchObject({ kind: 'match', candidate: { record: { id: 9 } } });
  });

  it('returns ambiguous rather than a clearly wrong song', async () => {
    const client = fakeClient({
      search: vi.fn(async () => [
        rec({ id: 4, trackName: 'Song Remix', artistName: 'Other Person', duration: 330 }),
      ]),
    });
    const r = await resolveLyrics(client, q);
    expect(r.kind).not.toBe('match');
  });

  it('returns none when nothing is found', async () => {
    expect(await resolveLyrics(fakeClient({}), q)).toEqual({ kind: 'none' });
  });

  it('propagates network errors', async () => {
    const client = fakeClient({
      search: vi.fn(async () => {
        throw new LrclibError('offline', 'x');
      }),
    });
    await expect(resolveLyrics(client, { ...q, duration: null })).rejects.toMatchObject({
      kind: 'offline',
    });
  });
});

describe('covers and "Song - Artist" titles', () => {
  it('strips cover credits', () => {
    expect(stripCover('ST12 (Afiq Adnan Cover)')).toEqual({ title: 'ST12', isCover: true });
    expect(stripCover('Perfect [Cover by Someone]')).toEqual({ title: 'Perfect', isCover: true });
    expect(stripCover('Perfect cover by Someone')).toEqual({ title: 'Perfect', isCover: true });
    expect(stripCover('Cover Me Up')).toEqual({ title: 'Cover Me Up', isCover: false });
  });

  it('tries the swapped reading', () => {
    const { readings, isCover } = queryReadings({
      title: 'ST12 (Afiq Adnan Cover)',
      artist: 'Cinta Tak Harus Memiliki',
      duration: 253,
    });
    expect(isCover).toBe(true);
    expect(readings.map((r) => [r.title, r.artist])).toEqual([
      ['ST12', 'Cinta Tak Harus Memiliki'],
      ['Cinta Tak Harus Memiliki', 'ST12'],
    ]);
  });

  const original = (id: number, duration: number) =>
    rec({ id, trackName: 'Cinta Tak Harus Memiliki', artistName: 'ST12', duration });
  const search = vi.fn(async (p: { trackName?: string; artistName?: string; q?: string }) =>
    'trackName' in p && p.trackName === 'Cinta Tak Harus Memiliki'
      ? [original(1, 272), original(2, 272), original(3, 277)]
      : [],
  );

  it('finds "Song - Artist" uploads', async () => {
    const r = await resolveLyrics(fakeClient({ search }), {
      title: 'ST12',
      artist: 'Cinta Tak Harus Memiliki',
      duration: 272,
    });
    expect(r).toMatchObject({ kind: 'match', candidate: { record: { artistName: 'ST12' } } });
  });

  it('reads "Song by Artist" titles', () => {
    const { readings, isCover } = queryReadings({
      title: 'Takkan Terganti by Marcell (cover by Langit)',
      artist: 'LangitJiwa',
      duration: 243,
    });
    expect(isCover).toBe(true);
    expect([readings[0]?.title, readings[0]?.artist]).toEqual(['Takkan Terganti', 'Marcell']);
    expect(
      queryReadings({ title: 'Stand by Me by Ben E. King', artist: '', duration: null })
        .readings[0],
    ).toMatchObject({ title: 'Stand by Me', artist: 'Ben E. King' });
  });

  it('lets the user choose when a cover differs in length from the original', async () => {
    const r = await resolveLyrics(fakeClient({ search }), {
      title: 'ST12 (Afiq Adnan Cover)',
      artist: 'Cinta Tak Harus Memiliki',
      duration: 253,
    });
    expect(r.kind).toBe('ambiguous');
    // Duplicate uploads of one recording are offered once.
    if (r.kind === 'ambiguous') expect(r.candidates.map((c) => c.record.id)).toEqual([1, 3]);
  });

  it('never auto-accepts the same title by an unrelated artist', async () => {
    const other = vi.fn(async () => [
      rec({ id: 5, trackName: 'Not You', artistName: 'Matt Terry', duration: 190 }),
    ]);
    const r = await resolveLyrics(fakeClient({ search: other }), {
      title: 'Not You',
      artist: 'Emma Steinbakken, Alan Walker',
      duration: 190,
    });
    expect(r.kind).toBe('ambiguous');
  });

  it('cleans "(Lirik)" and searches swapped fields in manual search', async () => {
    const search = vi.fn(async (p: { trackName?: string; artistName?: string; q?: string }) =>
      'trackName' in p &&
      p.trackName === 'Not You' &&
      p.artistName === 'Emma Steinbakken, Alan Walker'
        ? [
            rec({
              id: 8,
              trackName: 'Not You',
              artistName: 'Alan Walker, Emma Steinbakken',
              duration: 154,
            }),
          ]
        : [],
    );
    const r = await manualSearch(
      fakeClient({ search }),
      'Emma Steinbakken, Alan Walker',
      'Not You (Lirik)',
      154,
    );
    expect(r.map((c) => c.record.id)).toEqual([8]);
  });

  it('accepts the original for a cover of the same length', async () => {
    const r = await resolveLyrics(fakeClient({ search }), {
      title: 'ST12 (Afiq Adnan Cover)',
      artist: 'Cinta Tak Harus Memiliki',
      duration: 273,
    });
    expect(r.kind).toBe('match');
  });
});

describe('contentFromRecord', () => {
  it('prefers synced, falls back to plain, then instrumental', () => {
    expect(contentFromRecord(rec())?.kind).toBe('synced');
    expect(contentFromRecord(rec({ syncedLyrics: 'no timestamps here' }))?.kind).toBe('plain');
    expect(
      contentFromRecord(rec({ syncedLyrics: null, plainLyrics: null, instrumental: true }))?.kind,
    ).toBe('instrumental');
    expect(contentFromRecord(rec({ syncedLyrics: null, plainLyrics: null }))).toBeNull();
  });
});

describe('LyricsCache', () => {
  function memoryStore(): KeyValueStore & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  }

  it('keys by normalized artist/title and approximate duration', () => {
    expect(cacheKey({ title: 'Song!', artist: 'ARTIST', duration: 200.4 })).toBe(
      cacheKey({ title: 'song', artist: 'artist', duration: 199.6 }),
    );
    expect(cacheKey({ title: 'a', artist: 'b', duration: null })).toBe('b|a|');
  });

  it('persists, expires misses, and evicts beyond the size limit', () => {
    let now = 0;
    const store = memoryStore();
    const cache = new LyricsCache(store, () => now);
    cache.set('hit', { kind: 'record', record: rec(), manual: false });
    cache.set('miss', { kind: 'none' });
    expect(new LyricsCache(store, () => now).get('hit')).toMatchObject({ kind: 'record' });
    now = MISS_TTL_MS + 1;
    expect(cache.get('miss')).toBeNull();
    expect(cache.get('hit')).not.toBeNull();
    for (let i = 0; i < MAX_ENTRIES + 10; i++) cache.set(`k${i}`, { kind: 'none' });
    expect(cache.size).toBe(MAX_ENTRIES);
  });

  it('retries misses recorded by an older matcher', () => {
    const cache = new LyricsCache(memoryStore(), () => 0);
    cache.set('old', { kind: 'none' });
    cache.set('current', { kind: 'none', matcher: MATCHER_VERSION });
    expect(cache.get('old')).toBeNull();
    expect(cache.get('current')).toEqual({ kind: 'none', matcher: MATCHER_VERSION });
  });

  it('survives corrupt storage', () => {
    const store = memoryStore();
    store.data.set('lyricsdock.cache.v1', '{broken');
    expect(new LyricsCache(store).size).toBe(0);
  });
});
