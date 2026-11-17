import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SyncPanel, describeMapping } from '../overlay/SyncPanel';
import type { KeyValueStore } from './cache';
import { parseLrc } from './lrc';
import { IDENTITY_SYNC, fitMapping, lyricTime, type PlaybackAnchor } from './sync';
import { MAX_SYNC_ENTRIES, SYNC_STORAGE_KEY, SyncStore, syncKey, useTrackSync } from './syncStore';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const anchor: PlaybackAnchor = {
  position: 100,
  playing: false,
  playbackRate: 1,
  sampledAt: 0,
  duration: null,
};

describe('sync mapping', () => {
  it('applies shift, tempo and the global offset', () => {
    expect(lyricTime(anchor, 0, 0, IDENTITY_SYNC)).toBe(100);
    expect(lyricTime(anchor, 0, 500, { scale: 1.1, shift: -5 })).toBeCloseTo(105.5);
  });

  it('one tap shifts and keeps the previous tempo', () => {
    expect(fitMapping([{ position: 30, lyric: 40 }])).toEqual({ scale: 1, shift: 10 });
    const m = fitMapping([{ position: 30, lyric: 40 }], { scale: 1.1, shift: 0 });
    expect(m.scale).toBe(1.1);
    expect(30 * m.scale + m.shift).toBeCloseTo(40);
  });

  it('two taps far apart fit the tempo, and the newest tap lands exactly', () => {
    // A cover 10 % slower than the original, starting 5 s later.
    const taps = [
      { position: 25, lyric: 20 / 1.1 + 0 },
      { position: 205, lyric: 200 / 1.1 },
    ];
    const m = fitMapping(taps);
    expect(m.scale).toBeCloseTo(1 / 1.1, 3);
    expect(205 * m.scale + m.shift).toBeCloseTo(200 / 1.1);
  });

  it('ignores taps too close together or an implausible tempo', () => {
    const close = fitMapping([
      { position: 10, lyric: 10 },
      { position: 14, lyric: 30 },
    ]);
    expect(close.scale).toBe(1);
    const wild = fitMapping([
      { position: 10, lyric: 10 },
      { position: 40, lyric: 100 },
    ]);
    expect(wild.scale).toBe(1);
    expect(40 * wild.scale + wild.shift).toBe(100);
  });

  it('uses the earlier tap furthest from the newest one', () => {
    const m = fitMapping([
      { position: 20, lyric: 18 },
      { position: 100, lyric: 95 },
      { position: 120, lyric: 108 },
    ]);
    expect(m.scale).toBeCloseTo((108 - 18) / (120 - 20));
  });

  it('describes the mapping', () => {
    expect(describeMapping({ scale: 1, shift: 2.04 })).toBe('Shift +2.0s');
    expect(describeMapping({ scale: 0.93, shift: -1.5 })).toBe('Shift −1.5s · tempo 93%');
  });
});

describe('SyncStore', () => {
  it('persists per key and survives reloads', () => {
    const mem = memoryStore();
    const a = new SyncStore(mem);
    a.set('v1#1', { mapping: { scale: 0.95, shift: 3 }, taps: [{ position: 1, lyric: 2 }] });
    const b = new SyncStore(mem);
    expect(b.get('v1#1')).toEqual({
      mapping: { scale: 0.95, shift: 3 },
      taps: [{ position: 1, lyric: 2 }],
    });
    expect(b.get('v1#2')).toBeNull();
    b.delete('v1#1');
    expect(new SyncStore(mem).get('v1#1')).toBeNull();
  });

  it('drops corrupt or out-of-range entries', () => {
    const mem = memoryStore();
    mem.setItem(
      SYNC_STORAGE_KEY,
      JSON.stringify({
        good: { mapping: { scale: 1, shift: 1 }, taps: [], t: 1 },
        wild: { mapping: { scale: 9, shift: 1 }, taps: [], t: 1 },
        junk: 'x',
      }),
    );
    const s = new SyncStore(mem);
    expect(s.get('good')).not.toBeNull();
    expect(s.get('wild')).toBeNull();
    expect(s.get('junk')).toBeNull();
    mem.setItem(SYNC_STORAGE_KEY, '{not json');
    expect(new SyncStore(mem).get('good')).toBeNull();
  });

  it('keeps at most MAX_SYNC_ENTRIES, evicting the oldest', () => {
    const s = new SyncStore(memoryStore());
    for (let i = 0; i <= MAX_SYNC_ENTRIES; i++)
      s.set(`k${i}`, { mapping: IDENTITY_SYNC, taps: [] });
    expect(s.get('k0')).toBeNull();
    expect(s.get(`k${MAX_SYNC_ENTRIES}`)).not.toBeNull();
  });

  it('useTrackSync taps, fits, resets, and is separate per key', () => {
    const store = new SyncStore(memoryStore());
    const { result, rerender } = renderHook(({ k }) => useTrackSync(k, store), {
      initialProps: { k: syncKey('video', 7) as string | null },
    });
    expect(result.current.mapping).toEqual(IDENTITY_SYNC);
    act(() => result.current.tap({ position: 20, lyric: 25 }));
    expect(result.current.mapping).toEqual({ scale: 1, shift: 5 });
    act(() => result.current.tap({ position: 120, lyric: 115 }));
    expect(result.current.taps).toBe(2);
    expect(result.current.mapping.scale).toBeCloseTo(0.9);

    rerender({ k: syncKey('other-video', 7) });
    expect(result.current.mapping).toEqual(IDENTITY_SYNC);
    rerender({ k: syncKey('video', 7) });
    expect(result.current.mapping.scale).toBeCloseTo(0.9);

    act(() => result.current.reset());
    expect(result.current.mapping).toEqual(IDENTITY_SYNC);
    expect(store.get(syncKey('video', 7))).toBeNull();
  });
});

describe('SyncPanel', () => {
  const lines = parseLrc('[00:01.00]first\n[00:05.00]\n[00:09.00]second\n[00:15.00]third').lines;

  it('lists sung lines, marks the current one, and reports clicks', () => {
    const onPick = vi.fn();
    render(
      <SyncPanel
        lines={lines}
        index={2}
        mapping={IDENTITY_SYNC}
        taps={0}
        reducedMotion
        onPick={onPick}
        onReset={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(3); // gap line hidden
    expect(screen.getByText('second').closest('button')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('Original timing')).toBeInTheDocument();
    fireEvent.click(screen.getByText('third'));
    expect(onPick).toHaveBeenCalledWith(lines[3]);
  });

  it('shows the fitted mapping and a reset button once calibrated', () => {
    const onReset = vi.fn();
    render(
      <SyncPanel
        lines={lines}
        index={0}
        mapping={{ scale: 0.9, shift: 4 }}
        taps={2}
        reducedMotion
        onPick={() => {}}
        onReset={onReset}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Shift +4.0s · tempo 90%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onReset).toHaveBeenCalled();
  });
});
