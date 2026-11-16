import { describe, expect, it } from 'vitest';
import {
  isPlausiblePairingKey,
  normalizePairingKey,
  sameTrack,
  validateHelloResponse,
  validatePlaybackState,
  validateStateRequest,
  type PlaybackState,
} from './bridge';
import { normalizeText, splitArtists, stripFeaturing, tokenSimilarity } from './normalize';
import { cleanChannelName, parseYouTubeTitle, stripTitleNoise } from './youtubeTitle';

const base: PlaybackState = {
  source: 'youtube',
  title: 'Song',
  artist: 'Artist',
  rawTitle: 'Artist - Song (Official Video)',
  channel: 'ArtistVEVO',
  videoId: 'dQw4w9WgXcQ',
  duration: 212,
  position: 10.5,
  playing: true,
  playbackRate: 1,
  capturedAt: 1_700_000_000_000,
};

describe('validatePlaybackState', () => {
  it('accepts a well-formed state', () => {
    expect(validatePlaybackState(base)).toEqual({ ok: true, value: base });
  });

  it('accepts null duration and videoId', () => {
    const r = validatePlaybackState({ ...base, duration: null, videoId: null });
    expect(r.ok).toBe(true);
  });

  it.each([
    ['non-object', 'hello'],
    ['array', []],
    ['unknown source', { ...base, source: 'spotify' }],
    ['empty title', { ...base, title: '   ' }],
    ['long title', { ...base, title: 'x'.repeat(301) }],
    ['NaN position', { ...base, position: Number.NaN }],
    ['negative position', { ...base, position: -1 }],
    ['infinite duration', { ...base, duration: Number.POSITIVE_INFINITY }],
    ['string playing', { ...base, playing: 'yes' }],
    ['zero playbackRate', { ...base, playbackRate: 0 }],
    ['script videoId', { ...base, videoId: '<script>' }],
    ['missing artist', { ...base, artist: undefined }],
  ])('rejects %s', (_name, input) => {
    expect(validatePlaybackState(input).ok).toBe(false);
  });

  it('drops unknown fields', () => {
    const r = validatePlaybackState({ ...base, evil: 'x' });
    expect(r.ok && 'evil' in r.value).toBe(false);
  });
});

describe('validateStateRequest', () => {
  it('accepts null state (nothing playing)', () => {
    expect(validateStateRequest({ protocol: 1, seq: 3, state: null }).ok).toBe(true);
  });
  it('rejects wrong protocol and fractional seq', () => {
    expect(validateStateRequest({ protocol: 2, seq: 1, state: null }).ok).toBe(false);
    expect(validateStateRequest({ protocol: 1, seq: 1.5, state: null }).ok).toBe(false);
  });
  it('propagates nested state errors', () => {
    const r = validateStateRequest({ protocol: 1, seq: 1, state: { ...base, source: 'x' } });
    expect(r).toEqual({ ok: false, error: 'source not supported' });
  });
});

describe('validateHelloResponse', () => {
  it('accepts a token and rejects unsafe tokens', () => {
    expect(
      validateHelloResponse({ protocol: 1, sessionToken: 'abc_DEF-123', appVersion: '0.1.0' }).ok,
    ).toBe(true);
    expect(
      validateHelloResponse({ protocol: 1, sessionToken: 'a b', appVersion: '0.1.0' }).ok,
    ).toBe(false);
  });
});

describe('pairing keys', () => {
  it('normalizes separators, case and ambiguous characters', () => {
    expect(normalizePairingKey('abcd-efgh-o1il-2345')).toBe('ABCDEFGH01112345');
    expect(isPlausiblePairingKey('7K3M-9QZT-XW2P-4N8R')).toBe(true);
    expect(isPlausiblePairingKey('short')).toBe(false);
    expect(isPlausiblePairingKey('UUUU-UUUU-UUUU-UUUU')).toBe(false);
  });
});

