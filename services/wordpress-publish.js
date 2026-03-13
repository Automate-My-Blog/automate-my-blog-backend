/**
 * Publish a post to WordPress via REST API (Application Passwords / Basic auth).
 * @see https://developer.wordpress.org/rest-api/reference/posts/#create-a-post
 *
 * Supports two REST URL styles:
 * - Pretty: {site_url}/wp-json/wp/v2/posts
 * - Index.php (no pretty permalinks): {site_url}/index.php?rest_route=/wp/v2/posts
 * Set credentials.useIndexPhpRestRoute = true to use the index.php form, or we retry on 404.
 *
 * Post content is converted from markdown to HTML; tweet placeholders are replaced with Twitter oEmbed HTML so tweets display.
 */
import { markdownToHtml, TWEET_EMBED_MARKER } from '../lib/markdown-to-html.js';

const WP_POSTS_PATH = '/wp-json/wp/v2/posts';
const WP_POSTS_REST_ROUTE = '/index.php?rest_route=/wp/v2/posts';

/** Fetch Twitter/X oEmbed HTML for a tweet URL. Returns embed HTML or fallback link on failure. */
async function fetchTweetOEmbedHtml(tweetUrl) {
  try {
    const oEmbedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}&dnt=true`;
    const res = await fetch(oEmbedUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`oEmbed ${res.status}`);
    const data = await res.json();
    if (data && typeof data.html === 'string') return data.html.trim();
  } catch (e) {
    console.warn('Tweet oEmbed fetch failed:', tweetUrl, e?.message || e);
  }
  return `<blockquote class="twitter-tweet-embed" style="border-left: 4px solid #1da1f2; padding: 12px 16px; margin: 16px 0; background: #f8f9fa; border-radius: 8px;"><a href="${tweetUrl.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer" style="color: #1da1f2;">View tweet on X</a></blockquote>`;
}

/** Prepare post content for WordPress: markdown→HTML and replace tweet markers with oEmbed HTML. */
async function prepareContentForWordPress(content) {
  const raw = content ?? '';
  const { html, tweetUrls } = markdownToHtml(raw, { forWordPressTweetEmbeds: true });
  if (tweetUrls.length === 0) return html;
  const oEmbedHtmls = [];
  for (let i = 0; i < tweetUrls.length; i++) {
    oEmbedHtmls.push(await fetchTweetOEmbedHtml(tweetUrls[i]));
    if (i < tweetUrls.length - 1) await new Promise((r) => setTimeout(r, 300));
  }
  let out = html;
  for (let i = 0; i < oEmbedHtmls.length; i++) {
    const marker = `<!-- ${TWEET_EMBED_MARKER}${i} -->`;
    out = out.split(marker).join(oEmbedHtmls[i]);
  }
  return out;
}

function buildPostsUrl(baseUrl, useIndexPhpRestRoute) {
  const base = String(baseUrl).trim().replace(/\/+$/, '');
  return useIndexPhpRestRoute ? `${base}${WP_POSTS_REST_ROUTE}` : `${base}${WP_POSTS_PATH}`;
}

/**
 * Publish a post to WordPress.
 * @param {object} credentials - { site_url, username, application_password, useIndexPhpRestRoute?: boolean }
 * @param {object} post - { title, content }
 * @param {{ status?: 'publish'|'draft' }} [opts] - optional status (default 'publish')
 * @returns {Promise<{ url: string, id: number }>}
 * @throws {Error} on auth failure, invalid response, or network error
 */
export async function publishToWordPress(credentials, post, opts = {}) {
  const { site_url, username, application_password, useIndexPhpRestRoute } = credentials || {};
  if (!site_url || !application_password) {
    throw new Error('WordPress connection missing site_url or application_password');
  }
  if (!username || !String(username).trim()) {
    throw new Error('WordPress connection missing username. Reconnect WordPress in Settings and provide your WordPress username.');
  }

  const baseUrl = String(site_url).trim().replace(/\/+$/, '');
  const auth = Buffer.from(`${username}:${application_password}`, 'utf8').toString('base64');
  const status = opts.status === 'draft' ? 'draft' : 'publish';
  const contentHtml = await prepareContentForWordPress(post.content);
  const body = JSON.stringify({
    title: post.title || 'Untitled',
    content: contentHtml,
    status
  });

  const headers = {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json'
  };

  let url = buildPostsUrl(baseUrl, !!useIndexPhpRestRoute);
  let res = await fetch(url, { method: 'POST', headers, body });

  // If 404 and we used pretty permalinks, retry with index.php?rest_route= (sites without pretty REST)
  if (res.status === 404 && !useIndexPhpRestRoute) {
    url = buildPostsUrl(baseUrl, true);
    res = await fetch(url, { method: 'POST', headers, body });
  }

  const text = await res.text();
  if (res.status === 401) {
    try {
      const json = JSON.parse(text);
      if (json.code === 'rest_cannot_create' || (json.message && json.message.includes('not allowed to create posts'))) {
        throw new Error('WordPress user does not have permission to create posts. In WordPress, set the user\'s role to Editor or Administrator (Users → edit user → Role).');
      }
    } catch (e) {
      if (e.message && e.message.includes('permission to create posts')) throw e;
    }
    throw new Error('WordPress rejected credentials. Check username and application password.');
  }
  if (res.status === 404) {
    throw new Error('WordPress REST API not found. Ensure your site has REST API enabled and the URL is correct. If your site uses index.php for the REST API, reconnect WordPress and enable "Use index.php?rest_route= for REST API".');
  }
  const looksLikeHtml = /^\s*<\s*!?\s*DOCTYPE|^\s*<\s*html\b/i.test(text.trim());

  if (!res.ok) {
    let message = `WordPress returned ${res.status}`;
    try {
      const json = JSON.parse(text);
      if (json.message) message = json.message;
      else if (json.code) message = json.code;
    } catch {
      if (text && text.length < 200) message = text;
      else if (looksLikeHtml) message = `WordPress returned ${res.status} with an HTML page instead of JSON. Check REST API URL and server configuration.`;
    }
    throw new Error(message);
  }

  if (looksLikeHtml) {
    throw new Error(
      'WordPress returned an HTML page instead of JSON. The REST API URL may be wrong, or a plugin/server is serving a page instead of the API. Try the other REST URL option (index.php?rest_route=) or check WordPress plugins and server config.'
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('WordPress response was not valid JSON. The server may be returning an HTML or error page.');
  }
  const link = data.link || (data.guid && data.guid.rendered) || null;
  const id = data.id != null ? data.id : 0;
  if (!link && !id) {
    throw new Error('WordPress did not return post link or id');
  }
  return {
    url: link || `${baseUrl}/?p=${id}`,
    id
  };
}
