import type { PlaybackState, SourceType } from '@lyricsdock/shared';

/** Content script → background. `state: null` means "nothing playing here". */
export interface MediaStateMessage {
  type: 'media-state';
  state: PlaybackState | null;
}

export interface PopupGetStatus {
  type: 'popup-get-status';
}

export interface PopupSetKey {
  type: 'popup-set-key';
  key: string;
}

export interface PopupForget {
  type: 'popup-forget';
}

export type IncomingMessage = MediaStateMessage | PopupGetStatus | PopupSetKey | PopupForget;

export type ConnectionState =
  | 'no-key'
  | 'connecting'
  | 'connected'
  | 'app-offline'
  | 'bad-key'
  | 'origin-mismatch'
  | 'locked'
  | 'disabled'
  | 'error';

export interface PopupStatus {
  connection: ConnectionState;
  detail: string | null;
  port: number | null;
  track: { title: string; artist: string; source: SourceType; playing: boolean } | null;
  hasKey: boolean;
}

export function isIncomingMessage(v: unknown): v is IncomingMessage {
  if (typeof v !== 'object' || v === null) return false;
  const t = (v as { type?: unknown }).type;
  return (
    t === 'media-state' || t === 'popup-get-status' || t === 'popup-set-key' || t === 'popup-forget'
  );
}
