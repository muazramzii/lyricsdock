import { validatePlaybackState, type PlaybackState } from '@lyricsdock/shared';
import { useEffect, useState } from 'react';
import { api, EVENTS, listen, type BridgeStatus, type StateEvent } from '../../services/tauri';
import type { PlaybackAnchor } from '../lyrics/sync';

export interface BridgeView {
  status: BridgeStatus | null;
  playback: PlaybackState | null;
  anchor: PlaybackAnchor | null;
}

/**
 * Pick the timestamp a position was sampled at. Extension and app share the
 * machine clock, so `capturedAt` is accurate unless something is off (clock
 * change, suspended service worker); then fall back to the receive time.
 */
export function anchorFrom(state: PlaybackState, receivedAt: number): PlaybackAnchor {
  const plausible = state.capturedAt <= receivedAt + 500 && state.capturedAt >= receivedAt - 3000;
  return {
    position: state.position,
    playing: state.playing,
    playbackRate: state.playbackRate,
    sampledAt: plausible ? state.capturedAt : receivedAt,
    duration: state.duration,
  };
}

export function useBridge(): BridgeView {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [anchor, setAnchor] = useState<PlaybackAnchor | null>(null);

  useEffect(() => {
    let alive = true;
    const unlisteners: Array<() => void> = [];
    void api.getBridgeInfo().then((info) => {
      if (alive && info) setStatus(info.status);
    });
    void listen<BridgeStatus>(EVENTS.bridgeStatus, (s) => setStatus(s)).then((u) =>
      alive ? unlisteners.push(u) : u(),
    );
    void listen<StateEvent>(EVENTS.bridgeState, (ev) => {
      if (ev.state === null) {
        setPlayback(null);
        setAnchor(null);
        return;
      }
      // Defence in depth: Rust already validated, but never trust IPC blindly.
      const r = validatePlaybackState(ev.state);
      if (!r.ok) return;
      setPlayback(r.value);
      setAnchor(anchorFrom(r.value, ev.receivedAt));
    }).then((u) => (alive ? unlisteners.push(u) : u()));
    return () => {
      alive = false;
      unlisteners.forEach((u) => u());
    };
  }, []);

  return { status, playback, anchor };
}
