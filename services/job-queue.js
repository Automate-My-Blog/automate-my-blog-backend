/**
 * Job queue service (BullMQ + Redis)
 * Create jobs, get status, retry, cancel. Worker updates DB directly.
 *
 * Allowed state transitions:
 * - Retry: only when status === 'failed' → reset to queued and re-enqueue.
 * - Cancel: only when status in ('queued', 'running') → set cancelled_at; worker marks failed.
 */

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import db from './database.js';
import { InvariantViolation, ServiceUnavailableError } from '../lib/errors.js';

const QUEUE_NAME = 'amb-jobs';
const JOB_TYPES = ['website_analysis', 'content_generation', 'analyze_voice_sample'];

/** Only failed jobs can be retried. */
export const RETRIABLE_STATUS = 'failed';
/** Only queued or running jobs can be cancelled (worker checks cancelled_at). */
export const CANCELLABLE_STATUSES = Object.freeze(['queued', 'running']);

let _connection = null;
let _queue = null;

/** REDIS_URL must be a TCP URL (redis:// or rediss:// host:port). Reject paths, empty host, or redis-cli fragments (e.g. " -u redis://..."). */
function isRedisUrlValid(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('/')) return false;
  if (/\s(-u|--tls)\s/i.test(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    return (u.protocol === 'redis:' || u.protocol === 'rediss:') && u.hostname;
  } catch {
    return false;
  }
}

function normalizeRedisUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  const urlMatch = trimmed.match(/(redis[s]?:\/\/[^\s]+)/i);
  return urlMatch ? urlMatch[1] : trimmed;
}

function getConnection() {
  const raw = process.env.REDIS_URL;
  const url = normalizeRedisUrl(raw);
  if (!url) return null;
  if (!isRedisUrlValid(url)) return null;
  if (!_connection) {
    const opts = { maxRetriesPerRequest: null };
    if (process.env.REDIS_TOKEN) opts.password = process.env.REDIS_TOKEN;
    _connection = new IORedis(url, opts);
    _connection.on('error', (err) => {
      console.error('[job-queue] Redis connection error:', err?.message || err);
    });
  }
  return _connection;
}

function getQueue() {
  const conn = getConnection();
  if (!conn) return null;
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, {
      connection: conn,
      defaultJobOptions: { removeOnComplete: { count: 1000 }, removeOnFail: false }
    });
  }
  return _queue;
}

function ensureRedis() {
  const raw = process.env.REDIS_URL;
  const url = normalizeRedisUrl(raw);
  if (!url) {
    throw new ServiceUnavailableError('REDIS_URL is required for job queue');
  }
  if (!isRedisUrlValid(url)) {
    throw new ServiceUnavailableError(
      'REDIS_URL must be a full TCP URL (e.g. rediss://default:token@host.upstash.io:6379), not a path or empty host'
    );
  }
  if (!getConnection()) {
    throw new ServiceUnavailableError('REDIS_URL is required for job queue');
  }
}

/**
 * Ownership: caller has access if they match by user_id or by session_id. 404 if no match.
 * Compare as strings so query/header sessionId and DB session_id (e.g. UUID) match reliably.
 */
async function getJobForAccess(jobId, { userId, sessionId }) {
  const q = await db.query(`SELECT * FROM jobs WHERE id = $1`, [jobId]);
  const row = q.rows[0];
  if (!row) return null;
  const ownByUser = userId != null && String(row.user_id) === String(userId);
  const ownBySession = sessionId != null && sessionId !== '' && String(row.session_id) === String(sessionId);
  const hasAccess = ownByUser || ownBySession;
  if (!hasAccess) return null;
  return row;
}

function rowToStatus(row) {
  return {
    jobId: row.id,
    status: row.status,
    progress: row.progress ?? 0,
    currentStep: row.current_step ?? null,
    estimatedTimeRemaining: row.estimated_seconds_remaining ?? null,
    error: row.error ?? null,
    errorCode: row.error_code ?? null,
    result: row.result ?? null,
    createdAt: row.created_at != null ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at != null ? new Date(row.updated_at).toISOString() : null
  };
}

