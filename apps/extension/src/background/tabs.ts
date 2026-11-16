import type { PlaybackState } from '@lyricsdock/shared';

export interface TabEntry {
  tabId: number;
  state: PlaybackState;
  /** Epoch ms of the last update from this tab. */
  updatedAt: number;
  /** Epoch ms when this tab last went from paused to playing. */
  playStartedAt: number;
}

/** Tabs that stop reporting for this long are considered gone. */
export const TAB_EXPIRY_MS = 12_000;

/**
 * Tracks media state per tab and picks which one the overlay follows.
 *
 * Rule (deterministic):
 * 1. A tab that is playing beats any paused tab.
 * 2. Among playing tabs, the one that most recently *started* playing wins
 *    (pressing play in another tab switches the overlay to it).
 * 3. Among paused tabs, the most recently updated wins.
 * 4. Remaining ties go to the lower tab id.
 */
export class TabRegistry {
  private tabs = new Map<number, TabEntry>();

  update(tabId: number, state: PlaybackState | null, now: number): void {
    if (!state) {
      this.tabs.delete(tabId);
      return;
    }
    const prev = this.tabs.get(tabId);
    const startedPlaying = state.playing && (!prev || !prev.state.playing);
    this.tabs.set(tabId, {
      tabId,
      state,
      updatedAt: now,
      playStartedAt: startedPlaying ? now : (prev?.playStartedAt ?? 0),
    });
  }

  remove(tabId: number): void {
    this.tabs.delete(tabId);
  }

  prune(now: number): void {
    for (const [id, t] of this.tabs) if (now - t.updatedAt > TAB_EXPIRY_MS) this.tabs.delete(id);
  }

  active(now: number): TabEntry | null {
    this.prune(now);
    let best: TabEntry | null = null;
    for (const t of this.tabs.values()) {
      if (!best || compare(t, best) < 0) best = t;
    }
    return best;
  }

  get size(): number {
    return this.tabs.size;
  }
}

function compare(a: TabEntry, b: TabEntry): number {
  if (a.state.playing !== b.state.playing) return a.state.playing ? -1 : 1;
  if (a.state.playing) {
    if (a.playStartedAt !== b.playStartedAt) return b.playStartedAt - a.playStartedAt;
  } else if (a.updatedAt !== b.updatedAt) {
    return b.updatedAt - a.updatedAt;
  }
  return a.tabId - b.tabId;
}
