/**
 * Project API routes — Issue #6 (project settings and strategy UX)
 * GET/PUT /api/v1/projects/:id/settings
 * Auth: Bearer JWT required. User must own the project or be an organization member.
 */

import express from 'express';
import { NotFoundError, UnauthorizedError } from '../lib/errors.js';
import {
  getProjectSettingsForUser,
  saveProjectSettingsForUser
} from '../services/project-settings.js';

const router = express.Router();

/** Project ID param name */
const PROJECT_ID_PARAM = 'id';

/** UUID v4 regex (RFC 4122) */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidProjectId(id) {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

function sendProjectSettingsError(res, err, operation) {
  if (err instanceof UnauthorizedError) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (err instanceof NotFoundError) {
    return res.status(404).json({ error: 'Project not found' });
  }
  console.error(`${operation} project settings error:`, err);
  return res.status(500).json({
    error: operation === 'GET' ? 'Failed to load project settings' : 'Failed to save project settings'
  });
}

/**
 * GET /api/v1/projects/:id/settings
 * Returns persisted settings for the selected project.
 */
router.get(`/:${PROJECT_ID_PARAM}/settings`, async (req, res) => {
  try {
    const projectId = req.params[PROJECT_ID_PARAM];
    if (!isValidProjectId(projectId)) {
      return res.status(400).json({
        error: 'Invalid project ID',
        message: 'Project ID must be a valid UUID. Use the project id from your project list, not a placeholder like "default".'
      });
    }
    const userId = req.user?.userId;
    const response = await getProjectSettingsForUser({ projectId, userId });
    return res.json(response);
  } catch (err) {
    return sendProjectSettingsError(res, err, 'GET');
  }
});

/**
 * PUT /api/v1/projects/:id/settings
 * Persists settings changes. Body: { settings: { audienceSegment?, seoStrategy?, contentTone?, ctaGoals?, defaultTemplate? } }
 */
router.put(`/:${PROJECT_ID_PARAM}/settings`, async (req, res) => {
  try {
    const projectId = req.params[PROJECT_ID_PARAM];
    if (!isValidProjectId(projectId)) {
      return res.status(400).json({
        error: 'Invalid project ID',
        message: 'Project ID must be a valid UUID. Use the project id from your project list, not a placeholder like "default".'
      });
    }
    const userId = req.user?.userId;
    const response = await saveProjectSettingsForUser({
      projectId,
      userId,
      incomingSettings: req.body?.settings
    });
    return res.json(response);
  } catch (err) {
    return sendProjectSettingsError(res, err, 'PUT');
  }
});

export default router;
