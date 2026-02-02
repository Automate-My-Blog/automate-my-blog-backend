/**
 * Stream manager: connection lifecycle, connection IDs, Redis Pub/Sub for SSE.
 * Phase 1 infrastructure for job stream, blog/audience/bundle streaming.
 * Extends EventEmitter for connection lifecycle events.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { getConnection } from './job-queue.js';
import { writeSSE, sendKeepalive, DEFAULT_KEEPALIVE_MS } from '../utils/streaming-helpers.js';

const STREAM_CHANNEL_PREFIX = 'stream:';
const STREAM_CHANNEL_PATTERN = 'stream:*';

/**
 * Single SSE connection record.
 * @typedef {{ res: import('express').Response, userId?: string, sessionId?: string, createdAt: number, keepaliveTimer?: ReturnType<typeof setInterval> }} ConnectionRecord
 */

class StreamManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, ConnectionRecord>} */
    this.connections = new Map();
    /** @type {import('ioredis').Redis | null} */
    this._subscriber = null;
    this._redisSubscribed = false;
    this._keepaliveMs = DEFAULT_KEEPALIVE_MS;
  }

  /**
   * Create a new SSE connection and register it.
   * @param {import('express').Response} res - Express response (SSE headers not yet sent; caller must send them)
   * @param {{ userId?: string, sessionId?: string }} context - Optional auth context
   * @param {{ keepalive?: boolean }} options - Enable keepalive comments (default true)
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
    const record = this.connections.get(connectionId);
    if (!record) return;
    if (record.keepaliveTimer) {
      clearInterval(record.keepaliveTimer);
      record.keepaliveTimer = undefined;
    }
    this.connections.delete(connectionId);
    this.emit('disconnect', { connectionId, userId: record.userId, sessionId: record.sessionId });
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
        const connectionId = channel.startsWith(STREAM_CHANNEL_PREFIX)
          ? channel.slice(STREAM_CHANNEL_PREFIX.length)
          : null;
        if (!connectionId) return;
        try {
          const { event, data } = JSON.parse(message);
          this.sendToConnection(connectionId, event, data);
        } catch (e) {
          console.error('[stream-manager] Invalid Redis stream message:', e?.message || e);
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
   * Number of active connections (for monitoring).
   */
  get connectionCount() {
    return this.connections.size;
  }
}

const streamManager = new StreamManager();
export default streamManager;
export { STREAM_CHANNEL_PREFIX, STREAM_CHANNEL_PATTERN };
