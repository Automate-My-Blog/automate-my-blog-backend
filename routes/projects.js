/**
 * Project API routes — Issue #6 (project settings and strategy UX)
 * GET/PUT /api/v1/projects/:id/settings
 * Auth: Bearer JWT required. User must own the project or be an organization member.
 */

import express from 'express';
import db from '../services/database.js';

const router = express.Router();

/** Project ID param name */
const PROJECT_ID_PARAM = 'id';

/**
 * Load project and enforce access (owner or org member).
 * Returns { project } with settings and updated_at, or sends 403/404 and returns null.
 */
async function getProjectForUser(projectId, userId) {
  if (!projectId || !userId) return null;
  const result = await db.query(
    `SELECT p.id, p.settings, p.updated_at
     FROM projects p
     LEFT JOIN organization_members om ON p.organization_id = om.organization_id AND om.user_id = $2
     WHERE p.id = $1 AND (p.user_id = $2 OR om.user_id IS NOT NULL)
     LIMIT 1`,
    [projectId, userId]
  );
  if (!result.rows.length) return null;
  return result.rows[0];
}

/**
 * GET /api/v1/projects/:id/settings
 * Returns persisted settings for the selected project.
 */
router.get(`/:${PROJECT_ID_PARAM}/settings`, async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const projectId = req.params[PROJECT_ID_PARAM];
    const project = await getProjectForUser(projectId, userId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const settings = project.settings && typeof project.settings === 'object' ? project.settings : {};
    const savedAt = project.updated_at ? new Date(project.updated_at).toISOString() : null;
    return res.json({ settings, savedAt });
  } catch (err) {
    console.error('GET project settings error:', err);
    return res.status(500).json({ error: 'Failed to load project settings' });
  }
});

/**
 * PUT /api/v1/projects/:id/settings
 * Persists settings changes. Body: { settings: { audienceSegment?, seoStrategy?, contentTone?, ctaGoals?, defaultTemplate? } }
 */
router.put(`/:${PROJECT_ID_PARAM}/settings`, async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const projectId = req.params[PROJECT_ID_PARAM];
    const project = await getProjectForUser(projectId, userId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const incoming = req.body?.settings;
    const settings =
      incoming && typeof incoming === 'object'
        ? {
            ...(incoming.audienceSegment !== undefined && { audienceSegment: String(incoming.audienceSegment) }),
            ...(incoming.seoStrategy !== undefined && { seoStrategy: String(incoming.seoStrategy) }),
            ...(incoming.contentTone !== undefined && { contentTone: String(incoming.contentTone) }),
            ...(incoming.ctaGoals !== undefined && {
              ctaGoals: Array.isArray(incoming.ctaGoals) ? incoming.ctaGoals.map(String) : []
            }),
            ...(incoming.defaultTemplate !== undefined && { defaultTemplate: String(incoming.defaultTemplate) })
          }
        : {};
    const result = await db.query(
      `UPDATE projects SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING settings, updated_at`,
      [JSON.stringify(settings), projectId]
    );
    const row = result.rows[0];
    const savedSettings = row?.settings && typeof row.settings === 'object' ? row.settings : {};
    const savedAt = row?.updated_at ? new Date(row.updated_at).toISOString() : null;
    return res.json({ settings: savedSettings, savedAt });
  } catch (err) {
    console.error('PUT project settings error:', err);
    return res.status(500).json({ error: 'Failed to save project settings' });
  }
});

export default router;
