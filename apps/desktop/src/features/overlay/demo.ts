import { useEffect, useState } from 'react';
import { parseLrc } from '../lyrics/lrc';
import type { LyricsContent } from '../lyrics/content';
import type { PlaybackAnchor } from '../lyrics/sync';

/**
 * Demo mode for UI development and first-run discovery. The text below is
 * original placeholder copy describing the app; it is not a song and is never
 * mixed with provider lyrics.
 */
export const DEMO_DURATION = 42;

const DEMO_LRC = `[00:00.00]
[00:01.50]Welcome to LyricsDock demo mode
[00:05.00]Each line follows a playback clock
[00:08.50]The current line stays bright and large
[00:12.00]The next one waits a little dimmer
[00:15.50]Drag this window by its top edge
[00:19.00]Hide it any time with Ctrl + Alt + L
[00:22.50]Open settings to change size and opacity
[00:26.00]Install the Brave extension to follow real music
[00:29.50]Lyrics come from LRCLIB when they exist
[00:33.00]Nothing here is recorded or uploaded
[00:36.50]That's the whole tour, it starts again now
[00:40.50]`;

export const DEMO_CONTENT: LyricsContent = {
  kind: 'synced',
  lines: parseLrc(DEMO_LRC).lines,
  record: null,
};

export const DEMO_TRACK = { title: 'Demo', artist: 'LyricsDock' };

export function useDemoAnchor(active: boolean): PlaybackAnchor | null {
  const [anchor, setAnchor] = useState<PlaybackAnchor | null>(null);
  useEffect(() => {
    if (!active) {
      setAnchor(null);
      return;
    }
    const restart = () =>
      setAnchor({
        position: 0,
        playing: true,
        playbackRate: 1,
        sampledAt: Date.now(),
        duration: DEMO_DURATION,
      });
    restart();
    const id = setInterval(restart, DEMO_DURATION * 1000);
    return () => clearInterval(id);
  }, [active]);
  return anchor;
}
