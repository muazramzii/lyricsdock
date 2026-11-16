import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  api,
  EVENTS,
  listen,
  type BridgeInfo,
  type BridgeStatus,
  type Settings,
} from '../../services/tauri';
import { LyricsCache, browserStore } from '../lyrics/cache';
import { createLrclibClient, LrclibError } from '../lyrics/lrclib';
import { useSettings } from './useSettings';

function Section({
  title,
  children,
  description,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="s-section">
      <h2>{title}</h2>
      {description && <p className="s-desc">{description}</p>}
      <div className="s-rows">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="s-row">
      <div className="s-row__label">
        <label htmlFor={htmlFor}>{label}</label>
        {hint && <span className="s-hint">{hint}</span>}
      </div>
      <div className="s-row__control">{children}</div>
    </div>
  );
}

function Toggle({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <input
      id={id}
      type="checkbox"
      role="switch"
      className="switch"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

function ShortcutInput({
  id,
  value,
  onCommit,
}: {
  id: string;
  value: string;
  onCommit: (v: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      id={id}
      className="text-input"
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={async () => {
        if (draft.trim() !== value && !(await onCommit(draft.trim()))) setDraft(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function statusText(s: BridgeStatus | undefined): { text: string; tone: 'ok' | 'warn' | 'off' } {
  if (!s) return { text: 'Unavailable outside the desktop app', tone: 'off' };
  if (s.error) return { text: s.error, tone: 'warn' };
  if (!s.enabled) return { text: 'Turned off', tone: 'off' };
  if (s.connected)
    return { text: `Connected${s.clientName ? ` · ${s.clientName}` : ''}`, tone: 'ok' };
  if (!s.paired) return { text: `Waiting for pairing · 127.0.0.1:${s.port}`, tone: 'warn' };
  return { text: `Paired, not connected · 127.0.0.1:${s.port}`, tone: 'warn' };
}

type ProviderCheck = { state: 'idle' | 'checking' | 'ok' | 'error'; message?: string };

export function SettingsApp() {
  const { settings, update, error } = useSettings();
  const [bridge, setBridge] = useState<BridgeInfo | null>(null);
  const [version, setVersion] = useState('');
  const [copied, setCopied] = useState(false);
  const [provider, setProvider] = useState<ProviderCheck>({ state: 'idle' });
  const [cacheCleared, setCacheCleared] = useState(false);
  const id = useId();

  useEffect(() => {
    document.title = 'LyricsDock Settings';
    void api.getBridgeInfo().then(setBridge);
    void api.appVersion().then(setVersion);
    let un: (() => void) | undefined;
    void listen<BridgeStatus>(EVENTS.bridgeStatus, (status) =>
      setBridge((b) => (b ? { ...b, status } : b)),
    ).then((u) => (un = u));
    return () => un?.();
  }, []);

  const set =
    <K extends keyof Settings>(k: K) =>
    (v: Settings[K]) =>
      update({ [k]: v } as Partial<Settings>);
  const status = statusText(bridge?.status);

  const copyKey = async () => {
    if (!bridge) return;
    try {
      await navigator.clipboard.writeText(bridge.pairingKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const checkProvider = async () => {
    setProvider({ state: 'checking' });
    try {
      await createLrclibClient().search({ trackName: 'test' });
      setProvider({ state: 'ok', message: 'LRCLIB is reachable' });
    } catch (e) {
      setProvider({
        state: 'error',
        message: e instanceof LrclibError ? e.message : 'LRCLIB is unreachable',
      });
    }
  };

  return (
    <div className="settings">
      <header className="s-header">
        <h1>Settings</h1>
        {error && (
          <p className="s-error" role="alert">
            {error}
          </p>
        )}
      </header>

      <Section title="Appearance">
        <Row
          label="Background opacity"
          htmlFor={`${id}-op`}
          hint={`${Math.round(settings.opacity * 100)}%`}
        >
          <input
            id={`${id}-op`}
            type="range"
            min={0.35}
            max={1}
            step={0.01}
            value={settings.opacity}
            onChange={(e) => void set('opacity')(Number(e.target.value))}
          />
        </Row>
        <Row
          label="Text size"
          htmlFor={`${id}-fs`}
          hint={`${Math.round(settings.fontScale * 100)}%`}
        >
          <input
            id={`${id}-fs`}
            type="range"
            min={0.8}
            max={1.6}
            step={0.05}
            value={settings.fontScale}
            onChange={(e) => void set('fontScale')(Number(e.target.value))}
          />
        </Row>
        <Row label="Lines shown" htmlFor={`${id}-dm`}>
          <select
            id={`${id}-dm`}
            className="select"
            value={settings.displayMode}
            onChange={(e) => void set('displayMode')(e.target.value as Settings['displayMode'])}
          >
            <option value="context">Previous, current, next</option>
            <option value="single">Current line only</option>
          </select>
        </Row>
        <Row label="Accent colour" htmlFor={`${id}-ac`}>
          <input
            id={`${id}-ac`}
            type="color"
            value={settings.accentColor}
            onChange={(e) => void set('accentColor')(e.target.value)}
          />
        </Row>
        <Row label="Motion" htmlFor={`${id}-mo`}>
          <select
            id={`${id}-mo`}
            className="select"
            value={settings.motion}
            onChange={(e) => void set('motion')(e.target.value as Settings['motion'])}
          >
            <option value="system">Follow Windows setting</option>
            <option value="reduce">Reduce motion</option>
            <option value="full">Allow transitions</option>
          </select>
        </Row>
      </Section>

      <Section title="Behaviour">
        <Row label="Always on top" htmlFor={`${id}-top`}>
          <Toggle
            id={`${id}-top`}
            checked={settings.alwaysOnTop}
            onChange={(v) => void set('alwaysOnTop')(v)}
          />
        </Row>
        <Row label="Start hidden" hint="Only the tray icon appears at launch" htmlFor={`${id}-sh`}>
          <Toggle
            id={`${id}-sh`}
            checked={settings.startHidden}
            onChange={(v) => void set('startHidden')(v)}
          />
        </Row>
        <Row label="Show / hide shortcut" hint="e.g. CommandOrControl+Alt+L" htmlFor={`${id}-ks`}>
          <ShortcutInput
            id={`${id}-ks`}
            value={settings.toggleShortcut}
            onCommit={(v) => update({ toggleShortcut: v })}
          />
        </Row>
        <Row
          label="Click-through shortcut"
          hint="Also exits click-through mode"
          htmlFor={`${id}-kc`}
        >
          <ShortcutInput
            id={`${id}-kc`}
            value={settings.clickThroughShortcut}
            onCommit={(v) => update({ clickThroughShortcut: v })}
          />
        </Row>
        <Row label="Overlay position">
          <button type="button" className="btn" onClick={() => void api.resetOverlayPosition()}>
            Reset to bottom-right
          </button>
        </Row>
      </Section>

      <Section title="Sync">
        <Row label="Lyrics offset" htmlFor={`${id}-off`} hint="Positive shows lines earlier">
          <div className="inline">
            <input
              id={`${id}-off`}
              type="range"
              min={-5000}
              max={5000}
              step={50}
              value={settings.syncOffsetMs}
              onChange={(e) => void set('syncOffsetMs')(Number(e.target.value))}
            />
            <output className="mono">{(settings.syncOffsetMs / 1000).toFixed(2)}s</output>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void set('syncOffsetMs')(0)}
              disabled={settings.syncOffsetMs === 0}
            >
              Reset
            </button>
          </div>
        </Row>
      </Section>

      <Section
        title="Browser"
        description="The Brave extension sends the current track title, artist and playback position to this app over a private connection on your computer (127.0.0.1). Paste the pairing key into the extension popup once."
      >
        <Row label="Status">
          <span className={`status status--${status.tone}`}>{status.text}</span>
        </Row>
        <Row label="Pairing key" hint="Keep it private">
          <div className="inline">
            <code className="key">{bridge?.pairingKey ?? '—'}</code>
            <button type="button" className="btn" onClick={() => void copyKey()} disabled={!bridge}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </Row>
        <Row label="Accept connections" htmlFor={`${id}-be`}>
          <Toggle
            id={`${id}-be`}
            checked={settings.bridgeEnabled}
            onChange={(v) => void set('bridgeEnabled')(v)}
          />
        </Row>
        <Row label="Connection">
          <div className="inline">
            <button
              type="button"
              className="btn"
              onClick={() => void api.disconnectBridge().then(setBridge)}
              disabled={!bridge?.status.connected}
            >
              Disconnect
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                if (
                  window.confirm(
                    'Create a new pairing key? The extension will need the new key before it can connect again.',
                  )
                ) {
                  void api.resetPairing().then(setBridge);
                }
              }}
              disabled={!bridge}
            >
              New pairing key
            </button>
          </div>
        </Row>
      </Section>

      <Section
        title="Lyrics provider"
        description="Lyrics come from LRCLIB (lrclib.net), a free public lyrics database. To find lyrics, the track title, artist and length are sent to LRCLIB. Nothing else leaves your computer."
      >
        <Row label="LRCLIB">
          <div className="inline">
            <button
              type="button"
              className="btn"
              onClick={() => void checkProvider()}
              disabled={provider.state === 'checking'}
            >
              {provider.state === 'checking' ? 'Checking…' : 'Test connection'}
            </button>
            {provider.message && (
              <span className={`status status--${provider.state === 'ok' ? 'ok' : 'warn'}`}>
                {provider.message}
              </span>
            )}
          </div>
        </Row>
        <Row label="Lyrics cache" hint="Recent lookups stored on this PC">
          <button
            type="button"
            className="btn"
            onClick={() => {
              new LyricsCache(browserStore()).clear();
              setCacheCleared(true);
            }}
          >
            {cacheCleared ? 'Cleared' : 'Clear cache'}
          </button>
        </Row>
      </Section>

      <Section title="About">
        <p className="s-about">
          LyricsDock {version} · Free and open source. No account, no tracking, no audio capture.
          LyricsDock only shows lyrics for music you are already playing.
        </p>
        <div className="inline">
          <button type="button" className="btn btn--danger" onClick={() => void api.quitApp()}>
            Quit LyricsDock
          </button>
        </div>
      </Section>
    </div>
  );
}
