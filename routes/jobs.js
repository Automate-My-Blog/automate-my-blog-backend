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

/** Retry getJobStatus when null (avoids 404 on create→stream race / read-after-write). */
const JOB_STATUS_RETRIES = 4;
const JOB_STATUS_RETRY_DELAY_MS = 80;

async function getJobStatusWithRetry(jobId, ctx) {
  for (let attempt = 0; attempt < JOB_STATUS_RETRIES; attempt++) {
    const status = await jobQueue.getJobStatus(jobId, ctx);
    if (status) return status;
    if (attempt < JOB_STATUS_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, JOB_STATUS_RETRY_DELAY_MS * (attempt + 1)));
    }
  }
  return null;
}

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
 * GET /api/v1/jobs — sanity check that the jobs router is mounted (e.g. on staging).
 */
router.get('/', (req, res) => {
  res.json({ ok: true, message: 'Jobs API', endpoints: ['POST /website-analysis', 'POST /content-generation', 'GET /:jobId/status', 'GET /:jobId/stream', 'GET /:jobId/narrative-stream', 'POST /:jobId/retry', 'POST /:jobId/cancel'] });
});

/** Map job-layer errors to HTTP; preserves existing job API shape { success: false, error, message }. */
function sendJobError(res, e, defaultMessage = 'Internal error') {
  if (e.name === 'UserNotFoundError' || (e.code === '23503' && e.constraint === 'jobs_user_id_fkey')) {
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
  if (e.statusCode === 400) {
    return res.status(400).json({
      success: false,
      error: 'Bad request',
      message: e.message || 'Bad request'
    });
  }
  console.error('Job route error:', e);
  return res.status(500).json({
    success: false,
    error: 'Failed to process request',
    message: e.message || defaultMessage
  });
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
    return sendJobError(res, e, 'Failed to create job');
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
    return sendJobError(res, e, 'Failed to create job');
  }
});

/**
 * GET /api/v1/jobs/:jobId/narrative-stream?token=JWT (or sessionId)
 * SSE stream for narrative UX (Issue #157): analysis-status-update, transition, analysis-chunk, narrative-complete, complete.
 * Used for website_analysis jobs. Replays stored narrative on reconnect.
 * Returns 404 if job not found, not website_analysis, or narrative stream unavailable.
 */
router.get('/:jobId/narrative-stream', requireUserOrSession, async (req, res) => {
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

    const row = await jobQueue.getJobRow(jobId);
    if (row?.type !== 'website_analysis') {
      return res.status(404).json({
        success: false,
        error: 'Not found',
        message: 'Narrative stream is only available for website_analysis jobs'
      });
    }

    if (!jobQueue.getConnection?.()) {
      return res.status(503).json({
        success: false,
        error: 'Service unavailable',
        message: 'Redis is not configured (narrative stream requires Redis)'
      });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(': ok\n\n');
    if (typeof res.flush === 'function') res.flush();
    if (res.socket && typeof res.socket.setNoDelay === 'function') res.socket.setNoDelay(true);

    writeSSE(res, 'connected', { jobId });

    // Replay stored narrative for reconnects
    const stored = await jobQueue.getNarrativeStream(jobId);
    for (const item of stored) {
      if (res.writableEnded) break;
      writeSSE(res, item.type, { content: item.content, ...(item.progress != null && { progress: item.progress }) });
    }

    // Use shared Redis subscriber (stream-manager) instead of one connection per client
    await streamManager.whenNarrativePatternReady();
    streamManager.registerNarrativeStream(jobId, res);

    const checkInterval = setInterval(async () => {
      if (res.writableEnded) return;
      const s = await jobQueue.getJobStatus(jobId, ctx);
      if (s?.status === 'succeeded' || s?.status === 'failed') {
        clearInterval(checkInterval);
        if (!res.writableEnded) {
          writeSSE(res, 'complete', {});
          streamManager.unregisterNarrativeStream(jobId, res);
          res.end();
        }
      }
    }, 2000);

    const onClose = () => {
      clearInterval(checkInterval);
      streamManager.unregisterNarrativeStream(jobId, res);
      if (!res.writableEnded) res.end();
    };
    req.on('close', onClose);
    res.on('close', onClose);
  } catch (e) {
    if (!res.headersSent) sendJobError(res, e, 'Failed to open narrative stream');
  }
});

/**
 * Redirect trailing slash so GET .../stream/ hits the stream handler (Vercel/proxies sometimes add slash).
 */
router.get('/:jobId/stream/', (req, res) => {
  const target = req.originalUrl.replace(/\/stream\/+/, '/stream');
  res.redirect(301, target);
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
    // Retry when null to avoid 404 on create→stream race (read-after-write / replica lag)
    const status = await getJobStatusWithRetry(jobId, ctx);
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
    // Send a leading comment so proxies/clients see data immediately (reduces intermittent connection issues)
    if (!res.writableEnded) {
      res.write(': ok\n\n');
      if (typeof res.flush === 'function') res.flush();
    }
    if (res.socket && typeof res.socket.setNoDelay === 'function') res.socket.setNoDelay(true);

    const connectionId = streamManager.createConnection(res, {
      userId: ctx.userId ?? undefined,
      sessionId: ctx.sessionId ?? undefined
    }, { keepalive: true, maxAgeMs: JOB_STREAM_MAX_AGE_MS });

    streamManager.subscribeToJob(jobId, connectionId);
    // Wait for Redis job-events subscription so we don't miss early worker events (fixes intermittent missed events)
    await streamManager.whenJobPatternReady();

    if (res.writableEnded) return;
    writeSSE(res, 'connected', {
      connectionId,
      jobId,
      maxAgeSeconds: Math.floor(JOB_STREAM_MAX_AGE_MS / 1000),
      hint: 'If stream closes before job completes, poll GET /jobs/:jobId/status'
    });

    // Catch-up: send current job state so frontend is never stuck (handles missed events during subscription or fast job completion)
    if (!res.writableEnded) {
      const current = await jobQueue.getJobStatus(jobId, ctx);
      if (current) {
        if (current.status === 'succeeded') {
          writeSSE(res, 'complete', { result: current.result ?? null });
          streamManager.unsubscribeFromJob(jobId, connectionId);
          res.end();
          return;
        }
        if (current.status === 'failed') {
          writeSSE(res, 'failed', { error: current.error ?? 'Job failed', errorCode: current.errorCode ?? null });
          streamManager.unsubscribeFromJob(jobId, connectionId);
          res.end();
          return;
        }
        writeSSE(res, 'progress-update', {
          progress: current.progress ?? 0,
          currentStep: current.currentStep ?? null,
          estimatedTimeRemaining: current.estimatedTimeRemaining ?? null
        });
      }
    }

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

    const cleanup = () => {
      clearTimeout(warningTimer);
      streamManager.unsubscribeFromJob(jobId, connectionId);
    };
    res.on('close', cleanup);
    req.on('close', cleanup);
  } catch (e) {
    if (!res.headersSent) sendJobError(res, e, 'Failed to open stream');
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
    return sendJobError(res, e, 'Failed to get status');
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
    return sendJobError(res, e, 'Failed to retry');
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
    return sendJobError(res, e, 'Failed to cancel');
  }
});

export default router;
