/**
 * Convert markdown to HTML for publishing (e.g. WordPress, email).
 * Uses marked with GFM so output matches common in-browser renderers (headings, lists, links, code, tables).
 *
 * Replaces app-specific placeholders so they render on WordPress:
 * - ![IMAGE:type:description] / ![CHART:...] → placeholder paragraph (images not yet generated)
 * - ![TWEET:url] / ![TWEET:url::DATA::base64] → blockquote + link (WordPress-friendly tweet embed)
 * - [TWEET:0], [VIDEO:1], [ARTICLE:0] (index-based) → removed so they don't show as raw text
 * - [Image: ...] (literal model output) → removed so it doesn't show as raw text
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

const TWEET_EMBED_MARKER_PREFIX = 'TWEET_EMBED_';

/** Replace ![TWEET:url] or ![TWEET:url::DATA::base64] with WordPress-friendly blockquote + link (default). */
function replaceTweetPlaceholders(str, options = {}) {
  const { useMarkers = false, tweetUrls = [] } = options;
  const tweetRegex = /!\[TWEET:(https?:\/\/[^\]]+?)(?:::DATA::([^\]]+))?\]/g;
  let index = 0;
  return str.replace(tweetRegex, (_, tweetUrl, base64Data) => {
    if (useMarkers) {
      tweetUrls.push(tweetUrl);
      return `\n\n<!-- ${TWEET_EMBED_MARKER_PREFIX}${index++} -->\n\n`;
    }
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

/** Placeholder image URL for unreplaced ![IMAGE:...] so something visible shows on WordPress. */
const PLACEHOLDER_IMAGE_URL = 'https://via.placeholder.com/800x400/f0f0f0/666?text=Image';
const PLACEHOLDER_CHART_URL = 'https://via.placeholder.com/800x300/f0f0f0/666?text=Chart';

/** Replace ![IMAGE:...] and ![CHART:...] with actual <img> or placeholder so images show. */
function replaceImagePlaceholders(str) {
  let out = str;
  // ![IMAGE:type:description] → real img tag (placeholder image so something shows)
  out = out.replace(/!\[IMAGE:(\w+):([^\]]*)\]/g, (_, type, desc) => {
    const alt = (desc && desc.trim()) ? escapeHtml(desc.trim().slice(0, 200)) : escapeHtml(type);
    return `<figure class="amb-image-placeholder" style="margin: 1em 0;"><img src="${PLACEHOLDER_IMAGE_URL}" alt="${alt}" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px;" /><figcaption style="font-size: 0.85em; color: #666; margin-top: 4px;">${alt}</figcaption></figure>`;
  });
  // ![CHART:type|title|labels|values] → placeholder image for chart
  out = out.replace(/!\[CHART:([^\]|]+)\|([^\]|]*)\|([^\]|]*)\|([^\]]*)\]/g, (_, chartType, title) => {
    const label = (title && title.trim()) ? escapeHtml(title.trim().slice(0, 80)) : escapeHtml(chartType) + ' chart';
    return `<figure class="amb-chart-placeholder" style="margin: 1em 0;"><img src="${PLACEHOLDER_CHART_URL}" alt="${label}" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px;" /><figcaption style="font-size: 0.85em; color: #666; margin-top: 4px;">${label}</figcaption></figure>`;
  });
  return out;
}

/** Remove index-based embed placeholders [TWEET:0], [VIDEO:1], [ARTICLE:0] so they don't show as raw text on WordPress. */
function replaceIndexPlaceholders(str) {
  return str
    .replace(/\[TWEET:\d+\]/g, '')
    .replace(/\[VIDEO:\d+\]/g, '')
    .replace(/\[ARTICLE:\d+\]/g, '');
}

/** Replace literal [Image: ...] / [Chart: ...] (model output) with actual placeholder img so something shows. */
function replaceLiteralPlaceholderLines(str) {
  let out = str;
  out = out.replace(/\[Image:([^\]]*)\]/g, (_, desc) => {
    const alt = (desc && desc.trim()) ? escapeHtml(desc.trim().slice(0, 200)) : 'Image';
    return `\n\n<figure class="amb-image-placeholder" style="margin: 1em 0;"><img src="${PLACEHOLDER_IMAGE_URL}" alt="${alt}" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px;" /><figcaption style="font-size: 0.85em; color: #666; margin-top: 4px;">${alt}</figcaption></figure>\n\n`;
  });
  out = out.replace(/\[Chart:([^\]]*)\]/g, (_, title) => {
    const label = (title && title.trim()) ? escapeHtml(title.trim().slice(0, 80)) : 'Chart';
    return `\n\n<figure class="amb-chart-placeholder" style="margin: 1em 0;"><img src="${PLACEHOLDER_CHART_URL}" alt="${label}" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px;" /><figcaption style="font-size: 0.85em; color: #666; margin-top: 4px;">${label}</figcaption></figure>\n\n`;
  });
  return out;
}

/**
 * Preprocess content: replace app placeholders with HTML so they render on WordPress.
 * When tweetUrls array is passed, tweet placeholders are replaced with <!-- TWEET_EMBED_N --> markers and URLs are pushed to tweetUrls.
 */
function preprocessPlaceholders(str, opts = {}) {
  const tweetUrls = opts.tweetUrls || [];
  const useTweetMarkers = tweetUrls.length >= 0 && opts.useTweetMarkers;
  let out = str;
  out = replaceLiteralPlaceholderLines(out);
  out = replaceIndexPlaceholders(out);
  out = replaceImagePlaceholders(replaceTweetPlaceholders(out, { useMarkers: useTweetMarkers, tweetUrls }));
  // Collapse runs of 3+ newlines so removed placeholders don't leave big gaps
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}

/**
 * Convert markdown to HTML. If input looks like HTML, returns as-is (no double conversion).
 * Replaces image/chart placeholders with <img> or placeholder; tweet placeholders with blockquote or markers.
 * @param {string} markdown - Post body (markdown or already HTML)
 * @param {{ forWordPressTweetEmbeds?: boolean }} [options] - If true, tweet placeholders become <!-- TWEET_EMBED_N --> and returns { html, tweetUrls }.
 * @returns {string | { html: string, tweetUrls: string[] }} HTML string, or { html, tweetUrls } when forWordPressTweetEmbeds is true.
 */
export function markdownToHtml(markdown, options = {}) {
  if (markdown == null) return options.forWordPressTweetEmbeds ? { html: '', tweetUrls: [] } : '';
  const str = String(markdown);
  if (!str.trim()) return options.forWordPressTweetEmbeds ? { html: '', tweetUrls: [] } : '';
  if (looksLikeHtml(str)) return options.forWordPressTweetEmbeds ? { html: str, tweetUrls: [] } : str;

  const tweetUrls = [];
  const withPlaceholdersReplaced = preprocessPlaceholders(str, { tweetUrls, useTweetMarkers: !!options.forWordPressTweetEmbeds });
  const html = marked.parse(withPlaceholdersReplaced, { async: false });

  if (options.forWordPressTweetEmbeds) {
    return { html, tweetUrls };
  }
  return html;
}

/** Marker prefix for tweet embeds (so WordPress publish can replace with oEmbed HTML). */
export const TWEET_EMBED_MARKER = TWEET_EMBED_MARKER_PREFIX;
