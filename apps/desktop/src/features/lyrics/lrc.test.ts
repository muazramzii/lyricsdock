import { describe, expect, it } from 'vitest';
import { isGapLine, parseLrc, splitPlainLyrics } from './lrc';
import { estimatePosition, findLineIndex, lineWindow, lyricTime, timeToNextLine } from './sync';

describe('parseLrc', () => {
  it('parses standard timestamps with 2- and 3-digit fractions', () => {
    const { lines } = parseLrc('[00:01.50]one\n[00:03.250]two\n[01:02]three');
    expect(lines).toEqual([
      { time: 1.5, text: 'one' },
      { time: 3.25, text: 'two' },
      { time: 62, text: 'three' },
    ]);
  });

  it('supports colon fractions and hour timestamps', () => {
    const { lines } = parseLrc('[00:05:50]colon\n[1:00:00.00]hour');
    expect(lines).toEqual([
      { time: 5.5, text: 'colon' },
      { time: 3600, text: 'hour' },
    ]);
  });

  it('expands multiple timestamps on one line and sorts the result', () => {
    const { lines } = parseLrc('[00:30.00][00:10.00]chorus\n[00:20.00]verse');
    expect(lines.map((l) => [l.time, l.text])).toEqual([
      [10, 'chorus'],
      [20, 'verse'],
      [30, 'chorus'],
    ]);
  });

  it('merges duplicate timestamps (e.g. translations) in file order', () => {
    const { lines } = parseLrc('[00:10.00]Hola\n[00:10.00]Hello\n[00:12.00]next');
    expect(lines[0]).toEqual({ time: 10, text: 'Hola\nHello' });
    expect(lines).toHaveLength(2);
  });

  it('applies the [offset] tag (positive = earlier) and clamps at zero', () => {
    const { lines, offsetMs } = parseLrc('[offset:+500]\n[00:00.20]a\n[00:02.00]b');
    expect(offsetMs).toBe(500);
    expect(lines).toEqual([
      { time: 0, text: 'a' },
      { time: 1.5, text: 'b' },
    ]);
  });

  it('skips metadata, malformed and out-of-range timestamps', () => {
    const { lines } = parseLrc(
      '[ar:Someone]\n[ti:Song]\n[00:61.00]bad seconds\n[xx:yy]bad\nno tag\n[00:04.00]good\n[-00:01.00]negative',
    );
    expect(lines).toEqual([{ time: 4, text: 'good' }]);
  });

  it('strips enhanced word-timing tags and keeps empty gap lines', () => {
    const { lines } = parseLrc('[00:01.00]<00:01.00>Hello <00:01.50>world\n[00:03.00]');
    expect(lines).toEqual([
      { time: 1, text: 'Hello world' },
      { time: 3, text: '' },
    ]);
  });

  it('handles CRLF and empty input', () => {
    expect(parseLrc('[00:01.00]a\r\n[00:02.00]b').lines).toHaveLength(2);
    expect(parseLrc('').lines).toEqual([]);
  });

  it('identifies gap lines', () => {
    expect(isGapLine('')).toBe(true);
    expect(isGapLine(' ♪ ')).toBe(true);
    expect(isGapLine('la ♪')).toBe(false);
  });

  it('splits plain lyrics and collapses blank runs', () => {
    expect(splitPlainLyrics('a\n\n\n\nb\n\n')).toEqual(['a', '', 'b']);
  });
});

describe('line selection', () => {
  const lines = parseLrc('[00:05.00]a\n[00:10.00]b\n[00:15.00]c').lines;

  it('returns -1 before the first line and the last line after the end', () => {
    expect(findLineIndex(lines, 0)).toBe(-1);
    expect(findLineIndex(lines, 4.999)).toBe(-1);
    expect(findLineIndex(lines, 5)).toBe(0);
    expect(findLineIndex(lines, 12)).toBe(1);
    expect(findLineIndex(lines, 999)).toBe(2);
    expect(findLineIndex([], 3)).toBe(-1);
    expect(findLineIndex(lines, Number.NaN)).toBe(-1);
  });

  it('builds previous/current/next windows', () => {
    expect(lineWindow(lines, 1)).toMatchObject({
      previous: { text: 'a' },
      current: { text: 'b' },
      next: { text: 'c' },
    });
    expect(lineWindow(lines, -1)).toMatchObject({
      previous: null,
      current: null,
      next: { text: 'a' },
    });
    expect(lineWindow(lines, 2).next).toBeNull();
  });

  it('computes time to next line', () => {
    expect(timeToNextLine(lines, 6)).toBe(4);
    expect(timeToNextLine(lines, 20)).toBeNull();
  });
});

describe('playback clock', () => {
  const anchor = { position: 10, playing: true, playbackRate: 1, sampledAt: 1000, duration: 30 };

  it('extrapolates while playing and respects playback rate', () => {
    expect(estimatePosition(anchor, 2500)).toBeCloseTo(11.5);
    expect(estimatePosition({ ...anchor, playbackRate: 2 }, 2000)).toBeCloseTo(12);
  });

  it('does not advance while paused', () => {
    expect(estimatePosition({ ...anchor, playing: false }, 60_000)).toBe(10);
  });

  it('caps extrapolation for stale anchors and clamps to duration', () => {
    expect(estimatePosition(anchor, 1_000_000)).toBe(15);
    expect(estimatePosition({ ...anchor, position: 29.5 }, 3000)).toBe(30);
  });

  it('ignores clock skew where now is before the sample', () => {
    expect(estimatePosition(anchor, 0)).toBe(10);
  });

  it('applies the user offset', () => {
    expect(lyricTime(anchor, 1000, 500)).toBeCloseTo(10.5);
    expect(lyricTime(anchor, 1000, -2000)).toBeCloseTo(8);
  });

  it('handles a track restarting at zero (new anchor replaces old)', () => {
    const lines = parseLrc('[00:01.00]a\n[00:20.00]b').lines;
    const late = { ...anchor, position: 25 };
    expect(findLineIndex(lines, estimatePosition(late, 1000))).toBe(1);
    const restarted = { ...anchor, position: 0, sampledAt: 5000 };
    expect(findLineIndex(lines, estimatePosition(restarted, 5000))).toBe(-1);
  });
});
