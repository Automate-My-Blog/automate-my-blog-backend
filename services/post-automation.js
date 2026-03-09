/**
 * Post automation status and notifications (issue #171).
 * Used by the returning-user dashboard: status line, "View now" for new drafts, "Resume automation".
 */

import db from './database.js';
import { v4 as uuidv4 } from 'uuid';

const NOTIFICATION_TYPE_POST_GENERATED = 'post_generated';

/**
 * Get current automation status and latest notification for a user.
 * @param {string} userId
 * @returns {Promise<{ paused: boolean, nextRunAt: string|null, latestNotification: object|null }>}
 */
export async function getAutomationStatus(userId) {
  const stateResult = await db.query(
    `SELECT paused, next_run_at, updated_at
     FROM post_automation_state
     WHERE user_id = $1`,
    [userId]
  );
  const state = stateResult.rows[0] || null;

  const notifResult = await db.query(
    `SELECT id, type, post_id, viewed_at, dismissed_at, created_at
     FROM post_automation_notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  const row = notifResult.rows[0] || null;

  const latestNotification = row
    ? {
        id: row.id,
        notificationId: row.id,
        type: row.type,
        eventType: row.type,
        postId: row.post_id,
        post_id: row.post_id,
        viewed_at: row.viewed_at,
        dismissed: !!row.dismissed_at,
        dismissed_at: row.dismissed_at,
        created_at: row.created_at
      }
    : null;

  const nextRunIso = state?.next_run_at ? new Date(state.next_run_at).toISOString() : null;
  return {
    paused: state?.paused ?? false,
    automationPaused: state?.paused ?? false,
    status: state?.paused ? 'paused' : 'active',
    nextRunAt: nextRunIso,
    next_run_at: nextRunIso,
    estimatedNextPostAt: nextRunIso,
    latestNotification,
    notifications: latestNotification ? [latestNotification] : [],
    items: latestNotification ? [latestNotification] : []
  };
}

/**
 * Create a generated-post notification for the user (e.g. after content calendar post is saved).
 * @param {string} userId
 * @param {{ type?: string, postId: string }} opts
 * @returns {Promise<{ id: string }>}
 */
export async function createNotification(userId, { type = NOTIFICATION_TYPE_POST_GENERATED, postId }) {
  if (!userId || !postId) {
    throw new Error('userId and postId are required to create a post automation notification');
  }
  const id = uuidv4();
  await db.query(
    `INSERT INTO post_automation_notifications (id, user_id, type, post_id)
     VALUES ($1, $2, $3, $4)`,
    [id, userId, type, postId]
  );
  return { id };
}

/**
 * Mark a notification as viewed (idempotent). Returns the notification row if found and owned by user.
 * @param {string} notificationId
 * @param {string} userId
 * @returns {Promise<{ updated: boolean }>}
 */
export async function markNotificationViewed(notificationId, userId) {
  const result = await db.query(
    `UPDATE post_automation_notifications
     SET viewed_at = COALESCE(viewed_at, NOW())
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [notificationId, userId]
  );
  return { updated: result.rowCount > 0 };
}

/**
 * Mark a notification as dismissed (idempotent).
 * @param {string} notificationId
 * @param {string} userId
 * @returns {Promise<{ updated: boolean }>}
 */
export async function markNotificationDismissed(notificationId, userId) {
  const result = await db.query(
    `UPDATE post_automation_notifications
     SET dismissed_at = COALESCE(dismissed_at, NOW())
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [notificationId, userId]
  );
  return { updated: result.rowCount > 0 };
}

/**
 * Resume automation (clear paused). Idempotent.
 * @param {string} userId
 * @param {{ nextRunAt?: string|Date }} opts optional next run time
 * @returns {Promise<{ resumed: boolean }>}
 */
export async function resumeAutomation(userId, opts = {}) {
  const nextRunAt = opts.nextRunAt != null ? new Date(opts.nextRunAt) : null;
  await db.query(
    `INSERT INTO post_automation_state (user_id, paused, next_run_at, updated_at)
     VALUES ($1, FALSE, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       paused = FALSE,
       next_run_at = COALESCE(EXCLUDED.next_run_at, post_automation_state.next_run_at),
       updated_at = NOW()`,
    [userId, nextRunAt]
  );
  return { resumed: true };
}

/**
 * Pause automation (e.g. when user has unviewed notifications and we pause until they view).
 * @param {string} userId
 */
export async function pauseAutomation(userId) {
  await db.query(
    `INSERT INTO post_automation_state (user_id, paused, updated_at)
     VALUES ($1, TRUE, NOW())
     ON CONFLICT (user_id) DO UPDATE SET paused = TRUE, updated_at = NOW()`,
    [userId]
  );
}

/**
 * Get automation preferences (stub for future use).
 * @param {string} userId
 */
export async function getPreferences(userId) {
  const stateResult = await db.query(
    `SELECT paused, next_run_at, updated_at FROM post_automation_state WHERE user_id = $1`,
    [userId]
  );
  const row = stateResult.rows[0];
  return {
    paused: row?.paused ?? false,
    nextRunAt: row?.next_run_at ? new Date(row.next_run_at).toISOString() : null
  };
}

/**
 * Update automation preferences (stub for PUT /preferences).
 * @param {string} userId
 * @param {object} body
 */
export async function updatePreferences(userId, body) {
  const paused = body.paused;
  if (typeof paused === 'boolean') {
    await db.query(
      `INSERT INTO post_automation_state (user_id, paused, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET paused = $2, updated_at = NOW()`,
      [userId, paused]
    );
  }
  return getPreferences(userId);
}
