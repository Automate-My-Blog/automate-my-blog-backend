/**
 * Publish a post to WordPress via REST API (Application Passwords / Basic auth).
 * @see https://developer.wordpress.org/rest-api/reference/posts/#create-a-post
 */
const WP_POSTS_PATH = '/wp-json/wp/v2/posts';

/**
 * Publish a post to WordPress.
 * @param {object} credentials - { site_url, username, application_password }
 * @param {object} post - { title, content }
 * @param {{ status?: 'publish'|'draft' }} [opts] - optional status (default 'publish')
 * @returns {Promise<{ url: string, id: number }>}
 * @throws {Error} on auth failure, invalid response, or network error
 */
export async function publishToWordPress(credentials, post, opts = {}) {
  const { site_url, username, application_password } = credentials || {};
  if (!site_url || !application_password) {
    throw new Error('WordPress connection missing site_url or application_password');
  }
  if (!username || !String(username).trim()) {
    throw new Error('WordPress connection missing username. Reconnect WordPress in Settings and provide your WordPress username.');
  }

  const baseUrl = String(site_url).trim().replace(/\/+$/, '');
  const url = `${baseUrl}${WP_POSTS_PATH}`;
  const auth = Buffer.from(`${username}:${application_password}`, 'utf8').toString('base64');

  const status = opts.status === 'draft' ? 'draft' : 'publish';
  const body = JSON.stringify({
    title: post.title || 'Untitled',
    content: post.content || '',
    status
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body
  });

  if (res.status === 401) {
    throw new Error('WordPress rejected credentials. Check username and application password.');
  }
  if (res.status === 404) {
    throw new Error('WordPress REST API not found. Ensure your site has REST API enabled and the URL is correct.');
  }
  if (!res.ok) {
    const text = await res.text();
    let message = `WordPress returned ${res.status}`;
    try {
      const json = JSON.parse(text);
      if (json.message) message = json.message;
      else if (json.code) message = json.code;
    } catch {
      if (text && text.length < 200) message = text;
    }
    throw new Error(message);
  }

  const data = await res.json();
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
