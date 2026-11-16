/**
 * LRC parser.
 *
 * Supports `[mm:ss]`, `[mm:ss.xx]`, `[mm:ss.xxx]`, `[mm:ss:xx]` and
 * `[h:mm:ss.xx]` (the fraction disambiguates it from `[mm:ss:xx]`), several timestamps on one line, the `[offset:±ms]` tag, and
 * strips enhanced word-timing tags (`<mm:ss.xx>`) because the overlay only
 * renders whole lines. Malformed lines are skipped rather than failing the
 * whole file.
 */

export interface LyricLine {
  /** Seconds from the start of the track. */
  time: number;
  text: string;
}

export interface ParsedLrc {
  lines: LyricLine[];
  /** `[offset:]` tag in ms, already applied to `lines`. */
  offsetMs: number;
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?(?:[.:](\d{1,3}))?\]/y;
const META_TAG = /^\[([a-z#]+):(.*)\]\s*$/i;
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

function fractionToSeconds(frac: string | undefined): number {
  if (!frac) return 0;
  // ".5" = 500ms, ".05" = 50ms, ".005" = 5ms
  return Number(frac) / 10 ** frac.length;
}

function parseTimestamps(line: string): { times: number[]; rest: string } | null {
  const times: number[] = [];
  let pos = 0;
  TIME_TAG.lastIndex = 0;
  for (;;) {
    while (line[pos] === ' ' || line[pos] === '\t') pos++;
    TIME_TAG.lastIndex = pos;
    const m = TIME_TAG.exec(line);
    if (!m) break;
    const a = Number(m[1]);
    const b = Number(m[2]);
    let seconds: number;
    if (m[3] !== undefined && m[4] !== undefined) {
      // [h:mm:ss.xx]
      const c = Number(m[3]);
      if (b > 59 || c > 59) return null;
      seconds = a * 3600 + b * 60 + c + fractionToSeconds(m[4]);
    } else if (m[3] !== undefined) {
      // [mm:ss:xx] — colon used as the fraction separator.
      if (b > 59) return null;
      seconds = a * 60 + b + fractionToSeconds(m[3]);
    } else {
      if (b > 59) return null;
      seconds = a * 60 + b + fractionToSeconds(m[4]);
    }
    times.push(seconds);
    pos = TIME_TAG.lastIndex;
  }
  if (times.length === 0) return null;
  return { times, rest: line.slice(pos) };
}

export function parseLrc(input: string): ParsedLrc {
  let offsetMs = 0;
  const raw: LyricLine[] = [];

  for (const rawLine of input.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const parsed = parseTimestamps(line);
    if (!parsed) {
      const meta = META_TAG.exec(line);
      if (meta?.[1]?.toLowerCase() === 'offset') {
        const v = Number((meta[2] ?? '').trim());
        if (Number.isFinite(v)) offsetMs = Math.max(-60_000, Math.min(60_000, v));
      }
      continue;
    }
    const text = parsed.rest.replace(WORD_TAG, '').replace(/\s+/g, ' ').trim();
    for (const t of parsed.times) {
      if (Number.isFinite(t)) raw.push({ time: t, text });
    }
  }

  // Per the LRC convention a positive offset makes lyrics appear sooner.
  const shift = offsetMs / 1000;
  const shifted = raw.map((l) => ({ time: Math.max(0, l.time - shift), text: l.text }));

  // Stable sort keeps file order for equal timestamps.
  shifted.sort((x, y) => x.time - y.time);

  // Merge lines that share a timestamp (e.g. original + translation).
  const lines: LyricLine[] = [];
  for (const l of shifted) {
    const prev = lines[lines.length - 1];
    if (prev && Math.abs(prev.time - l.time) < 0.001) {
      if (l.text && prev.text !== l.text)
        prev.text = prev.text ? `${prev.text}\n${l.text}` : l.text;
    } else {
      lines.push({ ...l });
    }
  }
  return { lines, offsetMs };
}

/** Lines that only mark an instrumental gap. */
export function isGapLine(text: string): boolean {
  return text.trim() === '' || /^[♪♫♬\s.…-]+$/.test(text);
}

export function splitPlainLyrics(plain: string): string[] {
  return plain
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .reduce<string[]>((acc, l) => {
      // Collapse runs of blank lines to a single stanza break.
      if (l === '' && (acc.length === 0 || acc[acc.length - 1] === '')) return acc;
      acc.push(l);
      return acc;
    }, [])
    .filter((l, i, arr) => !(l === '' && i === arr.length - 1));
}
