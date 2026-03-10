import db from './database.js';

/**
 * Fetch project settings for a project the user can access.
 * Access is granted when user is owner or org member.
 *
 * @param {string} projectId
 * @param {string} userId
 * @returns {Promise<{ id: string, settings: object|null, updated_at: Date|string|null }|null>}
 */
export async function getAccessibleProjectSettings(projectId, userId) {
  const result = await db.query(
    `SELECT p.id, p.settings, p.updated_at
     FROM projects p
     LEFT JOIN organization_members om ON p.organization_id = om.organization_id AND om.user_id = $2
     WHERE p.id = $1 AND (p.user_id = $2 OR om.user_id IS NOT NULL)
     LIMIT 1`,
    [projectId, userId]
  );
  return result.rows[0] || null;
}

/**
 * Merge incoming settings patch into persisted settings.
 *
 * @param {string} projectId
 * @param {object} settingsPatch
 * @returns {Promise<{ settings: object|null, updated_at: Date|string|null }|null>}
 */
export async function updateProjectSettings(projectId, settingsPatch) {
  const result = await db.query(
    `UPDATE projects
     SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
     WHERE id = $2
     RETURNING settings, updated_at`,
    [JSON.stringify(settingsPatch), projectId]
  );
  return result.rows[0] || null;
}
