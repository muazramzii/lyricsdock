import type { PlaybackState } from '@lyricsdock/shared';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { Icon } from '../../components/Icon';
import { api, EVENTS, listen, type BridgeStatus } from '../../services/tauri';
import { useBridge } from '../connection/useBridge';
import { LyricsView } from '../lyrics/LyricsView';
import type { LyricsContent } from '../lyrics/content';
import type { TrackQuery } from '../lyrics/matching';
import type { PlaybackAnchor } from '../lyrics/sync';
import { ERROR_MESSAGES, useLyrics, type LyricsStatus } from '../lyrics/useLyrics';
import { useLyricIndex } from '../lyrics/useLyricIndex';
import { prefersReducedMotion, useSettings } from '../settings/useSettings';
import { DEMO_CONTENT, DEMO_TRACK, useDemoAnchor } from './demo';
import { SearchPanel } from './SearchPanel';

const OFFSET_STEP_MS = 250;

const SOURCE_LABEL: Record<PlaybackState['source'], string> = {
  youtube: 'YouTube',
  'youtube-music': 'YouTube Music',
};

function formatOffset(ms: number): string {
  if (ms === 0) return '0.00s';
  return `${ms > 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(2)}s`;
}

function trackQueryFrom(p: PlaybackState | null): TrackQuery | null {
  if (!p) return null;
  return { title: p.title, artist: p.artist, duration: p.duration, rawTitle: p.rawTitle };
}

interface MessageProps {
  title: string;
  detail?: string;
  action?: { label: string; onClick: () => void; icon?: 'retry' | 'search' | 'play' };
  secondary?: { label: string; onClick: () => void };
  busy?: boolean;
}

