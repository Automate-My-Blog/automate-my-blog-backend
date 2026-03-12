/**
 * Publish a post to Sanity (create/update document).
 * Requires project_id, dataset, api_token (stored in connection).
 * Document type and field mapping need to be configured for full implementation.
 * @see https://www.sanity.io/docs/http-api
 */

/**
 * Publish a post to Sanity. Not yet implemented.
 * @param {object} credentials - { project_id, dataset, api_token }
 * @param {object} post - { title, content }
 * @returns {Promise<{ url: string, id: string }>}
 * @throws {Error} until Sanity document creation is implemented
 */
export async function publishToSanity(credentials, post) {
  if (!credentials?.api_token) {
    throw new Error('Sanity connection missing api_token. Reconnect Sanity in Settings.');
  }
  throw new Error(
    'Sanity publish is not yet implemented. Document creation and schema mapping need to be added. Use the Sanity Studio to create documents in the meantime.'
  );
}
