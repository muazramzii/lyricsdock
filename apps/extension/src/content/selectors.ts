/**
 * Every YouTube DOM selector lives here. YouTube changes its markup often;
 * each value is an ordered list of fallbacks, and the media element plus the
 * Media Session API are preferred over DOM text wherever possible.
 */
export const SELECTORS = {
  youtube: {
    video: ['#movie_player video.html5-main-video', '#movie_player video', 'ytd-player video'],
    player: ['#movie_player', '.html5-video-player'],
    title: [
      'ytd-watch-metadata h1 yt-formatted-string',
      'ytd-watch-metadata h1',
      '#title h1 yt-formatted-string',
      'h1.title yt-formatted-string',
    ],
    channel: [
      'ytd-watch-metadata ytd-channel-name a',
      'ytd-watch-metadata #owner #channel-name a',
      '#owner ytd-channel-name a',
      'ytd-video-owner-renderer ytd-channel-name a',
    ],
  },
  youtubeMusic: {
    video: ['ytmusic-player video', '#movie_player video', 'video'],
    player: ['#movie_player', 'ytmusic-player'],
    title: ['ytmusic-player-bar .title', 'ytmusic-player-bar yt-formatted-string.title'],
    artist: [
      'ytmusic-player-bar .byline a',
      'ytmusic-player-bar .subtitle .byline a',
      'ytmusic-player-bar .byline',
    ],
  },
  /** Class on the player while an ad is playing. */
  adShowingClass: 'ad-showing',
} as const;

export function queryFirst<T extends Element = Element>(
  root: ParentNode,
  selectors: readonly string[],
): T | null {
  for (const s of selectors) {
    const el = root.querySelector<T>(s);
    if (el) return el;
  }
  return null;
}

export function textOf(root: ParentNode, selectors: readonly string[]): string {
  return queryFirst(root, selectors)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}
