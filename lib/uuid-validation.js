/**
 * UUID validation for route params that are passed to Postgres as UUID type.
 * Prevents "invalid input syntax for type uuid" 500s when the frontend sends
 * placeholder ids (e.g. "analysis-fallback-0") before real records exist.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isUUID(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}
