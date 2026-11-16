/**
 * Text normalization for comparing track titles and artist names.
 *
 * Goals: tolerate case, accents-as-composed-vs-decomposed, curly quotes, and
 * punctuation noise, while keeping every letter and digit (including non-Latin
 * scripts) so that "Sakura" and "桜" never collapse into the same key.
 */

const QUOTES_RE = /[‘’‚‛′`´]/g;
const DQUOTES_RE = /[“”„‟″]/g;
const DASHES_RE = /[‐-―−]/g;

export function normalizeText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(QUOTES_RE, "'")
    .replace(DQUOTES_RE, '"')
    .replace(DASHES_RE, '-')
    .toLocaleLowerCase('en-US')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/'/g, '')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Collapse whitespace and trim, without changing case or punctuation. */
export function tidy(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

const FEAT_RE = /\s*[([]?\s*\b(?:feat\.?|ft\.?|featuring|with)\s+[^)\]]*[)\]]?\s*$/i;

/**
 * Remove a trailing "feat. X" clause. Only used as a secondary comparison key;
 * the original string is always tried first.
 */
export function stripFeaturing(input: string): string {
  return tidy(input.replace(FEAT_RE, ''));
}

/** Split an artist credit such as "A, B & C feat. D" into individual names. */
export function splitArtists(input: string): string[] {
  return input
    .split(/\s*(?:,|&|\bx\b|\band\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\/|;)\s*/i)
    .map((s) => normalizeText(s))
    .filter((s) => s.length > 0);
}

export function tokens(input: string): string[] {
  const n = normalizeText(input);
  return n.length === 0 ? [] : n.split(' ');
}

/** Jaccard similarity of normalized word sets, in [0, 1]. */
export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}
