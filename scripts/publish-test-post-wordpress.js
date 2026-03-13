#!/usr/bin/env node
/**
 * Real-world flow: generate blog content via stream → save post → publish to WordPress.
 * Mirrors the frontend: POST blog/generate-stream, consume SSE (content-chunk + complete),
 * POST /posts to create, POST /posts/:id/publish with platforms: ["wordpress"].
 *
 * The backend converts post body from markdown to HTML before sending to WordPress so
 * posts render correctly (headings, lists, links, etc.). This script verifies that
 * conversion using the same lib/markdown-to-html.js helper.
 *
 * Usage:
 *   BACKEND_URL=https://automate-my-blog-backend-env-staging-automate-my-blog.vercel.app \
 *   TEST_JWT=<your-jwt> \
 *   node scripts/publish-test-post-wordpress.js
 *
 * Get TEST_JWT: log in on staging, then DevTools → Application → Cookies → access_token,
 * or Network tab → any API request → Authorization header.
 *
 * WordPress: If your site uses index.php?rest_route= for the REST API, reconnect in Settings
 * with "Use index.php?rest_route= for REST API" (or POST /connect with use_index_php_rest_route: true).
 *
 * Options:
 *   --verify-markdown-only   Run only the markdown→HTML conversion check (no API calls); no TEST_JWT needed.
 *   --verify-placeholders   Run only the image/tweet placeholder conversion check (no API calls); no TEST_JWT needed.
 *   --no-placeholders      Do not append image/tweet placeholders (default is to append them so the published post can be fully verified).
 *   (Use both to verify full local transform: --verify-markdown-only --verify-placeholders)
 */

import dotenv from 'dotenv';
import { markdownToHtml } from '../lib/markdown-to-html.js';

dotenv.config();

const VERIFY_MARKDOWN_ONLY = process.argv.includes('--verify-markdown-only');
const VERIFY_PLACEHOLDERS = process.argv.includes('--verify-placeholders');
const WITH_PLACEHOLDERS = !process.argv.includes('--no-placeholders');

/** Content block appended when --with-placeholders (default) so the published post has images and a tweet to verify. */
const SAMPLE_IMAGE_AND_TWEET = `

## Test section: image and tweet

[Image: A professional photo of a laptop and notebook on a desk, with coffee and plants, representing productivity and testing.]

![TWEET:https://x.com/WordPress/status/1360456723093266432]

Above: placeholder image and Twitter embed for WordPress publish verification.
`;

const BASE = process.env.BACKEND_URL ||
  'https://automate-my-blog-backend-env-staging-automate-my-blog.vercel.app';
const token = process.env.TEST_JWT || process.env.STAGING_TEST_TOKEN;

function log(msg, type = '') {
  const p = type === 'err' ? '❌' : type === 'ok' ? '✅' : '  ';
  console.log(`${p} ${msg}`);
}

async function fetchJson(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...opts, headers });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  return { ok: res.ok, status: res.status, body, res };
}

/**
 * Consume SSE from streamUrl until "complete" or "error". Returns { event, data } for complete/error.
 * Uses fetch + ReadableStream; parses event: and data: lines (supports multi-line data).
 */
