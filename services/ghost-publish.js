/**
 * Publish a post to Ghost via Admin API (JWT from Admin API key).
 * @see https://ghost.org/docs/admin-api/#token-authentication
 * @see https://ghost.org/docs/admin-api/posts/creating-a-post
 * POST {admin_url}/ghost/api/admin/posts/?source=html
 */
import jwt from 'jsonwebtoken';

const GHOST_ACCEPT_VERSION = 'v5.0';

/**
 * Build a short-lived JWT for Ghost Admin API.
 * @param {string} adminApiKey - "id:hexsecret" from Ghost Integrations
 * @returns {string} JWT for Authorization: Ghost <token>
 */
function ghostToken(adminApiKey) {
  const parts = String(adminApiKey).trim().split(':');
  if (parts.length < 2) {
    throw new Error('Ghost Admin API key must be in the form id:secret');
  }
  const [id, hexSecret] = parts;
  const secret = Buffer.from(hexSecret, 'hex');
  if (secret.length === 0) {
    throw new Error('Ghost Admin API key secret must be valid hex');
  }
  return jwt.sign(
    {},
    secret,
    {
      algorithm: 'HS256',
      keyid: id,
      audience: '/admin/',
      expiresIn: '5m'
    }
  );
}

/**
 * Publish a post to Ghost.
 * @param {object} credentials - { admin_url, admin_api_key } from getConnectionCredentials(userId, 'ghost')
 * @param {object} post - { title, content } (content as HTML)
 * @param {{ status?: 'published'|'draft' }} [opts] - default 'published'
 * @returns {Promise<{ url: string, id: string }>}
 */
export async function publishToGhost(credentials, post, opts = {}) {
  const { admin_url, admin_api_key } = credentials || {};
  if (!admin_url || !admin_api_key) {
    throw new Error('Ghost connection missing admin_url or admin_api_key. Reconnect Ghost in Settings.');
  }

  const baseUrl = String(admin_url).trim().replace(/\/+$/, '');
  const url = `${baseUrl}/ghost/api/admin/posts/?source=html`;
  const token = ghostToken(admin_api_key);
  const status = opts.status === 'draft' ? 'draft' : 'published';

  const body = {
    posts: [
      {
        title: post.title || 'Untitled',
        html: post.content || '',
        status
      }
    ]
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Ghost ${token}`,
      'Content-Type': 'application/json',
      'Accept-Version': GHOST_ACCEPT_VERSION
    },
    body: JSON.stringify(body)
  });

  if (res.status === 401) {
    throw new Error('Ghost rejected the API key. Check your Ghost Admin API key in Settings.');
  }
  if (!res.ok) {
    const text = await res.text();
    let message = `Ghost returned ${res.status}`;
    try {
      const json = JSON.parse(text);
      if (json.errors?.[0]?.message) message = json.errors[0].message;
      else if (json.message) message = json.message;
    } catch {
      if (text && text.length < 200) message = text;
    }
    throw new Error(message);
  }

  const data = await res.json();
  const created = data?.posts?.[0];
  if (!created) {
    throw new Error('Ghost did not return the created post');
  }

  const postUrl = created.url || (created.id ? `${baseUrl.replace(/\/admin.*$/, '')}/${created.slug}/` : null);
  return {
    url: postUrl || '',
    id: created.id || ''
  };
}