/** Thrown when context.userId is set but that user does not exist in users table, and no sessionId to fall back to. */
export class UserNotFoundError extends Error {
  constructor(userId) {
    super(`User not found: ${userId}`);
    this.name = 'UserNotFoundError';
    this.userId = userId;
  }
}

/**
 * Create a job, enqueue it, return jobId.
 * Supports anonymous jobs (sessionId only) and user jobs. If userId is set but that user
 * does not exist in DB (e.g. JWT for deleted user), we fall back to session-only when
 * sessionId is present so anonymous flow still works; otherwise throw UserNotFoundError.
 *
 * @param {string} type - 'website_analysis' | 'content_generation' | 'analyze_voice_sample'
 * @param {object} input - Job payload (stored for retry)
 * @param {object} context - { userId?, sessionId?, tenantId? }
 * @returns {Promise<{ jobId: string }>}
 * @throws {UserNotFoundError} when context.userId is set, user does not exist, and no sessionId
 */
export async function createJob(type, input, context = {}) {
  if (!JOB_TYPES.includes(type)) throw new Error(`Invalid job type: ${type}`);
  let { userId, sessionId, tenantId } = context;
  if (!userId && !sessionId) throw new Error('Either userId or sessionId is required');

  if (userId) {
    const u = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!u.rows.length) {
      if (sessionId) {
        userId = null;
      } else {
        throw new UserNotFoundError(userId);
      }
    }
  }

  ensureRedis();
  const jobId = uuidv4();

  await db.query(
    `INSERT INTO jobs (id, tenant_id, user_id, session_id, type, status, input, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'queued', $6, NOW())`,
    [jobId, tenantId || null, userId || null, sessionId || null, type, JSON.stringify(input)]
  );

  const queue = getQueue();
  await queue.add(type, { jobId }, { jobId });

  return { jobId };
}

/**
 * Create a voice sample analysis job. Call after inserting a voice_samples row.
 * @param {string} voiceSampleId - UUID of voice_samples.id
 * @param {string} organizationId - UUID of organization (tenant_id)
 * @param {string} userId - UUID of user (required for voice jobs)
 * @returns {Promise<{ jobId: string }>}
 */
export async function createVoiceAnalysisJob(voiceSampleId, organizationId, userId) {
  if (!userId) throw new Error('userId is required for voice analysis job');
  return createJob(
    'analyze_voice_sample',
    { voiceSampleId, organizationId },
    { userId, tenantId: organizationId }
  );
}

/**
 * Get job status. 404 if not found or not owned.
 * @returns {Promise<object|null>} Status object or null
 */
export async function getJobStatus(jobId, context) {
  const row = await getJobForAccess(jobId, context);
  if (!row) return null;
  return rowToStatus(row);
}

/**
 * Retry a failed job. Re-enqueues same job id.
 * @returns {Promise<{ jobId: string }>} Same jobId
 * @throws 400 if not failed, 404 if not found
 */
export async function retryJob(jobId, context) {
  ensureRedis();
  const row = await getJobForAccess(jobId, context);
  if (!row) return null;
  if (row.status !== RETRIABLE_STATUS) {
    throw new InvariantViolation('Job is not in failed state', 400);
  }

  await db.query(
    `UPDATE jobs SET status = 'queued', progress = 0, current_step = NULL, error = NULL, result = NULL,
      cancelled_at = NULL, started_at = NULL, finished_at = NULL, updated_at = NOW()
     WHERE id = $1`,
    [jobId]
  );

  const queue = getQueue();
  await queue.add(row.type, { jobId }, { jobId });

  return { jobId };
}

