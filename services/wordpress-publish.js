/**
 * Publish a post to WordPress via REST API (Application Passwords / Basic auth).
 * @see https://developer.wordpress.org/rest-api/reference/posts/#create-a-post
 *
 * Workflow:
 * 1. Convert post content from markdown to HTML; replace tweet placeholders with Twitter oEmbed.
 * 2. Upload all external images (placeholders and real generated images) to the WordPress media library
 *    (POST /wp/v2/media) and replace img src with the uploaded media URLs so images are served from WordPress.
 * 3. Create the post (POST /wp/v2/posts) with the final content and optional featured_media (first image id).
 *
 * Supports two REST URL styles for both posts and media:
 * - Pretty: /wp-json/wp/v2/posts and /wp-json/wp/v2/media
 * - Index.php: index.php?rest_route=/wp/v2/posts and .../wp/v2/media. Set credentials.useIndexPhpRestRoute = true.
 */
import { markdownToHtml, TWEET_EMBED_MARKER } from '../lib/markdown-to-html.js';

const WP_POSTS_PATH = '/wp-json/wp/v2/posts';
const WP_POSTS_REST_ROUTE = '/index.php?rest_route=/wp/v2/posts';
const WP_MEDIA_PATH = '/wp-json/wp/v2/media';
const WP_MEDIA_REST_ROUTE = '/index.php?rest_route=/wp/v2/media';

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

/** Remove inline style attributes so strict WordPress/KSES configs don't strip our tags. */
function stripStyleAttrs(html) {
  return html.replace(/\s+style="[^"]*"/g, '');
}

/**
 * Wrap our image/chart figures in WordPress block format so the block editor preserves them.
 * Uses wp:html (Custom HTML block) so both images and tweets are stored the same way; some
 * setups strip wp:image but preserve wp:html. Minimal HTML (no inline styles) for strict filters.
 */
function wrapFiguresInBlockFormat(html) {
  let out = html;
  // Image placeholder: wrap in wp:html (Custom HTML) so it survives when wp:image is stripped
  const imageFigureRe = /<figure class="amb-image-placeholder"([^>]*)>([\s\S]*?)<\/figure>/g;
  out = out.replace(imageFigureRe, (_, attrs, inner) => {
    const minimal = `<!-- wp:html -->\n<figure class="wp-block-image amb-image-placeholder"${stripStyleAttrs(attrs)}>${stripStyleAttrs(inner)}</figure>\n<!-- /wp:html -->`;
    return minimal;
  });
  // Chart placeholder: same
  const chartFigureRe = /<figure class="amb-chart-placeholder"([^>]*)>([\s\S]*?)<\/figure>/g;
  out = out.replace(chartFigureRe, (_, attrs, inner) => {
    const minimal = `<!-- wp:html -->\n<figure class="wp-block-image amb-chart-placeholder"${stripStyleAttrs(attrs)}>${stripStyleAttrs(inner)}</figure>\n<!-- /wp:html -->`;
    return minimal;
  });
  return out;
}

/** Prepare post content for WordPress: markdown→HTML and replace tweet markers with oEmbed HTML. */
async function prepareContentForWordPress(content) {
  const raw = content ?? '';
  const { html, tweetUrls } = markdownToHtml(raw, { forWordPressTweetEmbeds: true });
  let out = wrapFiguresInBlockFormat(html);
  if (tweetUrls.length === 0) return out;
  const oEmbedHtmls = [];
  for (let i = 0; i < tweetUrls.length; i++) {
    oEmbedHtmls.push(await fetchTweetOEmbedHtml(tweetUrls[i]));
    if (i < tweetUrls.length - 1) await new Promise((r) => setTimeout(r, 300));
  }
  for (let i = 0; i < oEmbedHtmls.length; i++) {
    const marker = `<!-- ${TWEET_EMBED_MARKER}${i} -->`;
    const embedHtml = oEmbedHtmls[i];
    const wrapped = embedHtml.trim().startsWith('<!--') ? embedHtml : `<!-- wp:html -->\n${embedHtml}\n<!-- /wp:html -->`;
    out = out.split(marker).join(wrapped);
  }
  return out;
}

/**
 * Upload all external images (placeholders and real generated images) to WordPress media and replace img src.
 * Skips URLs that are already on the same WordPress site. Returns { contentHtml, featuredMediaId }.
 */
