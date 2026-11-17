import {
  normalizeText,
  splitArtists,
  stripFeaturing,
  stripTitleNoise,
  tokenSimilarity,
} from '@lyricsdock/shared';
import { LrclibError, type LrclibClient, type LrclibRecord } from './lrclib';

export interface TrackQuery {
  title: string;
  artist: string;
  /** Seconds, if known. */
  duration: number | null;
  /** Unprocessed page title, used as a last-resort free-text search. */
  rawTitle?: string;
}

export interface ScoredCandidate {
  record: LrclibRecord;
  score: number;
  titleScore: number;
  artistScore: number;
  durationDiff: number | null;
}

export type Resolution =
  | { kind: 'match'; candidate: ScoredCandidate; alternatives: ScoredCandidate[] }
  | { kind: 'ambiguous'; candidates: ScoredCandidate[] }
  | { kind: 'none' };

/** Accept automatically at or above this score. */
export const ACCEPT_SCORE = 0.72;
/** Below this, a candidate is not even offered in the chooser. */
export const OFFER_SCORE = 0.35;

const VERSION_WORDS = [
  'live',
  'remix',
  'acoustic',
  'instrumental',
  'karaoke',
  'demo',
  'slowed',
  'sped',
  'nightcore',
  'cover',
  'unplugged',
  'radio edit',
  'extended',
  'version',
];

function versionTags(title: string): Set<string> {
  const n = ` ${normalizeText(title)} `;
  return new Set(VERSION_WORDS.filter((w) => n.includes(` ${w} `)));
}

export function titleSimilarity(query: string, candidate: string): number {
  const q = normalizeText(stripTitleNoise(query));
  const c = normalizeText(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  const qs = normalizeText(stripFeaturing(query));
  const cs = normalizeText(stripFeaturing(candidate));
  if (qs && qs === cs) return 0.95;
  // One side carries extra words such as "(feat. X)" or a subtitle.
  if ((c.includes(qs) || q.includes(cs)) && Math.min(qs.length, cs.length) >= 3) return 0.85;
  return tokenSimilarity(q, c) * 0.9;
}

export function artistSimilarity(query: string, candidate: string): number {
  if (!query.trim()) return 0.5; // unknown artist: neutral
  const q = normalizeText(query);
  const c = normalizeText(candidate);
  if (q === c) return 1;
  const qa = splitArtists(query);
  const ca = splitArtists(candidate);
  if (qa.length && ca.length) {
    const hits = qa.filter((a) => ca.includes(a)).length;
    if (hits > 0) return 0.75 + 0.25 * (hits / Math.max(qa.length, ca.length));
  }
  // Channel names like "TaylorSwift" vs "Taylor Swift".
  if (q.replace(/ /g, '') === c.replace(/ /g, '')) return 0.95;
  if (q.length >= 3 && (c.includes(q) || q.includes(c))) return 0.7;
  return tokenSimilarity(q, c) * 0.8;
}

export function scoreCandidate(query: TrackQuery, record: LrclibRecord): ScoredCandidate {
  const titleScore = titleSimilarity(query.title, record.trackName);
  const artistScore = artistSimilarity(query.artist, record.artistName);
  const durationDiff =
    query.duration != null && record.duration != null
      ? Math.abs(query.duration - record.duration)
      : null;

  let durationScore = 0.5;
  if (durationDiff !== null) {
    if (durationDiff <= 2) durationScore = 1;
    else if (durationDiff <= 5) durationScore = 0.8;
    else if (durationDiff <= 10) durationScore = 0.45;
    else if (durationDiff <= 30) durationScore = 0.15;
    else durationScore = 0;
  }

  let score = titleScore * 0.5 + artistScore * 0.3 + durationScore * 0.2;

  // Live/remix/acoustic versions have different timing; don't swap them silently.
  const qv = versionTags(query.title);
  const cv = versionTags(record.trackName);
  for (const t of new Set([...qv, ...cv])) if (qv.has(t) !== cv.has(t)) score -= 0.12;

  // A wildly different length is a strong sign of the wrong recording.
  if (durationDiff !== null && durationDiff > 30) score -= 0.15;

  // Prefer records that actually carry lyrics.
  if (record.syncedLyrics) score += 0.03;
  else if (!record.plainLyrics && !record.instrumental) score -= 0.2;

  return {
    record,
    score: Math.max(0, Math.min(1, score)),
    titleScore,
    artistScore,
    durationDiff,
  };
}

/** Deterministic ranking: score, then synced, then smaller duration gap, then id. */
export function rankCandidates(query: TrackQuery, records: LrclibRecord[]): ScoredCandidate[] {
  const seen = new Set<number>();
  return records
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .map((r) => scoreCandidate(query, r))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(!!b.record.syncedLyrics) - Number(!!a.record.syncedLyrics) ||
        (a.durationDiff ?? 999) - (b.durationDiff ?? 999) ||
        a.record.id - b.record.id,
    );
}

const COVER_BRACKET_RE = /\s*[([【]([^)\]】]*\bcover\b[^)\]】]*)[)\]】]\s*/i;
const COVER_BY_RE = /\s+[-–—|]?\s*\bcover(?:ed)?\s+by\s+.+$/i;

/** Remove "(X Cover)", "[Cover by X]" or a trailing "cover by X" from a title. */
export function stripCover(title: string): { title: string; isCover: boolean } {
  const out = title.replace(COVER_BRACKET_RE, ' ').replace(COVER_BY_RE, '').trim();
  return out && out !== title.trim()
    ? { title: out.replace(/\s+/g, ' '), isCover: true }
    : { title, isCover: false };
}

