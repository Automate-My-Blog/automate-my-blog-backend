/**
 * Publish a post to Substack.
 * Substack's public Partner API (auth.substackapi.dev API key) does not expose a documented
 * write endpoint for creating posts. This module throws until a write API is available or
 * we integrate with a supported method (e.g. cookie-based gateway).
 * @see https://substackapi.dev/ — read-only endpoints documented
 * @see https://auth.substackapi.dev/ — API key generator
 */

/**
 * Attempt to publish a post to Substack. Currently unsupported.
 * @param {object} credentials - { api_key, publication_url? } from getConnectionCredentials(userId, 'substack')
 * @param {object} post - { title, content }
 * @returns {Promise<{ url: string, id: string }>}
 * @throws {Error} Substack write API not yet available
 */
export async function publishToSubstack(credentials, post) {
  if (!credentials?.api_key) {
    throw new Error('Substack connection missing api_key. Reconnect Substack in Settings.');
  }
  throw new Error(
    'Substack post creation is not yet supported via the API key. The Partner API does not expose a create-post endpoint. Publish from your Substack dashboard or use a supported integration when available.'
  );
}
