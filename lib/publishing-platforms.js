/**
 * Shared constants and helpers for third-party publishing platforms.
 * Platform keys must match frontend and integration handoff (16 platforms).
 */
import db from '../services/database.js';

/** All 16 platform keys used by the frontend (Publish modal, Settings, post publication status). */
export const PLATFORM_KEYS = new Set([
  'wordpress', 'medium', 'substack', 'ghost', 'webflow', 'squarespace', 'wix', 'shopify',
  'hubspot', 'contentful', 'sanity', 'drupal', 'hugo', 'jekyll', 'nextjs', 'astro'
]);

export const PLATFORM_LABELS = {
  wordpress: 'WordPress',
  medium: 'Medium',
  substack: 'Substack',
  ghost: 'Ghost',
  webflow: 'Webflow',
  squarespace: 'Squarespace',
  wix: 'Wix',
  shopify: 'Shopify',
  hubspot: 'HubSpot',
  contentful: 'Contentful',
  sanity: 'Sanity',
  drupal: 'Drupal',
  hugo: 'Hugo',
  jekyll: 'Jekyll',
  nextjs: 'Next.js',
  astro: 'Astro'
};

/** Platforms that use OAuth only (frontend sends { platform } and expects authorization_url). */
export const OAUTH_ONLY_PLATFORMS = new Set([
  'medium', 'webflow', 'squarespace', 'wix', 'shopify', 'hubspot', 'drupal', 'hugo', 'astro'
]);

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
