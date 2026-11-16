import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LyricsCache } from '../lyrics/cache';
import type { LyricsContent } from '../lyrics/content';
import { parseLrc } from '../lyrics/lrc';
import type { LrclibClient, LrclibRecord } from '../lyrics/lrclib';
import { LyricsView } from '../lyrics/LyricsView';
import { useLyrics, type LyricsDeps } from '../lyrics/useLyrics';
import { Overlay, StatusBody } from './Overlay';

const synced: LyricsContent = {
  kind: 'synced',
  lines: parseLrc('[00:01.00]first line\n[00:02.00]second line\n[00:03.00]third line').lines,
  record: null,
};

const query = { title: 'Song', artist: 'Artist', duration: 200 };

describe('LyricsView', () => {
  it('shows previous, current and next lines in context mode', () => {
    render(<LyricsView content={synced} index={1} mode="context" />);
    expect(screen.getByText('first line')).toHaveClass('line--prev');
    expect(screen.getByText('second line')).toHaveClass('line--current');
    expect(screen.getByText('third line')).toHaveClass('line--next');
  });

  it('shows only the current line in single mode', () => {
    render(<LyricsView content={synced} index={1} mode="single" />);
    expect(screen.getByText('second line')).toBeInTheDocument();
    expect(screen.queryByText('first line')).toBeNull();
    expect(screen.queryByText('third line')).toBeNull();
  });

  it('shows a note before the first timestamp and previews the first line', () => {
    render(<LyricsView content={synced} index={-1} mode="context" />);
    expect(screen.getByText('♪')).toHaveClass('line--current');
    expect(screen.getByText('first line')).toHaveClass('line--next');
  });

  it('renders plain lyrics as an unsynchronized, labelled list', () => {
    render(
      <LyricsView
        content={{ kind: 'plain', lines: ['alpha', '', 'beta'], record: null }}
        index={0}
        mode="context"
      />,
    );
    expect(screen.getByLabelText('Plain lyrics, not synchronized')).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
  });

  it('renders instrumental tracks', () => {
    render(
      <LyricsView content={{ kind: 'instrumental', record: null }} index={0} mode="context" />,
    );
    expect(screen.getByText('♪ Instrumental')).toBeInTheDocument();
  });
});

describe('StatusBody', () => {
  const noop = () => {};
  const props = { bridgeStatus: null, onRetry: noop, onSearch: noop, onDemo: noop };

  it('loading', () => {
    render(<StatusBody {...props} status={{ phase: 'loading', query }} />);
    expect(screen.getByText('Finding lyrics…')).toBeInTheDocument();
    expect(screen.getByText('Song — Artist')).toBeInTheDocument();
  });

  it('no lyrics offers search and retry', () => {
    const onSearch = vi.fn();
    render(<StatusBody {...props} onSearch={onSearch} status={{ phase: 'not-found', query }} />);
    expect(screen.getByText('No lyrics found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(onSearch).toHaveBeenCalled();
  });

  it('offline error offers retry', () => {
    const onRetry = vi.fn();
    render(
      <StatusBody
        {...props}
        onRetry={onRetry}
        status={{ phase: 'error', query, error: 'offline' }}
      />,
    );
    expect(screen.getByText('Offline')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('idle explains the missing connection', () => {
    render(
      <StatusBody
        {...props}
        status={{ phase: 'idle' }}
        bridgeStatus={{
          enabled: true,
          port: 47811,
          connected: false,
          paired: false,
          clientName: null,
          listening: true,
          error: null,
        }}
      />,
    );
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByText(/Pair the Brave extension/)).toBeInTheDocument();
  });

  it('ambiguous asks the user to choose', () => {
    render(<StatusBody {...props} status={{ phase: 'ambiguous', query, candidates: [] }} />);
    expect(screen.getByRole('button', { name: /choose match/i })).toBeInTheDocument();
  });
});

function record(over: Partial<LrclibRecord> = {}): LrclibRecord {
  return {
    id: 7,
    trackName: 'Song',
    artistName: 'Artist',
    albumName: '',
    duration: 200,
    instrumental: false,
    plainLyrics: 'first line',
    syncedLyrics: '[00:01.00]first line',
    ...over,
  };
}

function deps(client: Partial<LrclibClient>): LyricsDeps {
  return {
    client: { get: vi.fn(async () => null), search: vi.fn(async () => []), ...client },
    cache: new LyricsCache(null),
    debounceMs: 0,
  };
}

describe('useLyrics', () => {
  it('goes idle → loading → ready and caches the result', async () => {
    const d = deps({ get: vi.fn(async () => record()) });
    const { result, rerender } = renderHook(({ q }) => useLyrics(q, d), {
      initialProps: { q: query },
    });
    expect(result.current.status.phase).toBe('loading');
    await waitFor(() => expect(result.current.status.phase).toBe('ready'));
    expect(d.client.get).toHaveBeenCalledTimes(1);

    // Same track with a new object (position update) must not refetch.
    rerender({ q: { ...query } });
    await act(async () => {});
    expect(d.client.get).toHaveBeenCalledTimes(1);
  });

  it('reports not-found and error states', async () => {
    const notFound = deps({});
    const a = renderHook(() => useLyrics(query, notFound));
    await waitFor(() => expect(a.result.current.status.phase).toBe('not-found'));

    const failing = deps({
      get: vi.fn(async () => {
        throw new TypeError('x');
      }),
    });
    const b = renderHook(() => useLyrics(query, failing));
    await waitFor(() => expect(b.result.current.status.phase).toBe('error'));
  });

  it('manual choice overrides and is remembered', async () => {
    const d = deps({});
    const { result } = renderHook(() => useLyrics(query, d));
    await waitFor(() => expect(result.current.status.phase).toBe('not-found'));
    act(() => result.current.choose(record({ id: 99 })));
    expect(result.current.status).toMatchObject({ phase: 'ready', manual: true });
    const again = renderHook(() => useLyrics(query, d));
    expect(again.result.current.status).toMatchObject({ phase: 'ready', manual: true });
  });

  it('goes idle when the track disappears', async () => {
    const d = deps({ get: vi.fn(async () => record()) });
    const { result, rerender } = renderHook(({ q }) => useLyrics(q, d), {
      initialProps: { q: query as typeof query | null },
    });
    rerender({ q: null });
    expect(result.current.status.phase).toBe('idle');
  });
});

describe('Overlay (browser fallback)', () => {
  it('renders the idle state and can enter demo mode', async () => {
    render(<Overlay />);
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try demo' }));
    expect(await screen.findByText('Welcome to LyricsDock demo mode')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit demo' })).toBeInTheDocument();
  });
});
