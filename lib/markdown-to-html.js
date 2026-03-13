/**
 * Convert markdown to HTML for publishing (e.g. WordPress, email).
 * Uses marked with GFM so output matches common in-browser renderers (headings, lists, links, code, tables).
 *
 * Replaces app-specific placeholders so they render on WordPress:
 * - ![IMAGE:type:description] / ![CHART:...] → placeholder paragraph (images not yet generated)
 * - ![TWEET:url] / ![TWEET:url::DATA::base64] → blockquote + link (WordPress-friendly tweet embed)
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

function escapeHtml(text) {
  if (text == null) return '';
  const s = String(text);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Replace ![TWEET:url] or ![TWEET:url::DATA::base64] with WordPress-friendly blockquote + link. */
function replaceTweetPlaceholders(str) {
  const tweetRegex = /!\[TWEET:(https?:\/\/[^\]]+?)(?:::DATA::([^\]]+))?\]/g;
  return str.replace(tweetRegex, (_, tweetUrl, base64Data) => {
    let author = '';
    let text = '';
    if (base64Data) {
      try {
        const data = JSON.parse(Buffer.from(base64Data, 'base64').toString());
        author = data.author_name || data.author || '';
        text = (data.text || '').trim();
      } catch {
        /* ignore decode errors */
      }
    }
    const safeUrl = escapeHtml(tweetUrl);
    const safeAuthor = escapeHtml(author);
    const safeText = escapeHtml(text);
    if (safeText) {
      return `<blockquote class="twitter-tweet-embed" style="border-left: 4px solid #1da1f2; padding: 12px 16px; margin: 16px 0; background: #f8f9fa; border-radius: 8px;"><p style="margin: 0 0 8px 0;">${safeText}</p>${safeAuthor ? `<cite style="display: block; margin-bottom: 8px; font-size: 0.9em;">— ${safeAuthor}</cite>` : ''}<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color: #1da1f2;">View on X</a></blockquote>`;
    }
    return `<blockquote class="twitter-tweet-embed" style="border-left: 4px solid #1da1f2; padding: 12px 16px; margin: 16px 0; background: #f8f9fa; border-radius: 8px;"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color: #1da1f2;">View tweet on X</a></blockquote>`;
  });
}

/** Replace ![IMAGE:...] and ![CHART:...] with a short placeholder so they don't appear as raw syntax. */
function replaceImagePlaceholders(str) {
  let out = str;
  // ![IMAGE:type:description]
  out = out.replace(/!\[IMAGE:(\w+):([^\]]*)\]/g, (_, type, desc) => {
    const label = (desc && desc.trim()) ? escapeHtml(desc.trim().slice(0, 120)) : escapeHtml(type);
    return `<p class="amb-image-placeholder" style="padding: 12px; background: #f0f0f0; border-radius: 6px; color: #666; font-size: 0.9em;">[Image: ${label}]</p>`;
  });
  // ![CHART:type|title|labels|values]
  out = out.replace(/!\[CHART:([^\]|]+)\|([^\]|]*)\|([^\]|]*)\|([^\]]*)\]/g, (_, chartType, title) => {
    const label = (title && title.trim()) ? escapeHtml(title.trim().slice(0, 80)) : escapeHtml(chartType) + ' chart';
    return `<p class="amb-chart-placeholder" style="padding: 12px; background: #f0f0f0; border-radius: 6px; color: #666; font-size: 0.9em;">[Chart: ${label}]</p>`;
  });
  return out;
}

/**
 * Preprocess content: replace app placeholders with HTML so they render on WordPress.
 * Runs before markdown parse so normal markdown (including ![alt](url) for real images) is still converted by marked.
 */
function preprocessPlaceholders(str) {
  return replaceImagePlaceholders(replaceTweetPlaceholders(str));
}

/**
 * Convert markdown to HTML. If input looks like HTML, returns as-is (no double conversion).
 * Replaces image/chart placeholders with placeholder HTML and tweet placeholders with blockquote+link HTML.
 * @param {string} markdown - Post body (markdown or already HTML)
 * @returns {string} HTML safe for use in WordPress post content, emails, etc.
 */
export function markdownToHtml(markdown) {
  if (markdown == null) return '';
  const str = String(markdown);
  if (!str.trim()) return '';
  if (looksLikeHtml(str)) return str;
  const withPlaceholdersReplaced = preprocessPlaceholders(str);
  return marked.parse(withPlaceholdersReplaced, { async: false });
}
