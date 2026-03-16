/**
 * Publish a post to Contentful (create/update entry).
 * Requires space_id, environment_id, management_token (stored in connection).
 * Content type for blog posts must be configured (e.g. via env or connection) for full implementation.
 * @see https://www.contentful.com/developers/docs/references/content-management-api/
 */

/**
 * Publish a post to Contentful. Not yet implemented.
 * @param {object} credentials - { space_id, environment_id, management_token }
 * @param {object} post - { title, content }
 * @returns {Promise<{ url: string, id: string }>}
 * @throws {Error} until Contentful entry creation is implemented
 */
export async function publishToContentful(credentials, post) {
  if (!credentials?.management_token) {
    throw new Error('Contentful connection missing management_token. Reconnect Contentful in Settings.');
  }
  throw new Error(
    'Contentful publish is not yet implemented. Create-entry flow and content type mapping need to be added. Use the Contentful dashboard to create entries in the meantime.'
  );
}
