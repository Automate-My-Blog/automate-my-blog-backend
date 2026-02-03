/**
 * Stream manager: connection lifecycle, connection IDs, Redis Pub/Sub for SSE.
 * Phase 1 infrastructure for job stream, blog/audience/bundle streaming.
 * Extends EventEmitter for connection lifecycle events.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { getConnection } from './job-queue.js';
import { writeSSE, sendKeepalive, DEFAULT_KEEPALIVE_MS } from '../utils/streaming-helpers.js';
import { getJobEventsChannel as getJobEventsChannelUtil, JOB_EVENTS_PATTERN } from '../utils/job-stream-channels.js';

const STREAM_CHANNEL_PREFIX = 'stream:';
const STREAM_CHANNEL_PATTERN = 'stream:*';
/** Redis channel for job progress events: jobs:{jobId}:events (Phase 5) */
export const JOB_EVENTS_CHANNEL_PREFIX = 'jobs:';
const JOB_EVENTS_CHANNEL_SUFFIX = ':events';

/**
 * Single SSE connection record.
 * @typedef {{ res: import('express').Response, userId?: string, sessionId?: string, createdAt: number, keepaliveTimer?: ReturnType<typeof setInterval> }} ConnectionRecord
 */

export { getJobEventsChannelUtil as getJobEventsChannel };

class StreamManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, ConnectionRecord>} */
    this.connections = new Map();
    /** @type {Map<string, Set<string>>} jobId -> Set<connectionId> (Phase 5) */
    this.jobSubscriptions = new Map();
    /** @type {import('ioredis').Redis | null} */
    this._subscriber = null;
    this._redisSubscribed = false;
    this._redisJobPatternSubscribed = false;
    this._keepaliveMs = DEFAULT_KEEPALIVE_MS;
  }

  /**
   * Create a new SSE connection and register it.
   * @param {import('express').Response} res - Express response (SSE headers not yet sent; caller must send them)
   * @param {{ userId?: string, sessionId?: string }} context - Optional auth context
   * @param {{ keepalive?: boolean, maxAgeMs?: number }} options - keepalive (default true), maxAgeMs (e.g. 10 min for job stream)
   * @returns {string} connectionId
   */
  createConnection(res, context = {}, options = { keepalive: true }) {
    const connectionId = uuidv4();
    const createdAt = Date.now();
    const record = {
      res,
      userId: context.userId ?? undefined,
      sessionId: context.sessionId ?? undefined,
      createdAt
    };

    const cleanup = () => this.removeConnection(connectionId);

    res.on('close', cleanup);
    res.on('error', () => cleanup());

    if (options.keepalive !== false) {
      record.keepaliveTimer = setInterval(() => {
        if (res.writableEnded) {
          if (record.keepaliveTimer) clearInterval(record.keepaliveTimer);
          return;
        }
        sendKeepalive(res);
      }, this._keepaliveMs);
    }

    if (options.maxAgeMs != null && options.maxAgeMs > 0) {
      record.streamTimeout = setTimeout(cleanup, options.maxAgeMs);
    }

    this.connections.set(connectionId, record);
    this.ensureRedisSubscriber();
    this.emit('connection', { connectionId, ...context });
    return connectionId;
  }

  /**
   * Remove a connection and clean up (clear keepalive, remove from map).
   * @param {string} connectionId
   */
  removeConnection(connectionId) {
    this.unsubscribeConnectionFromAllJobs(connectionId);
    const record = this.connections.get(connectionId);
    if (!record) return;
    if (record.keepaliveTimer) {
      clearInterval(record.keepaliveTimer);
      record.keepaliveTimer = undefined;
    }
    if (record.streamTimeout) clearTimeout(record.streamTimeout);
    this.connections.delete(connectionId);
    this.emit('disconnect', { connectionId, userId: record.userId, sessionId: record.sessionId });
  }

  /**
   * Subscribe a connection to job events (Phase 5). Call ensureRedisSubscriber first.
   * @param {string} jobId
   * @param {string} connectionId
   */
  subscribeToJob(jobId, connectionId) {
    if (!this.jobSubscriptions.has(jobId)) this.jobSubscriptions.set(jobId, new Set());
    this.jobSubscriptions.get(jobId).add(connectionId);
    this.ensureRedisJobPatternSubscriber();
  }

  /**
   * Unsubscribe a connection from a job.
   * @param {string} jobId
   * @param {string} connectionId
   */
  unsubscribeFromJob(jobId, connectionId) {
    const set = this.jobSubscriptions.get(jobId);
    if (set) {
      set.delete(connectionId);
      if (set.size === 0) this.jobSubscriptions.delete(jobId);
    }
  }

  /**
   * Remove connectionId from all job subscription sets (e.g. on disconnect).
   * @param {string} connectionId
   */
  unsubscribeConnectionFromAllJobs(connectionId) {
    for (const [jobId, set] of this.jobSubscriptions.entries()) {
      set.delete(connectionId);
      if (set.size === 0) this.jobSubscriptions.delete(jobId);
    }
  }

  /**
   * Publish a job event to Redis (for worker or API). Subscribers to jobs:{jobId}:events will receive it.
   * @param {string} jobId
   * @param {string} event - e.g. 'progress-update', 'step-change', 'complete', 'failed'
   * @param {object} data
   */
  publishJobEvent(jobId, event, data) {
    const conn = getConnection();
    if (!conn) return;
    const channel = getJobEventsChannelUtil(jobId);
    const payload = JSON.stringify({ event, data });
    conn.publish(channel, payload).catch((err) => {
      console.error('[stream-manager] Redis publishJobEvent error:', err?.message || err);
    });
  }

  /**
   * Send an SSE event to a single connection (in-process).
   * @param {string} connectionId
   * @param {string} event - Event type
   * @param {string|object} data - Payload
   * @returns {boolean} true if sent, false if connection not found or ended
   */
  sendToConnection(connectionId, event, data) {
    const record = this.connections.get(connectionId);
    if (!record || record.res.writableEnded) return false;
    writeSSE(record.res, event, data);
    return true;
  }

  /**
   * Publish an event to a connection via Redis. Delivered to the process that owns the connection;
   * if this process owns it, we deliver directly; otherwise Redis subscriber will deliver.
   * @param {string} connectionId
   * @param {string} event - Event type
   * @param {string|object} data - Payload (will be JSON.stringify'd if object)
   */
  publish(connectionId, event, data) {
    if (this.sendToConnection(connectionId, event, data)) return;
    const conn = getConnection();
    if (!conn) return;
    const payload = JSON.stringify({ event, data: typeof data === 'string' ? data : data });
    conn.publish(STREAM_CHANNEL_PREFIX + connectionId, payload).catch((err) => {
      console.error('[stream-manager] Redis publish error:', err?.message || err);
    });
  }

  /**
   * Subscribe to Redis stream:* and forward messages to local connections.
   * Only one subscriber is created (guarded by _subscriber).
   */
  ensureRedisSubscriber() {
    const conn = getConnection();
    if (!conn) return;
    if (this._subscriber) return;
    try {
      this._subscriber = conn.duplicate();
      this._subscriber.on('error', (err) => {
        console.error('[stream-manager] Redis subscriber error:', err?.message || err);
      });
      this._subscriber.on('pmessage', (pattern, channel, message) => {
        if (channel.startsWith(STREAM_CHANNEL_PREFIX)) {
          const connectionId = channel.slice(STREAM_CHANNEL_PREFIX.length);
          try {
            const { event, data } = JSON.parse(message);
            this.sendToConnection(connectionId, event, data);
          } catch (e) {
            console.error('[stream-manager] Invalid Redis stream message:', e?.message || e);
          }
          return;
        }
        if (channel.startsWith(JOB_EVENTS_CHANNEL_PREFIX) && channel.endsWith(JOB_EVENTS_CHANNEL_SUFFIX)) {
          const jobId = channel.slice(JOB_EVENTS_CHANNEL_PREFIX.length, channel.length - JOB_EVENTS_CHANNEL_SUFFIX.length);
          const set = this.jobSubscriptions.get(jobId);
          if (!set || set.size === 0) return;
          try {
            const { event, data } = JSON.parse(message);
            for (const connectionId of set) {
              this.sendToConnection(connectionId, event, data);
            }
          } catch (e) {
            console.error('[stream-manager] Invalid Redis job event message:', e?.message || e);
          }
        }
      });
      this._subscriber.psubscribe(STREAM_CHANNEL_PATTERN, (err) => {
        if (err) {
          console.error('[stream-manager] Redis psubscribe error:', err?.message || err);
          return;
        }
        this._redisSubscribed = true;
      });
    } catch (e) {
      console.error('[stream-manager] Failed to create Redis subscriber:', e?.message || e);
    }
  }

  /**
   * Subscribe to Redis jobs:*:events for job stream (Phase 5).
   */
  ensureRedisJobPatternSubscriber() {
    if (!this._subscriber || this._redisJobPatternSubscribed) return;
    this._subscriber.psubscribe(JOB_EVENTS_PATTERN, (err) => {
      if (err) {
        console.error('[stream-manager] Redis psubscribe jobs:*:events error:', err?.message || err);
        return;
      }
      this._redisJobPatternSubscribed = true;
    });
  }

  /**
   * Number of active connections (for monitoring).
   */
  get connectionCount() {
    return this.connections.size;
  }
}

const streamManager = new StreamManager();
export default streamManager;
export { STREAM_CHANNEL_PREFIX, STREAM_CHANNEL_PATTERN };
