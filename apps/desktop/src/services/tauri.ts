/**
 * Thin, typed wrapper over Tauri IPC. When the UI runs in a plain browser
 * (vite dev server, component tests) every call degrades to a harmless
 * fallback so the UI can still be developed in demo mode.
 */
import type { PlaybackState } from '@lyricsdock/shared';

export type DisplayMode = 'context' | 'single';
export type MotionPreference = 'system' | 'reduce' | 'full';

export interface Settings {
  opacity: number;
  fontScale: number;
  alwaysOnTop: boolean;
  startHidden: boolean;
  toggleShortcut: string;
  clickThroughShortcut: string;
  displayMode: DisplayMode;
  syncOffsetMs: number;
  accentColor: string;
  motion: MotionPreference;
  bridgeEnabled: boolean;
}

export type SettingsPatch = Partial<Settings>;

export const DEFAULT_SETTINGS: Settings = {
  opacity: 0.88,
  fontScale: 1,
  alwaysOnTop: true,
  startHidden: false,
  toggleShortcut: 'CommandOrControl+Alt+L',
  clickThroughShortcut: 'CommandOrControl+Alt+K',
  displayMode: 'context',
  syncOffsetMs: 0,
  accentColor: '#8fb3ff',
  motion: 'system',
  bridgeEnabled: true,
};

export interface BridgeStatus {
  enabled: boolean;
  port: number;
  connected: boolean;
  paired: boolean;
  clientName: string | null;
  listening: boolean;
  error: string | null;
}

export interface BridgeInfo {
  status: BridgeStatus;
  pairingKey: string;
}

export interface StateEvent {
  state: PlaybackState | null;
  receivedAt: number;
}

export const EVENTS = {
  bridgeState: 'bridge://state',
  bridgeStatus: 'bridge://status',
  settings: 'settings://changed',
  clickThrough: 'overlay://click-through',
} as const;

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

export type Unlisten = () => void;

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
  if (!isTauri()) return () => {};
  const ev = await import('@tauri-apps/api/event');
  return ev.listen<T>(event, (e) => handler(e.payload));
}

export async function currentWindowLabel(): Promise<string> {
  if (!isTauri()) {
    return new URLSearchParams(window.location.search).get('view') === 'settings'
      ? 'settings'
      : 'overlay';
  }
  const w = await import('@tauri-apps/api/window');
  return w.getCurrentWindow().label;
}

let browserSettings: Settings = { ...DEFAULT_SETTINGS };

export const api = {
  getSettings: (): Promise<Settings> =>
    isTauri() ? invoke('get_settings') : Promise.resolve(browserSettings),
  updateSettings: (patch: SettingsPatch): Promise<Settings> => {
    if (isTauri()) return invoke('update_settings', { patch });
    browserSettings = { ...browserSettings, ...patch };
    return Promise.resolve(browserSettings);
  },
  getBridgeInfo: (): Promise<BridgeInfo | null> =>
    isTauri() ? invoke('get_bridge_info') : Promise.resolve(null),
  resetPairing: (): Promise<BridgeInfo | null> =>
    isTauri() ? invoke('reset_pairing') : Promise.resolve(null),
  disconnectBridge: (): Promise<BridgeInfo | null> =>
    isTauri() ? invoke('disconnect_bridge') : Promise.resolve(null),
  setClickThrough: (enabled: boolean): Promise<void> =>
    isTauri() ? invoke('set_click_through', { enabled }) : Promise.resolve(),
  getClickThrough: (): Promise<boolean> =>
    isTauri() ? invoke('get_click_through') : Promise.resolve(false),
  hideOverlay: (): Promise<void> => (isTauri() ? invoke('hide_overlay') : Promise.resolve()),
  resetOverlayPosition: (): Promise<void> =>
    isTauri() ? invoke('reset_overlay_position') : Promise.resolve(),
  setOverlayExpanded: (expanded: boolean): Promise<void> =>
    isTauri() ? invoke('set_overlay_expanded', { expanded }) : Promise.resolve(),
  openSettings: (): Promise<void> => {
    if (isTauri()) return invoke('open_settings');
    window.open('?view=settings', '_blank', 'noopener');
    return Promise.resolve();
  },
  quitApp: (): Promise<void> => (isTauri() ? invoke('quit_app') : Promise.resolve()),
  appVersion: async (): Promise<string> => {
    if (!isTauri()) return '0.1.0-dev';
    const app = await import('@tauri-apps/api/app');
    return app.getVersion();
  },
};
