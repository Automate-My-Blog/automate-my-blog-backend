/**
 * Convert markdown to HTML for publishing (e.g. WordPress, email).
 * Uses marked with GFM so output matches common in-browser renderers (headings, lists, links, code, tables).
 */

import { marked } from 'marked';

// GitHub Flavored Markdown: tables, strikethrough, autolinks; same as typical preview UIs
marked.setOptions({
  gfm: true,
  breaks: true
});

/**
 * Detect if content is likely already HTML (so we don't double-convert).
 * @param {string} content
 * @returns {boolean}
 */
function looksLikeHtml(content) {
  if (!content || typeof content !== 'string') return false;
  const trimmed = content.trim();
  return /^\s*<[a-z][\s\S]*>/i.test(trimmed) || trimmed.startsWith('<!--');
}

/**
 * Convert markdown to HTML. If input looks like HTML, returns as-is (no double conversion).
 * @param {string} markdown - Post body (markdown or already HTML)
 * @returns {string} HTML safe for use in WordPress post content, emails, etc.
 */
export function markdownToHtml(markdown) {
  if (markdown == null) return '';
  const str = String(markdown);
  if (!str.trim()) return '';
  if (looksLikeHtml(str)) return str;
  return marked.parse(str, { async: false });
}
