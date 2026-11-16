/**
 * Background service worker: collects media state from YouTube tabs, picks
 * the active one, and forwards it to the desktop app.
 */
import { validatePlaybackState, type PlaybackState } from '@lyricsdock/shared';
import { isIncomingMessage, type PopupStatus } from '../shared/messages';
import { BridgeClient } from './bridgeClient';
import { TabRegistry } from './tabs';

const KEY_STORAGE = 'pairingKey';
const ALLOWED_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
]);

const registry = new TabRegistry();
const client = new BridgeClient({
  fetch: (url, init) => fetch(url, init),
  clientVersion: chrome.runtime.getManifest().version,
});
let lastSent: PlaybackState | null = null;

const ready = chrome.storage.local.get(KEY_STORAGE).then((v) => {
  const key = v[KEY_STORAGE];
  client.setKey(typeof key === 'string' ? key : null);
});

async function push(): Promise<void> {
  await ready;
  const active = registry.active(Date.now());
  lastSent = active?.state ?? null;
  await client.send(lastSent);
}

function popupStatus(): PopupStatus {
  return {
    connection: client.connection,
    detail: client.detail,
    port: client.currentPort,
    hasKey: client.hasKey,
    track: lastSent
      ? {
          title: lastSent.title,
          artist: lastSent.artist,
          source: lastSent.source,
          playing: lastSent.playing,
        }
      : null,
  };
}

function fromYouTubeTab(sender: chrome.runtime.MessageSender): number | null {
  if (sender.id !== chrome.runtime.id || !sender.tab?.id || sender.frameId !== 0 || !sender.url)
    return null;
  try {
    const u = new URL(sender.url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname) ? sender.tab.id : null;
  } catch {
    return null;
  }
}

/**
 * Our own pages (popup, or the popup opened in a tab). Content scripts report
 * the web page's URL as `sender.url`, so they can never pass this check.
 */
function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  const own = `chrome-extension://${chrome.runtime.id}`;
  return (
    sender.id === chrome.runtime.id &&
    (sender.origin ?? own) === own &&
    !!sender.url?.startsWith(`${own}/`)
  );
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (!isIncomingMessage(raw)) return false;

  if (raw.type === 'media-state') {
    const tabId = fromYouTubeTab(sender);
    if (tabId === null) return false;
    let state: PlaybackState | null = null;
    if (raw.state !== null) {
      const r = validatePlaybackState(raw.state);
      if (!r.ok) return false;
      state = r.value;
    }
    registry.update(tabId, state, Date.now());
    void push();
    return false;
  }

  if (!fromExtensionPage(sender)) return false;

  if (raw.type === 'popup-get-status') {
    void ready.then(() => sendResponse(popupStatus()));
    return true;
  }
  if (raw.type === 'popup-set-key') {
    void (async () => {
      await client.bye();
      client.setKey(raw.key);
      if (client.hasKey) await chrome.storage.local.set({ [KEY_STORAGE]: raw.key.trim() });
      await push();
      sendResponse(popupStatus());
    })();
    return true;
  }
  if (raw.type === 'popup-forget') {
    void (async () => {
      await client.bye();
      client.setKey(null);
      await chrome.storage.local.remove(KEY_STORAGE);
      sendResponse(popupStatus());
    })();
    return true;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  registry.remove(tabId);
  void push();
});
