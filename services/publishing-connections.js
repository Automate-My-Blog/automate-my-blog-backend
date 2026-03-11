/**
 * Resolve decrypted credentials for a user's publishing platform connection.
 * Used by publish flow only; never expose raw credentials to the frontend.
 */
import db from './database.js';
import oauthManager from './oauth-manager.js';

/**
 * Get decrypted credentials for a connected platform.
 * @param {string} userId
 * @param {string} platform - wordpress | medium | substack | ghost
 * @returns {Promise<object|null>} Decrypted payload (e.g. { site_url, username, application_password } for WordPress) or null
 */
export async function getConnectionCredentials(userId, platform) {
  const result = await db.query(
    `SELECT credentials_encrypted FROM publishing_platform_connections
     WHERE user_id = $1 AND platform = $2 AND connected = true`,
    [userId, platform]
  );
  if (result.rows.length === 0) return null;
  try {
    const raw = oauthManager.decryptToken(result.rows[0].credentials_encrypted);
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to decrypt publishing connection:', e.message);
    return null;
  }
}
