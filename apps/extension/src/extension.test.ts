import type { PlaybackState } from '@lyricsdock/shared';
import { describe, expect, it, vi } from 'vitest';
import { BridgeClient } from './background/bridgeClient';
import { TabRegistry, TAB_EXPIRY_MS } from './background/tabs';
import {
  buildState,
  extractTrack,
  isAdShowing,
  isPlaybackPage,
  sourceFromHost,
  videoIdFromUrl,
  type MediaSample,
} from './content/extract';
import { shouldSendNow } from './content/throttle';
import { isIncomingMessage } from './shared/messages';

function doc(html: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><head><title>t</title></head><body>${html}</body></html>`,
    'text/html',
  );
}

const YT_WATCH = `
<div id="movie_player" class="html5-video-player playing-mode"><video class="html5-main-video" src="blob:x"></video></div>
<ytd-watch-metadata>
  <h1><yt-formatted-string>Rick Astley - Never Gonna Give You Up (Official Music Video)</yt-formatted-string></h1>
  <div id="owner"><ytd-channel-name><a href="/@RickAstleyYT">Rick Astley</a></ytd-channel-name></div>
</ytd-watch-metadata>`;

const YTM_PLAYER = `
<ytmusic-player><video src="blob:y"></video></ytmusic-player>
<ytmusic-player-bar>
  <yt-formatted-string class="title">Blinding Lights</yt-formatted-string>
  <span class="subtitle"><yt-formatted-string class="byline"><a>The Weeknd</a> • <a>After Hours</a> • 2020</yt-formatted-string></span>
</ytmusic-player-bar>`;

const media: MediaSample = {
  currentTime: 42.5,
  duration: 213,
  paused: false,
  ended: false,
  playbackRate: 1,
  readyState: 4,
};

describe('page detection', () => {
  it('maps hosts to sources', () => {
    expect(sourceFromHost('www.youtube.com')).toBe('youtube');
    expect(sourceFromHost('music.youtube.com')).toBe('youtube-music');
    expect(sourceFromHost('youtube.com.evil.example')).toBeNull();
  });

  it('extracts video ids from watch and shorts URLs only when valid', () => {
    expect(videoIdFromUrl(new URL('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1'))).toBe(
      'dQw4w9WgXcQ',
    );
    expect(videoIdFromUrl(new URL('https://www.youtube.com/shorts/abcDEF12345'))).toBe(
      'abcDEF12345',
    );
    expect(videoIdFromUrl(new URL('https://www.youtube.com/watch?v=<script>'))).toBeNull();
    expect(videoIdFromUrl(new URL('https://www.youtube.com/'))).toBeNull();
  });

  it('ignores home/search previews on YouTube but not YouTube Music', () => {
    expect(isPlaybackPage('youtube', new URL('https://www.youtube.com/watch?v=x'))).toBe(true);
    expect(
      isPlaybackPage('youtube', new URL('https://www.youtube.com/results?search_query=x')),
    ).toBe(false);
    expect(isPlaybackPage('youtube-music', new URL('https://music.youtube.com/library'))).toBe(
      true,
    );
  });

  it('detects ads', () => {
    expect(isAdShowing(doc('<div id="movie_player" class="ad-showing"></div>'), 'youtube')).toBe(
      true,
    );
    expect(isAdShowing(doc(YT_WATCH), 'youtube')).toBe(false);
  });
});

describe('track extraction', () => {
  it('parses a YouTube watch page from the DOM', () => {
    expect(extractTrack(doc(YT_WATCH), 'youtube', null)).toEqual({
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      rawTitle: 'Rick Astley - Never Gonna Give You Up (Official Music Video)',
      channel: 'Rick Astley',
    });
  });

  it('falls back to Media Session metadata when DOM selectors miss', () => {
    const t = extractTrack(doc('<div></div>'), 'youtube', {
      title: 'Queen - Bohemian Rhapsody',
      artist: 'Queen Official',
    });
    expect(t).toMatchObject({ title: 'Bohemian Rhapsody', artist: 'Queen' });
  });

  it('falls back to document.title', () => {
    const d = doc('');
    d.title = '(3) Artist - Track - YouTube';
    expect(extractTrack(d, 'youtube', null)).toMatchObject({ title: 'Track', artist: 'Artist' });
  });

  it('returns null when nothing identifies the track', () => {
    const d = doc('');
    d.title = 'YouTube';
    expect(extractTrack(d, 'youtube', null)).toBeNull();
  });

  it('reads YouTube Music player bar (artist = first byline entry)', () => {
    expect(extractTrack(doc(YTM_PLAYER), 'youtube-music', null)).toMatchObject({
      title: 'Blinding Lights',
      artist: 'The Weeknd',
    });
  });

  it('prefers Media Session on YouTube Music', () => {
    expect(
      extractTrack(doc(YTM_PLAYER), 'youtube-music', {
        title: 'Save Your Tears',
        artist: 'The Weeknd',
      }),
    ).toMatchObject({
      title: 'Save Your Tears',
    });
  });
});

describe('state normalization', () => {
  const track = { title: 'T', artist: 'A', rawTitle: 'A - T', channel: 'A' };

  it('builds a valid state from a media sample', () => {
    const s = buildState('youtube', track, media, 'dQw4w9WgXcQ', 1000);
    expect(s).toMatchObject({
      position: 42.5,
      duration: 213,
      playing: true,
      playbackRate: 1,
      capturedAt: 1000,
    });
  });

  it('handles live streams, buffering, ended and broken numbers', () => {
    expect(
      buildState('youtube', track, { ...media, duration: Infinity }, null, 0).duration,
    ).toBeNull();
    expect(
      buildState('youtube', track, { ...media, duration: Number.NaN }, null, 0).duration,
    ).toBeNull();
    expect(buildState('youtube', track, { ...media, readyState: 1 }, null, 0).playing).toBe(false);
    expect(buildState('youtube', track, { ...media, ended: true }, null, 0).playing).toBe(false);
    expect(
      buildState('youtube', track, { ...media, currentTime: Number.NaN }, null, 0).position,
    ).toBe(0);
    expect(buildState('youtube', track, { ...media, playbackRate: 0 }, null, 0).playbackRate).toBe(
      1,
    );
  });

  it('clips oversized text to protocol limits', () => {
    const s = buildState('youtube', { ...track, title: 'x'.repeat(1000) }, media, null, 0);
    expect(s.title).toHaveLength(300);
  });
});

function state(over: Partial<PlaybackState> = {}): PlaybackState {
  return {
    source: 'youtube',
    title: 'T',
    artist: 'A',
    rawTitle: 'A - T',
    channel: 'A',
    videoId: 'abc',
    duration: 200,
    position: 10,
    playing: true,
    playbackRate: 1,
    capturedAt: 0,
    ...over,
  };
}

describe('update throttling', () => {
  it('sends immediately on track change, play/pause and seek', () => {
    expect(shouldSendNow(null, state(), 0)).toBe(true);
    expect(shouldSendNow(state(), null, 0)).toBe(true);
    expect(shouldSendNow(null, null, 0)).toBe(false);
    expect(shouldSendNow(state(), state({ videoId: 'other' }), 0)).toBe(true);
    expect(shouldSendNow(state(), state({ playing: false }), 0)).toBe(true);
    expect(shouldSendNow(state(), state({ position: 60, capturedAt: 100 }), 100)).toBe(true);
  });

  it('limits steady playback to ~2 Hz and paused heartbeats to every 2.5 s', () => {
    const a = state();
    expect(shouldSendNow(a, state({ position: 10.2, capturedAt: 200 }), 200)).toBe(false);
    expect(shouldSendNow(a, state({ position: 10.5, capturedAt: 500 }), 500)).toBe(true);
    const p = state({ playing: false });
    expect(shouldSendNow(p, state({ playing: false, capturedAt: 1000 }), 1000)).toBe(false);
    expect(shouldSendNow(p, state({ playing: false, capturedAt: 3000 }), 3000)).toBe(true);
  });
});

describe('tab selection', () => {
  it('prefers the playing tab, then the most recently started one', () => {
    const r = new TabRegistry();
    r.update(1, state({ playing: false, title: 'paused' }), 100);
    r.update(2, state({ title: 'first' }), 200);
    expect(r.active(250)?.tabId).toBe(2);
    r.update(3, state({ title: 'second' }), 300);
    expect(r.active(350)?.tabId).toBe(3);
    // Tab 2 keeps playing (updates) but did not *start* more recently.
    r.update(2, state({ title: 'first' }), 400);
    expect(r.active(450)?.tabId).toBe(3);
    // Pausing tab 3 hands over to tab 2.
    r.update(3, state({ playing: false, title: 'second' }), 500);
    expect(r.active(550)?.tabId).toBe(2);
  });

  it('falls back to the most recently updated paused tab, ties by lower id', () => {
    const r = new TabRegistry();
    r.update(5, state({ playing: false }), 100);
    r.update(4, state({ playing: false }), 100);
    expect(r.active(150)?.tabId).toBe(4);
    r.update(5, state({ playing: false }), 200);
    expect(r.active(250)?.tabId).toBe(5);
  });

  it('forgets closed, cleared and silent tabs', () => {
    const r = new TabRegistry();
    r.update(1, state(), 0);
    r.update(2, state(), 0);
    r.remove(1);
    r.update(2, null, 10);
    expect(r.active(20)).toBeNull();
    r.update(3, state(), 0);
    expect(r.active(TAB_EXPIRY_MS + 1)).toBeNull();
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const KEY = '7K3M-9QZT-XW2P-4N8R';
const TOKEN = 'a'.repeat(64);

describe('BridgeClient', () => {
  it('does nothing without a valid key', async () => {
    const f = vi.fn();
    const c = new BridgeClient({ fetch: f, clientVersion: '0.1.0' });
    c.setKey('not a key');
    await c.send(state());
    expect(f).not.toHaveBeenCalled();
    expect(c.connection).toBe('no-key');
  });

  it('pairs, then posts state with the session token and increasing seq', async () => {
    const f = vi.fn(async (url: string, _init: RequestInit) => {
      if (url.endsWith('/v1/hello'))
        return json({ protocol: 1, sessionToken: TOKEN, appVersion: '0.1.0' });
      return json({ ok: true });
    });
    const c = new BridgeClient({ fetch: f, clientVersion: '0.1.0' });
    c.setKey(KEY.toLowerCase());
    await c.send(state());
    await c.send(null);
    expect(c.connection).toBe('connected');
    const hello = JSON.parse(f.mock.calls[0]![1].body as string);
    expect(hello.pairingKey).toBe('7K3M9QZTXW2P4N8R');
    const [url, init] = f.mock.calls[1]!;
    expect(url).toBe('http://127.0.0.1:47811/v1/state');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(f.mock.calls[2]![1].body as string)).toMatchObject({ seq: 2, state: null });
  });

  it('tries the next port when the first is not the app', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes(':47811')) throw new TypeError('connection refused');
      if (url.endsWith('/v1/hello'))
        return json({ protocol: 1, sessionToken: TOKEN, appVersion: '0.1.0' });
      return json({ ok: true });
    });
    const c = new BridgeClient({ fetch: f, clientVersion: '0.1.0' });
    c.setKey(KEY);
    await c.send(state());
    expect(c.currentPort).toBe(47812);
  });

  it('reports the app offline and backs off', async () => {
    let now = 0;
    const f = vi.fn(async () => {
      throw new TypeError('refused');
    });
    const c = new BridgeClient({ fetch: f, clientVersion: '0.1.0', now: () => now, retryMs: 3000 });
    c.setKey(KEY);
    await c.send(state());
    expect(c.connection).toBe('app-offline');
    const calls = f.mock.calls.length;
    await c.send(state());
    expect(f.mock.calls.length).toBe(calls); // within back-off window
    now = 3001;
    await c.send(state());
    expect(f.mock.calls.length).toBeGreaterThan(calls);
  });

  it('re-authenticates once when the app restarted (401)', async () => {
    let hellos = 0;
    let states = 0;
    const f = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/hello')) {
        hellos++;
        return json({ protocol: 1, sessionToken: TOKEN, appVersion: '0.1.0' });
      }
      states++;
      return states === 2 ? json({ error: 'unauthorized' }, 401) : json({ ok: true });
    });
    const c = new BridgeClient({ fetch: f, clientVersion: '0.1.0' });
    c.setKey(KEY);
    await c.send(state());
    await c.send(state());
    expect(hellos).toBe(2);
    expect(states).toBe(3);
    expect(c.connection).toBe('connected');
  });

  it('maps pairing errors to user-facing states', async () => {
    for (const [code, expected] of [
      ['bad_pairing_key', 'bad-key'],
      ['origin_not_paired', 'origin-mismatch'],
      ['too_many_attempts', 'locked'],
      ['bridge_disabled', 'disabled'],
    ] as const) {
      const c = new BridgeClient({
        fetch: vi.fn(async () => json({ error: code }, 401)),
        clientVersion: '0.1.0',
      });
      c.setKey(KEY);
      await c.send(state());
      expect(c.connection).toBe(expected);
    }
  });

  it('rejects a hello response with an unsafe token', async () => {
    const c = new BridgeClient({
      fetch: vi.fn(async () => json({ protocol: 1, sessionToken: 'bad token!', appVersion: '1' })),
      clientVersion: '0.1.0',
    });
    c.setKey(KEY);
    await c.send(state());
    expect(c.connection).toBe('error');
  });
});

describe('message guards', () => {
  it('accepts only known message types', () => {
    expect(isIncomingMessage({ type: 'media-state', state: null })).toBe(true);
    expect(isIncomingMessage({ type: 'run-code' })).toBe(false);
    expect(isIncomingMessage(null)).toBe(false);
  });
});
