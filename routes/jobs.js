/**
 * Job queue API: create jobs, get status, retry, cancel.
 * Base path: /api/v1/jobs
 * All endpoints require auth or session; jobs are scoped by user or session.
 */

import express from 'express';
import * as jobQueue from '../services/job-queue.js';

const router = express.Router();

function getJobContext(req) {
  const userId = req.user?.userId ?? null;
  const sessionId = req.headers['x-session-id'] || req.body?.sessionId || req.query?.sessionId || null;
  return { userId, sessionId };
}

function requireUserOrSession(req, res, next) {
  const { userId, sessionId } = getJobContext(req);
  if (!userId && !sessionId) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication or session ID (x-session-id) is required'
    });
  }
  next();
}

/**
 * POST /api/v1/jobs/website-analysis
 * Body: { url: string, sessionId?: string }
 * Returns: 201 { jobId: string }
 */
router.post('/website-analysis', requireUserOrSession, async (req, res) => {
  try {
    const { url, sessionId } = req.body;
    const { userId, sessionId: headerSession } = getJobContext(req);
    const sid = sessionId ?? headerSession;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'url is required',
        message: 'Provide a valid website URL'
      });
    }
    if (!userId && !sid) {
      return res.status(401).json({
        success: false,
        error: 'Session or auth required',
        message: 'Provide x-session-id header or authenticate'
      });
    }

    const { jobId } = await jobQueue.createJob(
      'website_analysis',
      { url },
      { userId: userId || null, sessionId: sid || null, tenantId: null }
    );
    return res.status(201).json({ jobId });
  } catch (e) {
    if (e.message?.includes('REDIS_URL')) {
      return res.status(503).json({
        success: false,
        error: 'Service unavailable',
        message: 'Job queue is not configured (REDIS_URL required)'
      });
    }
    console.error('POST /jobs/website-analysis error:', e);
    return res.status(500).json({
      success: false,
      error: 'Failed to create job',
      message: e.message || 'Internal error'
    });
  }
});

/**
 * POST /api/v1/jobs/content-generation
 * Body: same as POST /api/v1/enhanced-blog-generation/generate (topic, businessInfo, organizationId, etc.)
 * Returns: 201 { jobId: string }
 */
router.post('/content-generation', requireUserOrSession, async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'Content generation requires an authenticated user'
      });
    }

    const { topic, businessInfo, organizationId, additionalInstructions, options } = req.body;
    if (!topic || !businessInfo || !organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'topic, businessInfo, and organizationId are required'
      });
    }

    const input = {
      topic,
      businessInfo,
      organizationId,
      additionalInstructions: additionalInstructions ?? null,
      options: options ?? {}
    };

    const { jobId } = await jobQueue.createJob('content_generation', input, {
      userId,
      sessionId: null,
      tenantId: organizationId
    });
    return res.status(201).json({ jobId });
  } catch (e) {
    if (e.message?.includes('REDIS_URL')) {
      return res.status(503).json({
        success: false,
        error: 'Service unavailable',
        message: 'Job queue is not configured (REDIS_URL required)'
      });
    }
    console.error('POST /jobs/content-generation error:', e);
    return res.status(500).json({
      success: false,
      error: 'Failed to create job',
      message: e.message || 'Internal error'
    });
  }
});

/**
 * GET /api/v1/jobs/:jobId/status
 * Returns: 200 { jobId, status, progress, currentStep, estimatedTimeRemaining, error, result, createdAt, updatedAt }
 */
router.get('/:jobId/status', requireUserOrSession, async (req, res) => {
  try {
    const { jobId } = req.params;
    const ctx = getJobContext(req);
    const status = await jobQueue.getJobStatus(jobId, ctx);
    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Not found',
        message: 'Job not found or access denied'
      });
    }
    return res.json(status);
  } catch (e) {
    console.error('GET /jobs/:jobId/status error:', e);
    return res.status(500).json({
      success: false,
      error: 'Failed to get status',
      message: e.message || 'Internal error'
    });
  }
});

/**
 * POST /api/v1/jobs/:jobId/retry
 * Returns: 200 { jobId: string }
 */
router.post('/:jobId/retry', requireUserOrSession, async (req, res) => {
  try {
    const { jobId } = req.params;
    const ctx = getJobContext(req);
    const out = await jobQueue.retryJob(jobId, ctx);
    if (!out) {
      return res.status(404).json({
        success: false,
        error: 'Not found',
        message: 'Job not found or access denied'
      });
    }
    return res.json(out);
  } catch (e) {
    if (e.statusCode === 400) {
      return res.status(400).json({
        success: false,
        error: 'Bad request',
        message: e.message || 'Job is not in failed state'
      });
    }
    if (e.message?.includes('REDIS_URL')) {
      return res.status(503).json({
        success: false,
        error: 'Service unavailable',
        message: 'Job queue is not configured (REDIS_URL required)'
      });
    }
    console.error('POST /jobs/:jobId/retry error:', e);
    return res.status(500).json({
      success: false,
      error: 'Failed to retry',
      message: e.message || 'Internal error'
    });
  }
});

/**
 * POST /api/v1/jobs/:jobId/cancel
 * Returns: 200 { cancelled: true }
 */
router.post('/:jobId/cancel', requireUserOrSession, async (req, res) => {
  try {
    const { jobId } = req.params;
    const ctx = getJobContext(req);
    const out = await jobQueue.cancelJob(jobId, ctx);
    if (!out) {
      return res.status(404).json({
        success: false,
        error: 'Not found',
        message: 'Job not found or access denied'
      });
    }
    return res.json(out);
  } catch (e) {
    if (e.statusCode === 400) {
      return res.status(400).json({
        success: false,
        error: 'Bad request',
        message: e.message || 'Job is not cancellable'
      });
    }
    console.error('POST /jobs/:jobId/cancel error:', e);
    return res.status(500).json({
      success: false,
      error: 'Failed to cancel',
      message: e.message || 'Internal error'
    });
  }
});

export default router;