describe('sameTrack', () => {
  it('compares by video id when present, otherwise title/artist', () => {
    expect(sameTrack(base, { ...base, position: 50 })).toBe(true);
    expect(sameTrack(base, { ...base, videoId: 'other' })).toBe(false);
    expect(sameTrack({ ...base, videoId: null }, { ...base, videoId: null, artist: 'B' })).toBe(
      false,
    );
    expect(sameTrack(null, null)).toBe(true);
    expect(sameTrack(base, null)).toBe(false);
  });
});

describe('normalizeText', () => {
  it('folds case, quotes, punctuation and whitespace', () => {
    expect(normalizeText('  Don’t   Stop  Me Now!! ')).toBe('dont stop me now');
    expect(normalizeText('Simon & Garfunkel')).toBe('simon and garfunkel');
  });
  it('keeps non-Latin scripts and accents', () => {
    expect(normalizeText('夜に駆ける')).toBe('夜に駆ける');
    expect(normalizeText('Beyoncé')).toBe('beyoncé');
    expect(normalizeText('Beyoncé')).toBe('beyoncé');
    expect(normalizeText('사랑해')).toBe('사랑해');
  });
  it('splits artists and strips trailing features', () => {
    expect(splitArtists('Calvin Harris, Dua Lipa & Young Thug feat. Kesha')).toEqual([
      'calvin harris',
      'dua lipa',
      'young thug',
      'kesha',
    ]);
    expect(stripFeaturing('Song (feat. Someone)')).toBe('Song');
    expect(stripFeaturing('Song ft. Someone')).toBe('Song');
    expect(stripFeaturing('Without You')).toBe('Without You');
  });
  it('computes token similarity', () => {
    expect(tokenSimilarity('a b c', 'a b c')).toBe(1);
    expect(tokenSimilarity('a b', 'c d')).toBe(0);
    expect(tokenSimilarity('a b', 'a c')).toBeCloseTo(1 / 3);
  });
});

describe('YouTube title parsing', () => {
  it.each([
    [
      'Rick Astley - Never Gonna Give You Up (Official Music Video)',
      'RickAstleyVEVO',
      'Never Gonna Give You Up',
      'Rick Astley',
    ],
    ['Daft Punk - Get Lucky [Official Audio] [HD]', 'Daft Punk', 'Get Lucky', 'Daft Punk'],
    ['Blinding Lights', 'The Weeknd - Topic', 'Blinding Lights', 'The Weeknd'],
    ['Adele – Hello (Live at the BBC)', 'Adele', 'Hello (Live at the BBC)', 'Adele'],
    ['Avicii - Levels (Skrillex Remix)', 'Avicii', 'Levels (Skrillex Remix)', 'Avicii'],
    ['Song Without Separator (Lyrics)', 'Some Channel', 'Song Without Separator', 'Some Channel'],
    ['IU "Blueming" MV', '1theK', 'Blueming', 'IU'],
    ['YOASOBI「夜に駆ける」Official Music Video', 'Ayase / YOASOBI', '夜に駆ける', 'YOASOBI'],
    ['Artist - Track | Official Video', 'x', 'Track', 'Artist'],
    ["Rock 'n' Roll Song", 'Band', "Rock 'n' Roll Song", 'Band'],
  ])('%s', (raw, channel, title, artist) => {
    expect(parseYouTubeTitle(raw, channel)).toEqual({ title, artist });
  });

  it('keeps version information and removes only noise', () => {
    expect(stripTitleNoise("Love Story (Taylor's Version) (Lyric Video)")).toBe(
      "Love Story (Taylor's Version)",
    );
    expect(stripTitleNoise('Song (Acoustic) [4K]')).toBe('Song (Acoustic)');
    expect(stripTitleNoise('Song (with Ed Sheeran)')).toBe('Song (with Ed Sheeran)');
    expect(stripTitleNoise('Never Gonna Give You Up (Official Video) (4K Remaster)')).toBe(
      'Never Gonna Give You Up',
    );
    expect(stripTitleNoise('Song (Remastered 2011)')).toBe('Song');
    expect(stripTitleNoise('Song (2011)')).toBe('Song (2011)');
  });

  it('cleans channel suffixes', () => {
    expect(cleanChannelName('Queen - Topic')).toBe('Queen');
    expect(cleanChannelName('TaylorSwiftVEVO')).toBe('TaylorSwift');
  });
});