/**
 * Request cancellation. Sets cancelled_at. Worker checks and marks failed with "Cancelled".
 * @returns {Promise<{ cancelled: true }|null>} null if not found
 */
export async function cancelJob(jobId, context) {
  const row = await getJobForAccess(jobId, context);
  if (!row) return null;
  if (!CANCELLABLE_STATUSES.includes(row.status)) {
    throw new InvariantViolation('Job is not cancellable', 400);
  }

  await db.query(
    `UPDATE jobs SET cancelled_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [jobId]
  );
  return { cancelled: true };
}

/**
 * Update job progress (used by worker).
 */
export async function updateJobProgress(jobId, updates) {
  const {
    status,
    progress,
    current_step,
    estimated_seconds_remaining,
    result,
    error,
    error_code,
    started_at,
    finished_at
  } = updates;

  const sets = ['updated_at = NOW()'];
  const values = [];
  let i = 1;

  if (status != null) { sets.push(`status = $${i++}`); values.push(status); }
  if (progress != null) { sets.push(`progress = $${i++}`); values.push(progress); }
  if (current_step !== undefined) { sets.push(`current_step = $${i++}`); values.push(current_step); }
  if (estimated_seconds_remaining !== undefined) { sets.push(`estimated_seconds_remaining = $${i++}`); values.push(estimated_seconds_remaining); }
  if (result !== undefined) { sets.push(`result = $${i++}`); values.push(result); }
  if (error !== undefined) { sets.push(`error = $${i++}`); values.push(error); }
  if (error_code !== undefined) { sets.push(`error_code = $${i++}`); values.push(error_code); }
  if (started_at !== undefined) { sets.push(`started_at = $${i++}`); values.push(started_at); }
  if (finished_at !== undefined) { sets.push(`finished_at = $${i++}`); values.push(finished_at); }

  values.push(jobId);
  await db.query(
    `UPDATE jobs SET ${sets.join(', ')} WHERE id = $${i}`,
    values
  );
}

/**
 * Check if job was cancelled (worker uses this).
 */
export async function isJobCancelled(jobId) {
  const r = await db.query(`SELECT cancelled_at FROM jobs WHERE id = $1`, [jobId]);
  return r.rows[0]?.cancelled_at != null;
}

/**
 * Get job row by id (worker uses this).
 */
export async function getJobRow(jobId) {
  const r = await db.query(`SELECT * FROM jobs WHERE id = $1`, [jobId]);
  return r.rows[0] || null;
}

/**
 * Append a narrative event to jobs.narrative_stream for replay on reconnect.
 * Used by job worker when streaming narrative (analysis-status-update, analysis-chunk, etc.).
 * @param {string} jobId
 * @param {{ type: string, content: string, progress?: number, timestamp?: number }} event
 */
export async function appendNarrativeStream(jobId, event) {
  const item = {
    type: event.type,
    content: event.content ?? '',
    ...(event.progress != null && { progress: event.progress }),
    timestamp: event.timestamp ?? Date.now()
  };
  await db.query(
    `UPDATE jobs SET narrative_stream = COALESCE(narrative_stream, '[]'::jsonb) || $2::jsonb, updated_at = NOW() WHERE id = $1`,
    [jobId, JSON.stringify([item])]
  );
}

/**
 * Get narrative_stream array for a job (for SSE replay on reconnect).
 * @param {string} jobId
 * @returns {Promise<Array<{ type: string, content: string, progress?: number, timestamp?: number }>>}
 */
export async function getNarrativeStream(jobId) {
  const r = await db.query(
    `SELECT narrative_stream FROM jobs WHERE id = $1`,
    [jobId]
  );
  const raw = r.rows[0]?.narrative_stream;
  if (raw == null) return [];
  const arr = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : raw;
  if (!Array.isArray(arr)) return [];
  return arr;
}

export { getQueue, getConnection, JOB_TYPES, QUEUE_NAME, normalizeRedisUrl, isRedisUrlValid };