async function consumeSSEUntilComplete(streamUrl) {
  const res = await fetch(streamUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    redirect: 'follow'
  });
  if (!res.ok) {
    throw new Error(`Stream failed ${res.status}: ${await res.text()}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = null;
  const dataLines = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      } else if (line === '' && currentEvent && dataLines.length > 0) {
        const currentData = dataLines.join('\n');
        dataLines.length = 0;
        if (currentEvent === 'complete' || currentEvent === 'error') {
          try {
            const data = JSON.parse(currentData);
            return { event: currentEvent, data };
          } catch (e) {
            return { event: currentEvent, data: { message: currentData } };
          }
        }
        currentEvent = null;
      }
    }
  }
  throw new Error('Stream ended without complete or error event');
}

async function main() {
  console.log('\n📮 WordPress test post — real-world flow');
  console.log('==========================================');
  console.log('Backend:', BASE);

  if (VERIFY_MARKDOWN_ONLY || VERIFY_PLACEHOLDERS) {
    let allOk = true;
    if (VERIFY_MARKDOWN_ONLY) {
      const sample = '# Test heading\n\nParagraph with **bold** and [link](https://example.com).';
      const html = markdownToHtml(sample);
      const ok = html.includes('<h1>') && html.includes('Test heading') && html.includes('<strong>bold</strong>') && html.includes('<a href="https://example.com"');
      if (ok) {
        log('Markdown→HTML conversion (same logic used when publishing to WordPress): OK', 'ok');
      } else {
        log('Markdown→HTML conversion check failed.', 'err');
        allOk = false;
      }
    }
    if (VERIFY_PLACEHOLDERS) {
      const sampleWithPlaceholders = `
# Title
[Image: An immersive fantasy landscape with castles and forests]
## Section
[TWEET:1]
[VIDEO:3]
[TWEET:0]
`;
      const { html } = markdownToHtml(sampleWithPlaceholders, { forWordPressTweetEmbeds: true });
      const hasImg = /<img\s/i.test(html) && /via\.placeholder\.com/.test(html);
      const hasFigure = /<figure/i.test(html);
      const noRawImage = !/\[Image:\s*[^\]]*\]/.test(html);
      const noRawTweetIndex = !/\[TWEET:0\]/.test(html) && !/\[TWEET:1\]/.test(html);
      const noRawVideo = !/\[VIDEO:3\]/.test(html);
      if (hasImg && hasFigure && noRawImage && noRawTweetIndex && noRawVideo) {
        log('Image/tweet/video placeholders → <figure><img> or removed: OK', 'ok');
      } else {
        if (!hasImg) log('Placeholder check: expected <img> with via.placeholder.com', 'err');
        if (!hasFigure) log('Placeholder check: expected <figure>', 'err');
        if (!noRawImage) log('Placeholder check: raw [Image: ...] should be replaced', 'err');
        if (!noRawTweetIndex) log('Placeholder check: raw [TWEET:0]/[TWEET:1] should be removed', 'err');
        if (!noRawVideo) log('Placeholder check: raw [VIDEO:3] should be removed', 'err');
        allOk = false;
      }
    }
    if (allOk) {
      console.log('');
      process.exit(0);
    }
    process.exit(1);
  }

  if (!token) {
    console.error('\n❌ TEST_JWT (or STAGING_TEST_TOKEN) is required.');
    console.error('   Log in on staging, then copy the access_token cookie or Bearer token.');
    process.exit(1);
  }

  // 1. Auth and user context (same as frontend)
  log('Auth and user context...');
  const me = await fetchJson('/api/v1/auth/me');
  if (!me.ok) {
    log('Auth failed: ' + (me.body?.message || me.status), 'err');
    process.exit(1);
  }
  const user = me.body?.user;
  const organizationId = user?.organizationId || user?.organization_id;
  if (!organizationId) {
    log('User has no organizationId (required for generate-stream).', 'err');
    process.exit(1);
  }
  log(`Authenticated; organizationId=${organizationId}`, 'ok');

  // 2. Verify WordPress connected (same as frontend before showing Publish)
  const conn = await fetchJson('/api/v1/publishing-platforms/connections');
  if (!conn.ok) {
    log('Failed to load connections: ' + conn.status, 'err');
    process.exit(1);
  }
  const wp = conn.body.connections?.find((c) => c.platform === 'wordpress' && c.connected);
  if (!wp) {
    log('WordPress is not connected. Connect it in Settings first.', 'err');
    process.exit(1);
  }
  log(`WordPress connected: ${wp.site_url || ''} ${wp.account ? `(as ${wp.account})` : ''}`, 'ok');

  // 3. Start blog generation stream (same payload shape as frontend)
  const topic = {
    title: 'How to Test Your WordPress Integration',
    subheader: 'A quick guide to verifying your Automate My Blog → WordPress connection.'
  };
  const businessInfo = {
    businessType: 'SaaS / Content tools',
    targetAudience: 'Bloggers and content teams',
    brandVoice: 'Clear and helpful'
  };

  log('Starting blog generation stream (POST /api/v1/blog/generate-stream)...');
  const startRes = await fetchJson('/api/v1/blog/generate-stream', {
    method: 'POST',
    body: JSON.stringify({
      topic,
      businessInfo,
      organizationId,
      additionalInstructions: 'Keep it short: one intro paragraph and one bullet list. This is a test post.'
    })
  });

  if (!startRes.ok) {
    const msg = startRes.body?.message || startRes.body?.error || startRes.status;
    log('generate-stream failed: ' + msg, 'err');
    if (startRes.status === 402) {
      log('Insufficient credits. Use an account with credits.', 'err');
    }
    process.exit(1);
  }

  const { connectionId, streamUrl } = startRes.body;
  if (!streamUrl) {
    log('No streamUrl in response.', 'err');
    process.exit(1);
  }
  log(`Stream started; opening SSE (use streamUrl as-is for auth)...`, 'ok');

  // 4. Consume SSE until complete (same as frontend EventSource)
  let result;
  try {
    const out = await consumeSSEUntilComplete(streamUrl);
    if (out.event === 'error') {
      log('Stream error: ' + (out.data?.message || JSON.stringify(out.data)), 'err');
      process.exit(1);
    }
    result = out.data?.result;
    if (!result) {
      log('Complete event had no result.', 'err');
      process.exit(1);
    }
  } catch (e) {
    log('SSE error: ' + e.message, 'err');
    process.exit(1);
  }

  const title = result.title || topic.title;
  let content = result.content || '';
  if (WITH_PLACEHOLDERS) {
    content = content + SAMPLE_IMAGE_AND_TWEET;
    log('Appended image + tweet placeholders for full publish verification', 'ok');
  }
  log(`Stream complete; title="${title.slice(0, 40)}..."`, 'ok');

  // 4b. Verify markdown→HTML conversion (same logic backend uses when publishing to WordPress)
  const contentHtml = markdownToHtml(content);
  const hasMarkdown = /^#+\s|\[.+\]\(.+\)|\*\*[^*]+\*\*|^\s*[-*]\s/m.test(content);
  const hasHtml = /<h[1-6]|<\/p>|<a\s|<ul|<ol|<li/.test(contentHtml);
  if (hasMarkdown && contentHtml && contentHtml.length > 0) {
    log('Markdown→HTML: content will be sent to WordPress as rendered HTML', 'ok');
    if (!hasHtml && content.trim().length > 20) {
      log('Note: converted HTML has no common block tags (content may be plain).', '');
    }
  }

  // 5. Create post (same as frontend after generation: POST /api/v1/posts)
  log('Creating post (POST /api/v1/posts)...');
  const createRes = await fetchJson('/api/v1/posts', {
    method: 'POST',
    body: JSON.stringify({
      title,
      content,
      status: 'draft',
      topic_data: { topic, businessInfo },
      generation_metadata: result
    })
  });

  if (!createRes.ok) {
    log('Create post failed: ' + (createRes.body?.message || createRes.status), 'err');
    process.exit(1);
  }

  const post = createRes.body?.post || createRes.body;
  const postId = post?.id;
  if (!postId) {
    log('No post id in create response.', 'err');
    process.exit(1);
  }
  log(`Post created: ${postId}`, 'ok');

  // 6. Publish to WordPress (same request as frontend: platforms + optional publish_mode)
  const useIndexPhp = process.env.USE_INDEX_PHP_REST_ROUTE === 'true' || process.env.USE_INDEX_PHP_REST_ROUTE === '1';
  if (useIndexPhp) log('Publishing with wordpress_use_index_php_rest_route: true', 'ok');
  log('Publishing to WordPress (POST /api/v1/posts/:id/publish)...');
  const publishRes = await fetchJson(`/api/v1/posts/${postId}/publish`, {
    method: 'POST',
    body: JSON.stringify({
      platforms: ['wordpress'],
      publish_mode: 'live',
      ...(useIndexPhp && { wordpress_use_index_php_rest_route: true })
    })
  });

  if (!publishRes.ok) {
    log('Publish failed: ' + (publishRes.body?.message || publishRes.body?.error || publishRes.status), 'err');
    process.exit(1);
  }

  const updatedPost = publishRes.body?.post;
  const pubs = updatedPost?.platform_publications || publishRes.body?.platform_publications || [];
  const wpPub = Array.isArray(pubs) ? pubs.find((p) => p.platform === 'wordpress') : null;

  if (wpPub?.status === 'published' && wpPub?.url) {
    console.log('\n✅ Published to WordPress');
    console.log('   URL:', wpPub.url);
    // Verify the live post has images/tweets (no raw placeholders)
    try {
      const pageRes = await fetch(wpPub.url, { redirect: 'follow' });
      const pageHtml = await pageRes.text();
      const hasImageOrBlock = /<img\s/i.test(pageHtml) || /wp:image/.test(pageHtml) || /wp-block-image/.test(pageHtml);
      const hasTweetEmbed = /twitter-tweet|wp:html/.test(pageHtml) || /blockquote.*twitter/.test(pageHtml);
      const hasRawPlaceholders = /\[Image:\s*[^\]]*\]/.test(pageHtml) || /\[TWEET:\d+\]/.test(pageHtml);
      if (hasRawPlaceholders) {
        log('Verification: post still contains raw placeholders [Image:...] or [TWEET:n] on the page', 'err');
      } else if (hasImageOrBlock || hasTweetEmbed) {
        log('Verification: post has images or tweet embeds on the live page', 'ok');
      } else {
        log('Verification: no image/tweet blocks found (post may have no placeholders in content)', '');
      }
    } catch (e) {
      log('Verification: could not fetch post page: ' + e.message, '');
    }
  } else if (wpPub?.status === 'failed') {
    log('WordPress publish failed: ' + (wpPub.message || 'Unknown error'), 'err');
    process.exit(1);
  } else {
    console.log('\n📦 Publish response:', JSON.stringify(publishRes.body, null, 2));
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
