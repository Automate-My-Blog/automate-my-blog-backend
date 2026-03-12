/**
 * Publish a post to a Jekyll site by committing a new file to the repo.
 * Requires repository_url, access_token, branch, posts_path (stored in connection).
 * Uses Git provider API (e.g. GitHub) to create/update a file in _posts.
 * @see JEKYLL_INTEGRATION_BACKEND_HANDOFF in frontend docs/publishing
 */

/**
 * Publish a post to Jekyll (create file in repo). Not yet implemented.
 * @param {object} credentials - { repository_url, access_token, branch, posts_path }
 * @param {object} post - { title, content }
 * @returns {Promise<{ url: string, id: string }>}
 * @throws {Error} until Git commit flow is implemented
 */
export async function publishToJekyll(credentials, post) {
  if (!credentials?.repository_url || !credentials?.access_token) {
    throw new Error('Jekyll connection missing repository_url or access_token. Reconnect Jekyll in Settings.');
  }
  throw new Error(
    'Jekyll publish is not yet implemented. Git commit flow (create/update file in posts path) needs to be added. Push to your repo manually in the meantime.'
  );
}
