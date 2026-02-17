/**
 * Split a long document into individual posts when it appears to be a collection
 * (e.g. newsletter with date headers like "February 8, 2026").
 *
 * Used by voice-samples upload to treat multi-post docs as separate samples.
 */

const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December';
const DATE_RE = new RegExp(`(${MONTHS}\\s+\\d{1,2},\\s*\\d{4})`, 'gi');
const MIN_WORDS_PER_POST = 150;

/**
 * Split text into posts by date headers (e.g. "February 8, 2026").
 * @param {string} text - Raw document text
 * @param {number} minWords - Minimum words per chunk to count as a post (default 150)
 * @returns {{ date: string, body: string, wordCount: number }[]}
 */
export function splitDocumentIntoPosts(text, minWords = MIN_WORDS_PER_POST) {
  if (!text || typeof text !== 'string') return [];
  const trimmed = text.trim();
  if (!trimmed) return [];

  const parts = trimmed.split(DATE_RE);
  const posts = [];
  for (let i = 1; i < parts.length; i += 2) {
    const date = parts[i] || '';
    const body = (parts[i + 1] || '').trim();
    const wordCount = body.split(/\s+/).filter(Boolean).length;
    if (wordCount >= minWords) posts.push({ date, body, wordCount });
  }

  if (posts.length === 0) {
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    if (wordCount >= minWords) posts.push({ date: '', body: trimmed, wordCount });
  }
  return posts;
}

/**
 * Returns true if the document looks like multiple posts (split yields > 1).
 */
export function isLikelyMultiPostDocument(text) {
  const posts = splitDocumentIntoPosts(text);
  return posts.length > 1;
}
