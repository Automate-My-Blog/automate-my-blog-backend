/**
 * Publish a post to a Next.js site by committing a new file to the repo.
 * Requires repository_url, access_token, branch, content_path (stored in connection).
 * Uses Git provider API to create/update a file in the content path.
 * @see NEXTJS_PUBLISHING_BACKEND_HANDOFF in frontend docs/publishing
 */

/**
 * Publish a post to Next.js (create file in repo). Not yet implemented.
 * @param {object} credentials - { repository_url, access_token, branch, content_path }
 * @param {object} post - { title, content }
 * @returns {Promise<{ url: string, id: string }>}
 * @throws {Error} until Git commit flow is implemented
 */
export async function publishToNextjs(credentials, post) {
  if (!credentials?.repository_url || !credentials?.access_token) {
    throw new Error('Next.js connection missing repository_url or access_token. Reconnect Next.js in Settings.');
  }
  throw new Error(
    'Next.js publish is not yet implemented. Git commit flow (create/update file in content path) needs to be added. Push to your repo manually in the meantime.'
  );
}
