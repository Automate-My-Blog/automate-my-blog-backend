/**
 * Job queue API: create jobs, get status, retry, cancel, stream (Phase 5).
 * Base path: /api/v1/jobs
 * All endpoints require auth or session; jobs are scoped by user or session.
 */

import express from 'express';
import * as jobQueue from '../services/job-queue.js';
import streamManager from '../services/stream-manager.js';
import { writeSSE } from '../utils/streaming-helpers.js';
import DatabaseAuthService from '../services/auth-database.js';

const router = express.Router();
const authService = new DatabaseAuthService();

/** Job stream connection timeout. Vercel serverless limit is 300s; use 250s to close gracefully before timeout. */
const JOB_STREAM_MAX_AGE_MS = 250 * 1000;

function getJobContext(req) {
  let userId = req.user?.userId ?? null;
  const sessionId = req.headers['x-session-id'] || req.body?.sessionId || req.query?.sessionId || null;
  if (!userId && req.query?.token) {
    try {
      const decoded = authService.verifyToken(String(req.query.token).trim());
      if (decoded?.userId) userId = decoded.userId;
    } catch {
      // leave userId null
    }
  }
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
    if (e.name === 'UserNotFoundError') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'User not found; token may be for a deleted or invalid user'
      });
    }
    if (e.code === '23503' && e.constraint === 'jobs_user_id_fkey') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'User not found; token may be for a deleted or invalid user'
      });
    }
    if (e.message?.includes('REDIS_URL')) {
      return res.status(503).json({
        success: false,
        error: 'Service unavailable',
        message: e.message || 'Job queue is not configured (REDIS_URL required)'
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
    if (e.name === 'UserNotFoundError') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'User not found; token may be for a deleted or invalid user'
      });
    }
    if (e.code === '23503' && e.constraint === 'jobs_user_id_fkey') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'User not found; token may be for a deleted or invalid user'
      });
    }
    if (e.message?.includes('REDIS_URL')) {
      return res.status(503).json({
        success: false,
        error: 'Service unavailable',
        message: e.message || 'Job queue is not configured (REDIS_URL required)'
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
 * GET /api/v1/jobs/:jobId/stream?token=JWT (or Authorization / x-session-id)
 * SSE stream for real-time job progress. EventSource-compatible (?token=).
 * Events: connected, progress-update, step-change, complete, failed.
 * Connection closes on complete/fail or after 10 min.
 */
router.get('/:jobId/stream', requireUserOrSession, async (req, res) => {
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

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    // Send each SSE write immediately instead of buffering (helps progress updates stream in real time)
    if (res.socket && typeof res.socket.setNoDelay === 'function') res.socket.setNoDelay(true);

    const connectionId = streamManager.createConnection(res, {
      userId: ctx.userId ?? undefined,
      sessionId: ctx.sessionId ?? undefined
    }, { keepalive: true, maxAgeMs: JOB_STREAM_MAX_AGE_MS });

    streamManager.subscribeToJob(jobId, connectionId);
    writeSSE(res, 'connected', {
      connectionId,
      jobId,
      maxAgeSeconds: Math.floor(JOB_STREAM_MAX_AGE_MS / 1000),
      hint: 'If stream closes before job completes, poll GET /jobs/:jobId/status'
    });

    // Send stream-timeout event 10s before closing so frontend can fall back to polling
    const timeoutWarningMs = JOB_STREAM_MAX_AGE_MS - 10 * 1000;
    const warningTimer = setTimeout(() => {
      if (!res.writableEnded) {
        writeSSE(res, 'stream-timeout', {
          jobId,
          message: 'Stream closing soon due to serverless limit; poll GET /jobs/:jobId/status for updates'
        });
      }
    }, timeoutWarningMs);
    res.on('close', () => clearTimeout(warningTimer));
  } catch (e) {
    console.error('GET /jobs/:jobId/stream error:', e);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to open stream',
        message: e.message || 'Internal error'
      });
    }
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
        message: e.message || 'Job queue is not configured (REDIS_URL required)'
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