/**
 * Ways to read the query. YouTube uploads use both "Artist - Song" and
 * "Song - Artist", so when an artist was guessed the swapped reading is tried
 * too. Cover credits are removed so the original recording can be found.
 */
export function queryReadings(query: TrackQuery): { readings: TrackQuery[]; isCover: boolean } {
  const t = stripCover(query.title);
  const a = stripCover(query.artist);
  const isCover = t.isCover || a.isCover;
  const main: TrackQuery = { ...query, title: t.title, artist: a.title };
  const readings: TrackQuery[] = [];
  // "Song by Artist" (no dash), e.g. "Takkan Terganti by Marcell (cover by X)".
  // Split on the last " by " so titles like "Stand by Me by Ben E. King" work.
  const by = / by (?!.* by )(.+)$/i.exec(main.title);
  if (by?.[1] && by.index > 0) {
    readings.push({ ...main, title: main.title.slice(0, by.index).trim(), artist: by[1].trim() });
  }
  readings.push(main);
  if (main.artist && normalizeText(main.artist) !== normalizeText(main.title)) {
    readings.push({ ...main, title: main.artist, artist: main.title });
  }
  return { readings, isCover };
}

/** Rank against every reading; each record keeps its best score. */
function rankReadings(readings: TrackQuery[], records: LrclibRecord[]): ScoredCandidate[] {
  const best = new Map<number, ScoredCandidate>();
  for (const q of readings) {
    for (const c of rankCandidates(q, records)) {
      const prev = best.get(c.record.id);
      if (!prev || c.score > prev.score) best.set(c.record.id, c);
    }
  }
  return [...best.values()].sort(
    (a, b) =>
      b.score - a.score ||
      Number(!!b.record.syncedLyrics) - Number(!!a.record.syncedLyrics) ||
      (a.durationDiff ?? 999) - (b.durationDiff ?? 999) ||
      a.record.id - b.record.id,
  );
}

/** LRCLIB often holds several uploads of one recording; offer each once. */
function distinct(ranked: ScoredCandidate[]): ScoredCandidate[] {
  const seen = new Set<string>();
  return ranked.filter((c) => {
    const r = c.record;
    const key = [
      normalizeText(r.artistName),
      normalizeText(r.trackName),
      Math.round(r.duration ?? -1),
      !!r.syncedLyrics,
    ].join('|');
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

function decide(ranked: ScoredCandidate[], isCover = false, minTitle = 0.8): Resolution | null {
  const best = ranked[0];
  if (!best) return null;
  // A cover usually has its own tempo and length. The original's timing is
  // only trusted when the lengths agree; otherwise the user chooses.
  const coverMismatch =
    isCover &&
    !versionTags(best.record.trackName).has('cover') &&
    (best.durationDiff === null || best.durationDiff > 5);
  if (!coverMismatch && best.score >= ACCEPT_SCORE && best.titleScore >= minTitle) {
    return { kind: 'match', candidate: best, alternatives: ranked.slice(1, 6) };
  }
  return null;
}

/**
 * Look up lyrics for a track.
 * 1. Exact `/api/get` with duration (LRCLIB matches duration within ±2 s).
 * 2. Field search by title + artist, then by title alone, for both the
 *    "Artist - Song" and "Song - Artist" readings.
 * 3. Free-text search with the raw page title.
 * Low-confidence results are returned as `ambiguous` for the user to choose.
 */
export async function resolveLyrics(
  client: LrclibClient,
  query: TrackQuery,
  signal?: AbortSignal,
): Promise<Resolution> {
  const pool: LrclibRecord[] = [];
  const { readings, isCover } = queryReadings(query);
  const main = readings[0] ?? query;

  if (main.artist && main.duration != null && !isCover) {
    const exact = await client.get(
      { trackName: main.title, artistName: main.artist, duration: main.duration },
      signal,
    );
    if (exact) {
      const scored = scoreCandidate(main, exact);
      if (scored.titleScore >= 0.8 && scored.artistScore >= 0.7) {
        return { kind: 'match', candidate: scored, alternatives: [] };
      }
      pool.push(exact);
    }
  }

  const attempts: Array<Parameters<LrclibClient['search']>[0]> = [];
  for (const r of readings) {
    if (r.artist) attempts.push({ trackName: r.title, artistName: r.artist });
  }
  for (const r of readings) attempts.push({ trackName: r.title });
  if (query.rawTitle && normalizeText(query.rawTitle) !== normalizeText(query.title)) {
    attempts.push({ q: stripCover(stripTitleNoise(query.rawTitle)).title });
  }

  let lastError: unknown = null;
  for (const params of attempts) {
    try {
      pool.push(...(await client.search(params, signal)));
    } catch (e) {
      if (signal?.aborted) throw e;
      if (e instanceof LrclibError && e.kind === 'bad-response') {
        lastError = e;
        continue;
      }
      throw e;
    }
    // Stop early only on a near-exact title; a looser match may be beaten
    // by a later attempt (e.g. the other "Song - Artist" reading).
    const early = decide(rankReadings(readings, pool), isCover, 0.95);
    if (early) return early;
  }

  const final = rankReadings(readings, pool);
  const decision = decide(final, isCover);
  if (decision) return decision;
  const ranked = distinct(final.filter((c) => c.score >= OFFER_SCORE));
  if (ranked.length > 0) return { kind: 'ambiguous', candidates: ranked.slice(0, 8) };
  if (lastError && pool.length === 0) throw lastError;
  return { kind: 'none' };
}
