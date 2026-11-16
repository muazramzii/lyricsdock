import { parseLrc, splitPlainLyrics, type LyricLine } from './lrc';
import type { LrclibRecord } from './lrclib';

export type LyricsContent =
  | { kind: 'synced'; lines: LyricLine[]; record: LrclibRecord | null }
  | { kind: 'plain'; lines: string[]; record: LrclibRecord | null }
  | { kind: 'instrumental'; record: LrclibRecord | null };

/**
 * Prefer synced lyrics; fall back to plain text. Only claim "synced" when the
 * LRC actually produced timestamped lines.
 */
export function contentFromRecord(record: LrclibRecord): LyricsContent | null {
  if (record.syncedLyrics) {
    const { lines } = parseLrc(record.syncedLyrics);
    if (lines.length > 0) return { kind: 'synced', lines, record };
  }
  if (record.plainLyrics) {
    const lines = splitPlainLyrics(record.plainLyrics);
    if (lines.length > 0) return { kind: 'plain', lines, record };
  }
  if (record.instrumental) return { kind: 'instrumental', record };
  return null;
}
