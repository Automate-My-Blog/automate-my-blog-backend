#!/usr/bin/env node
/**
 * Real-world flow: generate blog content via stream → save post → publish to WordPress.
 * Mirrors the frontend: POST blog/generate-stream, consume SSE (content-chunk + complete),
 * POST /posts to create, POST /posts/:id/publish with platforms: ["wordpress"].
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
 */

import dotenv from 'dotenv';
dotenv.config();

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
  const content = result.content || '';
  log(`Stream complete; title="${title.slice(0, 40)}..."`, 'ok');

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
  log('Publishing to WordPress (POST /api/v1/posts/:id/publish)...');
  const publishRes = await fetchJson(`/api/v1/posts/${postId}/publish`, {
    method: 'POST',
    body: JSON.stringify({
      platforms: ['wordpress'],
      publish_mode: 'live'
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
