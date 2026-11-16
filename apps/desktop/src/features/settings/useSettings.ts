import { useCallback, useEffect, useState } from 'react';
import {
  api,
  DEFAULT_SETTINGS,
  EVENTS,
  listen,
  type Settings,
  type SettingsPatch,
} from '../../services/tauri';

/** Settings shared by all windows; Rust owns persistence and broadcasts changes. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    void api.getSettings().then((s) => {
      if (!alive) return;
      setSettings(s);
      setLoaded(true);
    });
    void listen<Settings>(EVENTS.settings, (s) => setSettings(s)).then((u) => {
      if (alive) unlisten = u;
      else u();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const update = useCallback(async (patch: SettingsPatch) => {
    try {
      const next = await api.updateSettings(patch);
      setSettings(next);
      setError(null);
      return true;
    } catch (e) {
      setError(
        typeof e === 'string' ? e : e instanceof Error ? e.message : 'Could not save setting',
      );
      return false;
    }
  }, []);

  return { settings, loaded, update, error };
}

export function prefersReducedMotion(pref: Settings['motion']): boolean {
  if (pref === 'reduce') return true;
  if (pref === 'full') return false;
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}
