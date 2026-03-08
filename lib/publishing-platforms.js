/**
 * Shared constants and helpers for third-party publishing platforms.
 * Platform keys must match frontend and docs (wordpress, medium, substack, ghost).
 */
import db from '../services/database.js';

export const PLATFORM_KEYS = new Set(['wordpress', 'medium', 'substack', 'ghost']);

export const PLATFORM_LABELS = {
  wordpress: 'WordPress',
  medium: 'Medium',
  substack: 'Substack',
  ghost: 'Ghost'
};

/**
 * Returns the set of platform keys that are connected for the given user.
 * @param {string} userId
 * @returns {Promise<Set<string>>}
 */
export async function getConnectedPlatforms(userId) {
  const result = await db.query(
    `SELECT platform FROM publishing_platform_connections
     WHERE user_id = $1 AND connected = true`,
    [userId]
  );
  return new Set(result.rows.map((r) => r.platform));
}

/**
 * @param {string} platform
 * @returns {string|null} normalized key or null if invalid
 */
export function normalizePlatformKey(platform) {
  if (typeof platform !== 'string') return null;
  const key = platform.toLowerCase().trim();
  return PLATFORM_KEYS.has(key) ? key : null;
}
