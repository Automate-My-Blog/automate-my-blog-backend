/**
 * Post automation API (issue #171).
 * Smart post automation notifications for the returning-user dashboard.
 * All routes require authentication.
 */

import express from 'express';
import * as postAutomation from '../services/post-automation.js';

const router = express.Router();

function requireAuth(req, res, next) {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'Post automation endpoints require a logged-in user.'
    });
  }
  req.automationUserId = userId;
  next();
}

// All automation routes require auth
router.use(requireAuth);

/**
 * GET /api/v1/posts/automation/status
 * Returns current automation status and latest notification.
 * Frontend accepts either flat { ...fields } or { data: { ...fields } }.
 */
router.get('/status', async (req, res) => {
  try {
    const status = await postAutomation.getAutomationStatus(req.automationUserId);
    res.json(status);
  } catch (error) {
    console.error('Post automation status failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get automation status',
      details: error.message
    });
  }
});

/**
 * POST /api/v1/posts/automation/notifications/:id/viewed
 * Mark notification as viewed when user clicks "View now". Idempotent (2xx even if already viewed).
 */
router.post('/notifications/:id/viewed', async (req, res) => {
  try {
    const { id } = req.params;
    const { updated } = await postAutomation.markNotificationViewed(id, req.automationUserId);
    res.status(200).json({
      success: true,
      viewed: true,
      updated
    });
  } catch (error) {
    console.error('Mark notification viewed failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark notification as viewed',
      details: error.message
    });
  }
});

/**
 * POST /api/v1/posts/automation/notifications/:id/dismiss
 * Mark notification as dismissed. Idempotent (2xx even if already dismissed).
 */
router.post('/notifications/:id/dismiss', async (req, res) => {
  try {
    const { id } = req.params;
    const { updated } = await postAutomation.markNotificationDismissed(id, req.automationUserId);
    res.status(200).json({
      success: true,
      dismissed: true,
      updated
    });
  } catch (error) {
    console.error('Mark notification dismissed failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to dismiss notification',
      details: error.message
    });
  }
});

/**
 * POST /api/v1/posts/automation/resume
 * Resume automation after pause.
 */
router.post('/resume', async (req, res) => {
  try {
    const body = req.body || {};
    await postAutomation.resumeAutomation(req.automationUserId, {
      nextRunAt: body.nextRunAt ?? body.next_run_at
    });
    res.json({
      success: true,
      resumed: true,
      message: 'Automation resumed'
    });
  } catch (error) {
    console.error('Resume automation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resume automation',
      details: error.message
    });
  }
});

/**
 * PUT /api/v1/posts/automation/preferences
 * Update automation/notification preferences (optional; stub for future use).
 */
router.put('/preferences', async (req, res) => {
  try {
    const preferences = await postAutomation.updatePreferences(req.automationUserId, req.body || {});
    res.json({
      success: true,
      preferences
    });
  } catch (error) {
    console.error('Update automation preferences failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update preferences',
      details: error.message
    });
  }
});

export default router;