function Message({ title, detail, action, secondary, busy }: MessageProps) {
  return (
    <div className="message" data-tauri-drag-region role="status">
      <p className={`message__title${busy ? ' message__title--busy' : ''}`} data-tauri-drag-region>
        {title}
      </p>
      {detail && (
        <p className="message__detail" data-tauri-drag-region>
          {detail}
        </p>
      )}
      {(action || secondary) && (
        <div className="message__actions">
          {action && (
            <button type="button" className="btn btn--primary" onClick={action.onClick}>
              {action.icon && <Icon name={action.icon} size={13} />}
              {action.label}
            </button>
          )}
          {secondary && (
            <button type="button" className="btn" onClick={secondary.onClick}>
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function connectionHint(status: BridgeStatus | null): string {
  if (!status) return 'Install the LyricsDock extension in Brave to follow your music.';
  if (status.error) return `Browser bridge unavailable: ${status.error}`;
  if (!status.enabled) return 'Browser connection is turned off in Settings.';
  if (!status.paired) return 'Pair the Brave extension using the key in Settings → Browser.';
  if (!status.connected) return 'Brave extension not connected. Is Brave open?';
  return 'Play a song on YouTube or YouTube Music.';
}

export function Overlay() {
  const { settings, update } = useSettings();
  const bridge = useBridge();
  const [demo, setDemo] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [clickThrough, setClickThrough] = useState(false);

  // Real playback always wins over demo mode.
  const live = bridge.playback !== null;
  const demoActive = demo && !live;
  const demoAnchor = useDemoAnchor(demoActive);

  const query = useMemo(
    () => (demoActive ? null : trackQueryFrom(bridge.playback)),
    // Re-key only when the identity of the track changes, not its position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      demoActive,
      bridge.playback?.title,
      bridge.playback?.artist,
      bridge.playback?.duration,
      bridge.playback?.rawTitle,
    ],
  );
  const lyrics = useLyrics(query);

  const content: LyricsContent | null = demoActive
    ? DEMO_CONTENT
    : lyrics.status.phase === 'ready'
      ? lyrics.status.content
      : null;
  const anchor: PlaybackAnchor | null = demoActive ? demoAnchor : bridge.anchor;
  const syncedLines = content?.kind === 'synced' ? content.lines : null;
  const index = useLyricIndex(syncedLines, anchor, demoActive ? 0 : settings.syncOffsetMs, frozen);

  useEffect(() => {
    void api.getClickThrough().then(setClickThrough);
    let un: (() => void) | undefined;
    void listen<boolean>(EVENTS.clickThrough, setClickThrough).then((u) => (un = u));
    return () => un?.();
  }, []);

  // A new track unfreezes the display.
  useEffect(() => setFrozen(false), [query]);

  const openPanel = useCallback(() => {
    setPanelOpen(true);
    void api.setOverlayExpanded(true);
  }, []);
  const closePanel = useCallback(() => {
    setPanelOpen(false);
    void api.setOverlayExpanded(false);
  }, []);

  const nudge = useCallback(
    (delta: number) => {
      const next = delta === 0 ? 0 : settings.syncOffsetMs + delta;
      void update({ syncOffsetMs: Math.max(-10_000, Math.min(10_000, next)) });
    },
    [settings.syncOffsetMs, update],
  );

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) {
      if (e.key === 'Escape') closePanel();
      return;
    }
    if (e.key === 'Escape' && panelOpen) closePanel();
    else if (e.key === '[') nudge(-OFFSET_STEP_MS);
    else if (e.key === ']') nudge(OFFSET_STEP_MS);
    else if (e.key === '\\') nudge(0);
  };

  const style = {
    '--panel-alpha': settings.opacity,
    '--font-scale': settings.fontScale,
    '--accent': settings.accentColor,
  } as CSSProperties;

  const reduced = prefersReducedMotion(settings.motion);
  const title = demoActive ? DEMO_TRACK.title : bridge.playback?.title;
  const artist = demoActive ? DEMO_TRACK.artist : bridge.playback?.artist;
  const sourceLabel = demoActive
    ? 'Demo'
    : bridge.playback
      ? SOURCE_LABEL[bridge.playback.source]
      : null;

  return (
    <div
      className={`overlay${reduced ? ' overlay--reduced' : ''}${clickThrough ? ' overlay--click-through' : ''}`}
      style={style}
      onKeyDown={onKeyDown}
    >
      <header className="ov-header" data-tauri-drag-region>
        <span className="ov-header__note" data-tauri-drag-region aria-hidden="true">
          <Icon name="note" size={13} />
        </span>
        <h1
          className="ov-header__track"
          data-tauri-drag-region
          title={title ? `${title}${artist ? ` — ${artist}` : ''}` : undefined}
        >
          {title ? (
            <>
              <span className="ov-header__title" data-tauri-drag-region>
                {title}
              </span>
              {artist && (
                <span className="ov-header__artist" data-tauri-drag-region>
                  {' '}
                  — {artist}
                </span>
              )}
            </>
          ) : (
            <span className="ov-header__title" data-tauri-drag-region>
              LyricsDock
            </span>
          )}
        </h1>
        <div className="ov-controls">
          <button
            type="button"
            className="icon-btn"
            onClick={panelOpen ? closePanel : openPanel}
            aria-label="Find lyrics"
            title="Find lyrics / choose match"
            aria-expanded={panelOpen}
            disabled={demoActive}
          >
            <Icon name="more" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void api.hideOverlay()}
            aria-label="Hide overlay"
            title={`Hide (${settings.toggleShortcut.replace('CommandOrControl', 'Ctrl')})`}
          >
            <Icon name="close" />
          </button>
        </div>
      </header>

      {panelOpen ? (
        <SearchPanel
          key={query ? `${query.title}|${query.artist}` : 'none'}
          initialTitle={query?.title ?? ''}
          initialArtist={query?.artist ?? ''}
          suggestions={
            lyrics.status.phase === 'ambiguous'
              ? lyrics.status.candidates
              : lyrics.status.phase === 'ready'
                ? lyrics.status.alternatives
                : []
          }
          manual={lyrics.manual}
          canSearch={query !== null}
          onSearch={(t, a) => void lyrics.search(t, a)}
          onChoose={(r) => {
            lyrics.choose(r);
            closePanel();
          }}
          onClose={closePanel}
        />
      ) : (
        <main className="ov-body" data-tauri-drag-region aria-label="Lyrics">
          {content ? (
            <LyricsView content={content} index={index} mode={settings.displayMode} />
          ) : (
            <StatusBody
              status={lyrics.status}
              bridgeStatus={bridge.status}
              onRetry={lyrics.retry}
              onSearch={openPanel}
              onDemo={() => setDemo(true)}
            />
          )}
        </main>
      )}

      <footer className="ov-footer">
        <span className="ov-footer__source" data-tauri-drag-region>
          {sourceLabel ?? (bridge.status?.connected ? 'Brave connected' : 'Extension offline')}
          {content?.kind === 'plain' && <span className="badge badge--plain">Not synced</span>}
          {content?.kind === 'synced' &&
            !demoActive &&
            lyrics.status.phase === 'ready' &&
            lyrics.status.manual && <span className="badge">Manual match</span>}
          {clickThrough && <span className="badge badge--warn">Click-through</span>}
          {anchor && !anchor.playing && content?.kind === 'synced' && (
            <span className="badge">Paused</span>
          )}
        </span>
        <div className="ov-controls">
          {content?.kind === 'synced' && !demoActive && (
            <div className="offset" role="group" aria-label="Sync offset">
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                onClick={() => nudge(-OFFSET_STEP_MS)}
                aria-label="Show lyrics later"
                title="Lyrics later ([)"
              >
                <Icon name="minus" size={13} />
              </button>
              <button
                type="button"
                className="offset__value"
                onClick={() => nudge(0)}
                title="Reset offset (\)"
                aria-label={`Offset ${formatOffset(settings.syncOffsetMs)}, reset`}
              >
                {formatOffset(settings.syncOffsetMs)}
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                onClick={() => nudge(OFFSET_STEP_MS)}
                aria-label="Show lyrics earlier"
                title="Lyrics earlier (])"
              >
                <Icon name="plus" size={13} />
              </button>
            </div>
          )}
          {demoActive && (
            <button type="button" className="btn btn--ghost" onClick={() => setDemo(false)}>
              Exit demo
            </button>
          )}
          {content?.kind === 'synced' && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setFrozen((f) => !f)}
              aria-pressed={frozen}
              aria-label={frozen ? 'Resume lyric sync' : 'Pause lyric sync'}
              title={frozen ? 'Resume sync' : 'Pause sync'}
            >
              <Icon name={frozen ? 'play' : 'pause'} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={() => void api.setClickThrough(!clickThrough)}
            aria-pressed={clickThrough}
            aria-label="Click-through mode"
            title={`Click-through (${settings.clickThroughShortcut.replace('CommandOrControl', 'Ctrl')} to exit)`}
          >
            <Icon name={clickThrough ? 'pointerOff' : 'pointer'} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void api.openSettings()}
            aria-label="Settings"
            title="Settings"
          >
            <Icon name="settings" />
          </button>
        </div>
      </footer>
    </div>
  );
}

interface StatusBodyProps {
  status: LyricsStatus;
  bridgeStatus: BridgeStatus | null;
  onRetry: () => void;
  onSearch: () => void;
  onDemo: () => void;
}

export function StatusBody({ status, bridgeStatus, onRetry, onSearch, onDemo }: StatusBodyProps) {
  switch (status.phase) {
    case 'idle':
      return (
        <Message
          title={bridgeStatus?.connected ? 'Waiting for music' : 'Not connected'}
          detail={connectionHint(bridgeStatus)}
          secondary={{ label: 'Try demo', onClick: onDemo }}
        />
      );
    case 'loading':
      return (
        <Message
          title="Finding lyrics…"
          busy
          detail={
            status.query.artist
              ? `${status.query.title} — ${status.query.artist}`
              : status.query.title
          }
        />
      );
    case 'not-found':
      return (
        <Message
          title="No lyrics found"
          detail="LRCLIB has no lyrics for this track, or the title didn't match."
          action={{ label: 'Search', onClick: onSearch, icon: 'search' }}
          secondary={{ label: 'Retry', onClick: onRetry }}
        />
      );
    case 'ambiguous':
      return (
        <Message
          title="Not sure which song this is"
          detail={`${status.candidates.length} possible match${status.candidates.length === 1 ? '' : 'es'}. Pick the right one.`}
          action={{ label: 'Choose match', onClick: onSearch, icon: 'search' }}
        />
      );
    case 'error':
      return (
        <Message
          title={status.error === 'offline' ? 'Offline' : "Couldn't load lyrics"}
          detail={ERROR_MESSAGES[status.error]}
          action={{ label: 'Retry', onClick: onRetry, icon: 'retry' }}
        />
      );
    case 'ready':
      return null;
  }
}
