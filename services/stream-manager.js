/**
 * Stream manager: connection lifecycle, connection IDs, Redis Pub/Sub for SSE.
 * Phase 1 infrastructure for job stream, blog/audience/bundle streaming.
 * Extends EventEmitter for connection lifecycle events.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { getConnection } from './job-queue.js';
import { writeSSE, sendKeepalive, DEFAULT_KEEPALIVE_MS } from '../utils/streaming-helpers.js';

import {
  getJobEventsChannel as getJobEventsChannelUtil,
  JOB_EVENTS_PATTERN,
  JOB_NARRATIVE_PATTERN
} from '../utils/job-stream-channels.js';

const STREAM_CHANNEL_PREFIX = 'stream:';
const STREAM_CHANNEL_PATTERN = 'stream:*';
/** Redis channel for job progress events: jobs:{jobId}:events (Phase 5) */
export const JOB_EVENTS_CHANNEL_PREFIX = 'jobs:';
const JOB_EVENTS_CHANNEL_SUFFIX = ':events';
const JOB_NARRATIVE_SUFFIX = ':narrative';

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
    /** @type {Map<string, Set<import('express').Response>>} jobId -> Set<res> for narrative stream (shared subscriber). */
    this.narrativeStreams = new Map();
    /** @type {import('ioredis').Redis | null} */
    this._subscriber = null;
    this._redisSubscribed = false;
    this._redisJobPatternSubscribed = false;
    this._redisNarrativePatternSubscribed = false;
    /** @type {Promise<void> | null} Resolves when job-events pattern is subscribed; reused to avoid double psubscribe. */
    this._jobPatternSubscribePromise = null;
    /** @type {Promise<void> | null} Resolves when narrative pattern is subscribed. */
    this._narrativePatternSubscribePromise = null;
    this._keepaliveMs = DEFAULT_KEEPALIVE_MS;
    /** @type {{ connectionIds: string[], event: string, data: object }[]} Queue so job events are sent one per tick (avoids frontend bursts). */
    this._jobEventQueue = [];
    this._jobEventDrainScheduled = false;
    /** @type {Map<string, () => void | Promise<void>>} Run when a connection is first established (e.g. start topic generation so events are not lost). */
    this._pendingOnConnect = new Map();
  }

  /**
   * Enqueue a job event for delivery; drain sends one event per tick so the client receives updates in real time.
   * @param {string[]} connectionIds
   * @param {string} event
   * @param {object} data
   */
  _enqueueJobEventDelivery(connectionIds, event, data) {
    this._jobEventQueue.push({ connectionIds, event, data });
    if (!this._jobEventDrainScheduled) {
      this._jobEventDrainScheduled = true;
      setImmediate(() => this._drainJobEventQueue());
    }
  }

  _drainJobEventQueue() {
    this._jobEventDrainScheduled = false;
    const item = this._jobEventQueue.shift();
    if (!item) return;
    for (const connectionId of item.connectionIds) {
      this.sendToConnection(connectionId, item.event, item.data);
    }
    if (this._jobEventQueue.length > 0) {
      this._jobEventDrainScheduled = true;
      setImmediate(() => this._drainJobEventQueue());
    }
  }

  /**
   * Create a new SSE connection with a pre-determined connectionId (e.g. from POST /audiences/generate-stream).
   * Used when client receives connectionId from a POST response and then opens GET /stream/:connectionId.
   * @param {string} connectionId - Pre-generated connection ID
   * @param {import('express').Response} res - Express response (SSE headers not yet sent; caller must send them)
   * @param {{ userId?: string, sessionId?: string }} context - Optional auth context
   * @param {{ keepalive?: boolean, maxAgeMs?: number }} options - keepalive (default true), maxAgeMs
   */
  createConnectionWithId(connectionId, res, context = {}, options = { keepalive: true }) {
    if (this.connections.has(connectionId)) {
      this.removeConnection(connectionId);
    }
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
    const pending = this._pendingOnConnect.get(connectionId);
    if (pending) {
      this._pendingOnConnect.delete(connectionId);
      try {
        const out = pending();
        if (out && typeof out.then === 'function') out.catch((err) => console.error('[stream-manager] pendingOnConnect error:', err?.message || err));
      } catch (err) {
        console.error('[stream-manager] pendingOnConnect error:', err?.message || err);
      }
    }
    this.emit('connection', { connectionId, ...context });
    return connectionId;
  }

  /**
   * Register a callback to run when a client connects with this connectionId (GET /stream/:connectionId).
   * Use for topic/audience streams so generation starts after the connection exists and events are not lost.
   * @param {string} connectionId
   * @param {() => void | Promise<void>} callback
   */
  registerPendingOnConnect(connectionId, callback) {
    if (connectionId && typeof callback === 'function') this._pendingOnConnect.set(connectionId, callback);
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
        if (channel.startsWith(JOB_EVENTS_CHANNEL_PREFIX) && channel.endsWith(JOB_NARRATIVE_SUFFIX)) {
          const jobId = channel.slice(JOB_EVENTS_CHANNEL_PREFIX.length, channel.length - JOB_NARRATIVE_SUFFIX.length);
          const set = this.narrativeStreams.get(jobId);
          if (!set || set.size === 0) return;
          try {
            const item = JSON.parse(message);
            const payload = { content: item.content ?? '', ...(item.progress != null && { progress: item.progress }) };
            for (const res of set) {
              if (res.writableEnded) {
                set.delete(res);
                continue;
              }
              writeSSE(res, item.type, payload);
            }
            if (set.size === 0) this.narrativeStreams.delete(jobId);
          } catch (e) {
            console.error('[stream-manager] Invalid Redis narrative message:', e?.message || e);
          }
          return;
        }
        if (channel.startsWith(JOB_EVENTS_CHANNEL_PREFIX) && channel.endsWith(JOB_EVENTS_CHANNEL_SUFFIX)) {
          const jobId = channel.slice(JOB_EVENTS_CHANNEL_PREFIX.length, channel.length - JOB_EVENTS_CHANNEL_SUFFIX.length);
          const set = this.jobSubscriptions.get(jobId);
          if (!set || set.size === 0) return;
          try {
            const { event, data } = JSON.parse(message);
            this._enqueueJobEventDelivery(Array.from(set), event, data);
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
   * Returns a Promise that resolves when the pattern is subscribed (so route can await before sending 'connected').
   * Reuses the same promise if subscription is already in progress to avoid duplicate psubscribe.
   */
  ensureRedisJobPatternSubscriber() {
    if (!this._subscriber) return Promise.resolve();
    if (this._redisJobPatternSubscribed) return Promise.resolve();
    if (this._jobPatternSubscribePromise) return this._jobPatternSubscribePromise;
    this._jobPatternSubscribePromise = new Promise((resolve, reject) => {
      this._subscriber.psubscribe(JOB_EVENTS_PATTERN, (err) => {
        if (err) {
          console.error('[stream-manager] Redis psubscribe jobs:*:events error:', err?.message || err);
          this._jobPatternSubscribePromise = null;
          reject(err);
          return;
        }
        this._redisJobPatternSubscribed = true;
        resolve();
      });
    });
    return this._jobPatternSubscribePromise;
  }

  /** Max wait for Redis job-events pattern subscription (serverless cold start / slow Redis). */
  static JOB_PATTERN_READY_TIMEOUT_MS = 5000;

  /**
   * Wait until the job-events Redis pattern is subscribed. Call before sending 'connected' on the job stream
   * so early worker events are not missed (fixes intermittent missed events on fast jobs).
   * Resolves after JOB_PATTERN_READY_TIMEOUT_MS even if Redis is not ready, so the stream never hangs (e.g. on Vercel).
   */
  async whenJobPatternReady() {
    this.ensureRedisSubscriber();
    const ready = this.ensureRedisJobPatternSubscriber();
    const timeout = new Promise((resolve) => {
      setTimeout(resolve, StreamManager.JOB_PATTERN_READY_TIMEOUT_MS);
    });
    await Promise.race([ready, timeout]);
  }

  /**
   * Wait until the narrative Redis pattern is subscribed. Call before registering a narrative stream so early events are not missed.
   */
  async whenNarrativePatternReady() {
    this.ensureRedisSubscriber();
    return this.ensureRedisNarrativePatternSubscriber();
  }

  /**
   * Subscribe to Redis jobs:*:narrative (one shared subscriber for all narrative streams; reduces Redis connections).
   */
  ensureRedisNarrativePatternSubscriber() {
    if (!this._subscriber) return Promise.resolve();
    if (this._redisNarrativePatternSubscribed) return Promise.resolve();
    if (this._narrativePatternSubscribePromise) return this._narrativePatternSubscribePromise;
    this._narrativePatternSubscribePromise = new Promise((resolve, reject) => {
      this._subscriber.psubscribe(JOB_NARRATIVE_PATTERN, (err) => {
        if (err) {
          console.error('[stream-manager] Redis psubscribe jobs:*:narrative error:', err?.message || err);
          this._narrativePatternSubscribePromise = null;
          reject(err);
          return;
        }
        this._redisNarrativePatternSubscribed = true;
        resolve();
      });
    });
    return this._narrativePatternSubscribePromise;
  }

  /**
   * Register a response for narrative stream (shared Redis subscriber). Call unregister on close/complete.
   * @param {string} jobId
   * @param {import('express').Response} res
   */
  registerNarrativeStream(jobId, res) {
    if (!this.narrativeStreams.has(jobId)) this.narrativeStreams.set(jobId, new Set());
    this.narrativeStreams.get(jobId).add(res);
    this.ensureRedisSubscriber();
    this.ensureRedisNarrativePatternSubscriber();
  }

  /**
   * Unregister a response from narrative stream (e.g. on client disconnect or stream complete).
   * @param {string} jobId
   * @param {import('express').Response} res
   */
  unregisterNarrativeStream(jobId, res) {
    const set = this.narrativeStreams.get(jobId);
    if (set) {
      set.delete(res);
      if (set.size === 0) this.narrativeStreams.delete(jobId);
    }
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
