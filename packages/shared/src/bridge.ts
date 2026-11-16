/**
 * Wire protocol between the LyricsDock browser extension and the desktop app.
 *
 * The desktop app is the security boundary and re-validates everything in Rust
 * (see apps/desktop/src-tauri/src/bridge/schema.rs). These TypeScript validators
 * exist so the extension never sends malformed data and so the overlay can
 * defensively re-check events it receives. Keep both sides in sync.
 */

export const BRIDGE_PROTOCOL_VERSION = 1;

/** Loopback ports tried in order. The desktop app binds the first free one. */
export const BRIDGE_PORTS = [47811, 47812, 47813] as const;
export const BRIDGE_HOST = '127.0.0.1';

export const SOURCE_TYPES = ['youtube', 'youtube-music'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const LIMITS = {
  title: 300,
  artist: 200,
  rawTitle: 300,
  channel: 200,
  videoId: 32,
  maxSeconds: 24 * 60 * 60,
  pairingKey: 64,
  clientName: 64,
  clientVersion: 32,
  maxBodyBytes: 4096,
} as const;

export interface PlaybackState {
  source: SourceType;
  /** Best-guess track title after cleanup. */
  title: string;
  /** Best-guess artist; empty string when unknown. */
  artist: string;
  /** Title as shown by the page before cleanup, kept as a fallback search key. */
  rawTitle: string;
  /** Channel / uploader name; empty string when unknown. */
  channel: string;
  videoId: string | null;
  /** Seconds; null when the media duration is not known (e.g. live streams). */
  duration: number | null;
  /** Current media position in seconds, read from the HTMLMediaElement. */
  position: number;
  playing: boolean;
  playbackRate: number;
  /** Epoch milliseconds when `position` was sampled. */
  capturedAt: number;
}

export interface HelloRequest {
  protocol: number;
  pairingKey: string;
  client: { name: string; version: string };
}

export interface HelloResponse {
  protocol: number;
  sessionToken: string;
  appVersion: string;
}

export interface StateRequest {
  protocol: number;
  seq: number;
  state: PlaybackState | null;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function boundedString(v: unknown, max: number, field: string, allowEmpty = true): string {
  if (typeof v !== 'string') throw new Error(`${field} must be a string`);
  if (v.length > max) throw new Error(`${field} exceeds ${max} characters`);
  if (!allowEmpty && v.trim().length === 0) throw new Error(`${field} must not be empty`);
  return v;
}

function finiteNumber(v: unknown, min: number, max: number, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${field} must be a number`);
  if (v < min || v > max) throw new Error(`${field} out of range`);
  return v;
}

function wrap<T>(fn: () => T): ValidationResult<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'invalid' };
  }
}

export function isSourceType(v: unknown): v is SourceType {
  return typeof v === 'string' && (SOURCE_TYPES as readonly string[]).includes(v);
}

export function validatePlaybackState(input: unknown): ValidationResult<PlaybackState> {
  return wrap(() => {
    if (!isRecord(input)) throw new Error('state must be an object');
    if (!isSourceType(input.source)) throw new Error('source not supported');
    const videoId = input.videoId;
    if (videoId !== null && (typeof videoId !== 'string' || !VIDEO_ID_RE.test(videoId))) {
      throw new Error('videoId invalid');
    }
    const duration =
      input.duration === null
        ? null
        : finiteNumber(input.duration, 0, LIMITS.maxSeconds, 'duration');
    if (typeof input.playing !== 'boolean') throw new Error('playing must be a boolean');
    return {
      source: input.source,
      title: boundedString(input.title, LIMITS.title, 'title', false),
      artist: boundedString(input.artist, LIMITS.artist, 'artist'),
      rawTitle: boundedString(input.rawTitle, LIMITS.rawTitle, 'rawTitle'),
      channel: boundedString(input.channel, LIMITS.channel, 'channel'),
      videoId,
      duration,
      position: finiteNumber(input.position, 0, LIMITS.maxSeconds, 'position'),
      playing: input.playing,
      playbackRate: finiteNumber(input.playbackRate, 0.0625, 16, 'playbackRate'),
      capturedAt: finiteNumber(input.capturedAt, 0, Number.MAX_SAFE_INTEGER, 'capturedAt'),
    };
  });
}

export function validateStateRequest(input: unknown): ValidationResult<StateRequest> {
  return wrap(() => {
    if (!isRecord(input)) throw new Error('request must be an object');
    if (input.protocol !== BRIDGE_PROTOCOL_VERSION) throw new Error('unsupported protocol');
    const seq = finiteNumber(input.seq, 0, Number.MAX_SAFE_INTEGER, 'seq');
    if (!Number.isInteger(seq)) throw new Error('seq must be an integer');
    let state: PlaybackState | null = null;
    if (input.state !== null) {
      const r = validatePlaybackState(input.state);
      if (!r.ok) throw new Error(r.error);
      state = r.value;
    }
    return { protocol: BRIDGE_PROTOCOL_VERSION, seq, state };
  });
}

export function validateHelloResponse(input: unknown): ValidationResult<HelloResponse> {
  return wrap(() => {
    if (!isRecord(input)) throw new Error('response must be an object');
    if (input.protocol !== BRIDGE_PROTOCOL_VERSION) throw new Error('unsupported protocol');
    const token = boundedString(input.sessionToken, 128, 'sessionToken', false);
    if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new Error('sessionToken invalid');
    return {
      protocol: BRIDGE_PROTOCOL_VERSION,
      sessionToken: token,
      appVersion: boundedString(input.appVersion, 32, 'appVersion'),
    };
  });
}

/** Pairing keys are shown as `XXXX-XXXX-XXXX-XXXX` (Crockford base32). */
export function normalizePairingKey(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export function isPlausiblePairingKey(input: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(normalizePairingKey(input));
}

/** Two states describe the same track (used to detect track changes). */
export function sameTrack(a: PlaybackState | null, b: PlaybackState | null): boolean {
  if (!a || !b) return a === b;
  if (a.videoId && b.videoId) return a.videoId === b.videoId && a.title === b.title;
  return a.source === b.source && a.title === b.title && a.artist === b.artist;
}
