import {
  getAccessibleProjectSettings,
  updateProjectSettings
} from './project-settings-repository.js';
import { NotFoundError, UnauthorizedError } from '../lib/errors.js';

/**
 * Convert DB row to API contract.
 *
 * @param {{ settings?: any, updated_at?: Date|string|null }|null} row
 * @returns {{ settings: object, savedAt: string|null }}
 */
export function toProjectSettingsResponse(row) {
  const settings = row?.settings && typeof row.settings === 'object' ? row.settings : {};
  const savedAt = row?.updated_at ? new Date(row.updated_at).toISOString() : null;
  return { settings, savedAt };
}

/**
 * Keep existing behavior:
 * - non-object or missing settings => empty patch {}
 * - only known keys are persisted
 * - values are stringified
 * - ctaGoals becomes [] when provided but not an array
 *
 * @param {unknown} incoming
 * @returns {Record<string, any>}
 */
export function normalizeProjectSettingsPatch(incoming) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return {};
  }

  return {
    ...(incoming.audienceSegment !== undefined && { audienceSegment: String(incoming.audienceSegment) }),
    ...(incoming.seoStrategy !== undefined && { seoStrategy: String(incoming.seoStrategy) }),
    ...(incoming.contentTone !== undefined && { contentTone: String(incoming.contentTone) }),
    ...(incoming.ctaGoals !== undefined && {
      ctaGoals: Array.isArray(incoming.ctaGoals) ? incoming.ctaGoals.map(String) : []
    }),
    ...(incoming.defaultTemplate !== undefined && { defaultTemplate: String(incoming.defaultTemplate) })
  };
}

function requireAuthenticatedUser(userId) {
  if (!userId) {
    throw new UnauthorizedError('Authentication required');
  }
}

/**
 * @param {{ projectId: string, userId: string }} params
 * @returns {Promise<{ settings: object, savedAt: string|null }>}
 */
export async function getProjectSettingsForUser({ projectId, userId }) {
  requireAuthenticatedUser(userId);

  const row = await getAccessibleProjectSettings(projectId, userId);
  if (!row) {
    throw new NotFoundError('Project not found', 'project');
  }

  return toProjectSettingsResponse(row);
}

/**
 * @param {{ projectId: string, userId: string, incomingSettings: unknown }} params
 * @returns {Promise<{ settings: object, savedAt: string|null }>}
 */
export async function saveProjectSettingsForUser({ projectId, userId, incomingSettings }) {
  requireAuthenticatedUser(userId);

  const project = await getAccessibleProjectSettings(projectId, userId);
  if (!project) {
    throw new NotFoundError('Project not found', 'project');
  }

  const patch = normalizeProjectSettingsPatch(incomingSettings);
  const row = await updateProjectSettings(projectId, patch);
  return toProjectSettingsResponse(row);
}