async function uploadExternalImagesAndReplace(ctx, contentHtml) {
  const matches = [...contentHtml.matchAll(EXTERNAL_IMAGE_SRC_RE)];
  let uniqueUrls = [...new Set(matches.map((m) => m[1]))];
  try {
    const wpOrigin = new URL(String(ctx.baseUrl || '').trim().replace(/\/+$/, '') || 'https://dummy').origin;
    uniqueUrls = uniqueUrls.filter((url) => new URL(url).origin !== wpOrigin);
  } catch {
    // keep all if baseUrl invalid
  }
  if (uniqueUrls.length === 0) return { contentHtml, featuredMediaId: 0 };
  const urlToMedia = new Map();
  for (let i = 0; i < uniqueUrls.length; i++) {
    const url = uniqueUrls[i];
    try {
      const filename = filenameFromImageUrl(url);
      const media = await uploadImageToWordPressMedia(ctx, url, { filename });
      urlToMedia.set(url, media);
      if (i < uniqueUrls.length - 1) await new Promise((r) => setTimeout(r, 200));
    } catch (e) {
      console.warn('WordPress media upload failed for image:', url.substring(0, 80), e?.message || e);
    }
  }
  let out = contentHtml;
  for (const [url, media] of urlToMedia) {
    out = out.split(url).join(media.source_url);
  }
  const firstMedia = urlToMedia.get(uniqueUrls[0]);
  return { contentHtml: out, featuredMediaId: firstMedia ? firstMedia.id : 0 };
}

function buildPostsUrl(baseUrl, useIndexPhpRestRoute) {
  const base = String(baseUrl).trim().replace(/\/+$/, '');
  return useIndexPhpRestRoute ? `${base}${WP_POSTS_REST_ROUTE}` : `${base}${WP_POSTS_PATH}`;
}

function buildMediaUrl(baseUrl, useIndexPhpRestRoute) {
  const base = String(baseUrl).trim().replace(/\/+$/, '');
  return useIndexPhpRestRoute ? `${base}${WP_MEDIA_REST_ROUTE}` : `${base}${WP_MEDIA_PATH}`;
}

/** Match any external img src (https or http) so we upload placeholders and real generated images. */
const EXTERNAL_IMAGE_SRC_RE = /src="(https?:\/\/[^"]+)"/g;

/** Derive a safe filename for media upload from an image URL. */
function filenameFromImageUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.split('/').pop() || '';
    return /\.(png|jpe?g|gif|webp)$/i.test(base) ? base : 'image.png';
  } catch {
    return 'image.png';
  }
}

/**
 * Upload an image to the WordPress media library via REST API.
 * @param {object} ctx - { baseUrl, auth, useIndexPhpRestRoute }
 * @param {string} imageUrl - URL of the image to upload (e.g. placeholder or generated image URL)
 * @param {{ filename?: string, alt?: string }} [opts] - optional filename and alt text
 * @returns {Promise<{ id: number, source_url: string }>}
 */
async function uploadImageToWordPressMedia(ctx, imageUrl, opts = {}) {
  const { baseUrl, auth, useIndexPhpRestRoute } = ctx;
  const filename = opts.filename || 'image.png';
  const mime = filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  let imageBuffer;
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Fetch image ${res.status}`);
    const ab = await res.arrayBuffer();
    imageBuffer = Buffer.from(ab);
  } catch (e) {
    throw new Error(`Could not fetch image for upload: ${e?.message || e}`);
  }
  const mediaUrl = buildMediaUrl(baseUrl, useIndexPhpRestRoute);
  const headers = {
    Authorization: `Basic ${auth}`,
    'Content-Type': mime,
    'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '\\"')}"`
  };
  let response = await fetch(mediaUrl, { method: 'POST', headers, body: imageBuffer });
  if (response.status === 404 && !useIndexPhpRestRoute) {
    const fallbackUrl = buildMediaUrl(baseUrl, true);
    response = await fetch(fallbackUrl, { method: 'POST', headers, body: imageBuffer });
  }
  const text = await response.text();
  if (!response.ok) {
    let msg = `Media upload failed ${response.status}`;
    try {
      const json = JSON.parse(text);
      if (json.message) msg = json.message;
      else if (json.code) msg = json.code;
    } catch {
      if (text && text.length < 300) msg = text;
    }
    throw new Error(msg);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Media upload response was not valid JSON');
  }
  const sourceUrl = data.source_url || data.guid?.rendered || data.link;
  if (!data.id || !sourceUrl) throw new Error('Media upload did not return id or source_url');
  const result = { id: data.id, source_url: sourceUrl };
  if (opts.alt && data.id) {
    try {
      await fetch(`${mediaUrl}/${data.id}`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ alt_text: opts.alt })
      });
    } catch {
      /* optional alt update */
    }
  }
  return result;
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
  const useIndexPhp = !!useIndexPhpRestRoute;
  const ctx = { baseUrl, auth, useIndexPhpRestRoute: useIndexPhp };
  const status = opts.status === 'draft' ? 'draft' : 'publish';
  let contentHtml = await prepareContentForWordPress(post.content);
  const { contentHtml: contentWithMedia, featuredMediaId } = await uploadExternalImagesAndReplace(ctx, contentHtml);
  contentHtml = contentWithMedia;
  const postPayload = {
    title: post.title || 'Untitled',
    content: contentHtml,
    status
  };
  if (featuredMediaId > 0) postPayload.featured_media = featuredMediaId;
  const body = JSON.stringify(postPayload);

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
