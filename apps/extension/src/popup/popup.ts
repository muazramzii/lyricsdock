import { isPlausiblePairingKey } from '@lyricsdock/shared';
import type { ConnectionState, PopupStatus } from '../shared/messages';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const CONNECTION_COPY: Record<
  ConnectionState,
  { text: string; hint: string; tone: 'ok' | 'warn' | 'off' }
> = {
  'no-key': {
    text: 'Not paired',
    hint: 'Paste the pairing key from the desktop app below.',
    tone: 'warn',
  },
  connecting: { text: 'Connecting…', hint: 'Play something on YouTube to connect.', tone: 'off' },
  connected: { text: 'Connected', hint: 'Lyrics follow the tab that is playing.', tone: 'ok' },
  'app-offline': {
    text: 'Desktop app not connected',
    hint: 'Start LyricsDock on Windows, then play or pause a video.',
    tone: 'warn',
  },
  'bad-key': {
    text: 'Wrong pairing key',
    hint: 'Copy the key again from LyricsDock → Settings → Browser.',
    tone: 'warn',
  },
  'origin-mismatch': {
    text: 'Paired with a different extension',
    hint: 'In LyricsDock Settings, click “New pairing key”, then pair again.',
    tone: 'warn',
  },
  locked: {
    text: 'Too many attempts',
    hint: 'Wait a minute, then try the key again.',
    tone: 'warn',
  },
  disabled: {
    text: 'Connections turned off',
    hint: 'Enable “Accept connections” in LyricsDock Settings.',
    tone: 'off',
  },
  error: {
    text: 'Connection problem',
    hint: 'Restart LyricsDock. If it persists, see the troubleshooting guide.',
    tone: 'warn',
  },
};

function render(s: PopupStatus) {
  const copy = CONNECTION_COPY[s.connection];
  const status = $('status');
  status.textContent = copy.text;
  status.dataset.tone = copy.tone;
  $('hint').textContent = copy.hint;
  const track = $('track');
  if (s.track) {
    track.textContent = `${s.track.title}${s.track.artist ? ` — ${s.track.artist}` : ''}${s.track.playing ? '' : ' (paused)'}`;
    track.classList.remove('muted');
  } else {
    track.textContent = 'Nothing playing on YouTube';
    track.classList.add('muted');
  }
  $('forget').hidden = !s.hasKey;
  $<HTMLInputElement>('key').placeholder = s.hasKey
    ? 'Paired · paste a new key to change'
    : 'XXXX-XXXX-XXXX-XXXX';
}

async function request(msg: object): Promise<PopupStatus | null> {
  try {
    return (await chrome.runtime.sendMessage(msg)) as PopupStatus;
  } catch {
    return null;
  }
}

async function refresh() {
  const s = await request({ type: 'popup-get-status' });
  if (s) render(s);
}

function init() {
  const form = $<HTMLFormElement>('pair-form');
  const input = $<HTMLInputElement>('key');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = input.value.trim();
    if (!isPlausiblePairingKey(key)) {
      input.setCustomValidity('That does not look like a LyricsDock pairing key.');
      input.reportValidity();
      return;
    }
    input.setCustomValidity('');
    const s = await request({ type: 'popup-set-key', key });
    if (s) {
      render(s);
      if (s.connection !== 'bad-key') input.value = '';
    }
  });
  input.addEventListener('input', () => input.setCustomValidity(''));
  $('forget').addEventListener('click', async () => {
    const s = await request({ type: 'popup-forget' });
    if (s) render(s);
  });
  void refresh();
  setInterval(() => void refresh(), 1000);
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id) init();
