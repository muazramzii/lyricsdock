import { tidy } from './normalize';

/**
 * Turn a YouTube video title + channel into a best-guess (title, artist) pair.
 *
 * Only well-known promotional suffixes are removed. Version information such as
 * "(Live)", "(Acoustic)", "(Remix)" or "(Taylor's Version)" is kept because it
 * changes which lyrics/timing are correct.
 */

const NOISE_WORDS = [
  'official music video',
  'official video',
  'official audio',
  'official lyric video',
  'official lyrics video',
  'official visualizer',
  'official visualiser',
  'official mv',
  'music video',
  'lyric video',
  'lyrics video',
  'lyrics',
  'lyric',
  'audio',
  'video',
  'visualizer',
  'visualiser',
  'mv',
  'm/v',
  'hd',
  'hq',
  '4k',
  '1080p',
  '720p',
  'color coded lyrics',
  'with lyrics',
  // Remasters keep the same words and (almost always) the same timing.
  'remaster',
  'remastered',
  '4k remaster',
  'hd remaster',
];

const BRACKETS_RE = /\s*[([【「『]([^)\]】」』]*)[)\]】」』]\s*/g;

function isNoise(inner: string): boolean {
  const s = inner
    .toLowerCase()
    .replace(/[|/·•]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length === 0) return true;
  if (NOISE_WORDS.includes(s)) return true;
  // e.g. "Official Video 4K" or "HD Audio": every word is a noise word.
  const words = s.split(' ');
  const single = new Set(NOISE_WORDS.flatMap((w) => w.split(' ')));
  const isYear = (w: string) => /^(19|20)\d{2}$/.test(w);
  // e.g. "Remastered 2011": noise words plus an optional year.
  return words.some((w) => !isYear(w)) && words.every((w) => single.has(w) || isYear(w));
}

export function stripTitleNoise(title: string): string {
  let out = title.replace(BRACKETS_RE, (match, inner: string) => (isNoise(inner) ? ' ' : match));
  // Trailing "| Official Video" or "- Lyrics" without brackets.
  out = out.replace(/\s*[|]\s*[^|]*$/, (m) => (isNoise(m.replace(/^\s*\|\s*/, '')) ? '' : m));
  out = out.replace(/\s+-\s+(official\s+)?(music\s+)?(video|audio|lyrics?)\s*$/i, '');
  out = out.replace(
    /(?:\s+|(?<=[」』"”)\]]))(official\s+(music\s+|lyrics?\s+)?(video|audio|mv|visuali[sz]er)|m\/?v)\s*$/i,
    '',
  );
  return tidy(out);
}

const TOPIC_SUFFIX_RE = /\s+-\s+Topic$/i;
const VEVO_RE = /VEVO$/;

export function cleanChannelName(channel: string): string {
  return tidy(channel.replace(TOPIC_SUFFIX_RE, '').replace(VEVO_RE, ''));
}

export interface TitleGuess {
  title: string;
  artist: string;
}

const SEPARATORS = [' - ', ' – ', ' — ', ' ~ '];

export function parseYouTubeTitle(rawTitle: string, channel: string): TitleGuess {
  const cleanedChannel = cleanChannelName(channel);
  const isTopic = TOPIC_SUFFIX_RE.test(channel.trim());
  const title = stripTitleNoise(rawTitle.replace(/\s+-\s+YouTube(\s+Music)?$/i, ''));

  // "Artist - Topic" channels upload the bare track name as the title.
  if (isTopic) return { title, artist: cleanedChannel };

  for (const sep of SEPARATORS) {
    const idx = title.indexOf(sep);
    if (idx > 0) {
      const left = tidy(title.slice(0, idx));
      const right = tidy(title.slice(idx + sep.length));
      if (left && right) {
        return { title: stripTitleNoise(right), artist: left };
      }
    }
  }

  // Quoted song name, e.g. `Artist "Song" MV` or `Artist「Song」` (common for K-pop/J-pop).
  const quoted = title.match(/^(.+?)\s*["“「『](.+?)["”」』]/);
  if (quoted?.[1] && quoted[2]) return { title: tidy(quoted[2]), artist: tidy(quoted[1]) };

  return { title, artist: cleanedChannel };
}
