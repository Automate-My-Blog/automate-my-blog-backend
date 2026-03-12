/**
 * Publish a post to Medium via OAuth API.
 * @see https://github.com/Medium/medium-api-docs#33-posts
 * POST https://api.medium.com/v1/users/{userId}/posts
 */

const MEDIUM_ME_URL = 'https://api.medium.com/v1/me';

/**
 * Resolve Medium user id from credentials or by calling /me.
 * @param {object} credentials - { access_token, medium_user_id? }
 * @returns {Promise<string>} Medium user id
 */
async function getMediumUserId(credentials) {
  if (credentials.medium_user_id) {
    return credentials.medium_user_id;
  }
  const res = await fetch(MEDIUM_ME_URL, {
    headers: { Authorization: `Bearer ${credentials.access_token}` }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Medium /me failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const id = data?.data?.id;
  if (!id) {
    throw new Error('Medium /me did not return user id');
  }
  return id;
}

/**
 * Publish a post to Medium.
 * @param {object} credentials - { access_token, medium_user_id? } from getConnectionCredentials(userId, 'medium')
 * @param {object} post - { title, content } (content can be HTML or markdown)
 * @param {{ publishStatus?: 'public'|'draft'|'unlisted' }} [opts] - default publishStatus 'public'
 * @returns {Promise<{ url: string, id: string }>}
 */
export async function publishToMedium(credentials, post, opts = {}) {
  const accessToken = credentials?.access_token;
  if (!accessToken) {
    throw new Error('Medium connection missing access_token. Reconnect Medium in Settings.');
  }

  const userId = await getMediumUserId(credentials);
  const url = `https://api.medium.com/v1/users/${userId}/posts`;

  const publishStatus = opts.publishStatus === 'draft' ? 'draft' : opts.publishStatus === 'unlisted' ? 'unlisted' : 'public';
  const body = {
    title: post.title || 'Untitled',
    contentFormat: 'html',
    content: post.content || '',
    license: 'all-rights-reserved',
    publishStatus
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (res.status === 401) {
    throw new Error('Medium rejected the access token. Reconnect Medium in Settings.');
  }
  if (!res.ok) {
    const text = await res.text();
    let message = `Medium returned ${res.status}`;
    try {
      const json = JSON.parse(text);
      if (json.errors) {
        const err = Array.isArray(json.errors) ? json.errors[0] : json.errors;
        message = err?.message || err?.msg || JSON.stringify(err);
      } else if (json.message) {
        message = json.message;
      }
    } catch {
      if (text && text.length < 200) message = text;
    }
    throw new Error(message);
  }

  const data = await res.json();
  const created = data?.data;
  if (!created) {
    throw new Error('Medium did not return the created post');
  }

  const postUrl = created.url || (created.id ? `https://medium.com/p/${created.id}` : null);
  return {
    url: postUrl || '',
    id: created.id || ''
  };
}
