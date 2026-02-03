/**
 * SSE stream routes. Phase 1: infrastructure.
 * Auth via ?token= query param (EventSource does not support custom headers).
 * GET /api/v1/stream — open SSE connection; client receives connectionId and keepalive.
 */

import express from 'express';
import streamManager from '../services/stream-manager.js';
import { writeSSE } from '../utils/streaming-helpers.js';

const router = express.Router();

/**
 * Validate token from query and return decoded payload or null.
 * @param {string} [token]
 * @returns {{ userId: string } | null}
 */
function validateStreamToken(authService, token) {
  if (!token || typeof token !== 'string') return null;
  const t = token.trim();
  if (!t) return null;
  try {
    const decoded = authService.verifyToken(t);
    return decoded?.userId ? { userId: decoded.userId } : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/v1/stream/:connectionId?token=JWT
 * Joins an existing stream by connectionId (returned from POST /audiences/generate-stream,
 * POST /blog/generate-stream, POST /topics/generate-stream, etc.). Auth via ?token= (JWT).
 * Response: SSE stream of events for that connection.
 */
function handleStreamByConnectionId(authService, req, res) {
  const connectionId = req.params.connectionId;
  const token = req.query.token;
  const context = validateStreamToken(authService, token);
  if (!context) {
    res.status(401).set('Content-Type', 'text/plain').end('Unauthorized');
    return;
  }
  if (!connectionId || connectionId.length < 10) {
    res.status(400).set('Content-Type', 'text/plain').end('Invalid connectionId');
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  streamManager.createConnectionWithId(connectionId, res, {
    userId: context.userId,
    sessionId: undefined
  });
  writeSSE(res, 'connected', { connectionId });
}

/**
 * GET /api/v1/stream?token=JWT
 * Opens an SSE connection. Auth via ?token= (JWT). EventSource cannot send Authorization header.
 * Response: stream of events (connectionId, keepalive, and app events via stream-manager).
 */
export function registerStreamRoute(authService) {
  // Root first so /stream matches (/:connectionId would match / with connectionId='')
  router.get('/', (req, res) => {
    const token = req.query.token;
    const context = validateStreamToken(authService, token);
    if (!context) {
      res.status(401).set('Content-Type', 'text/plain').end('Unauthorized');
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const connectionId = streamManager.createConnection(res, {
      userId: context.userId,
      sessionId: undefined
    });

    writeSSE(res, 'connected', { connectionId });
  });

  router.get('/:connectionId', (req, res) => {
    handleStreamByConnectionId(authService, req, res);
  });

  return router;
}
