/**
 * SSE stream routes. Phase 1: infrastructure.
 * Auth via query: ?token=JWT (logged-in) or ?sessionId= (anonymous/session). EventSource cannot send headers.
 * GET /api/v1/stream — open SSE connection; client receives connectionId and keepalive.
 */

import express from 'express';
import streamManager from '../services/stream-manager.js';
import { writeSSE } from '../utils/streaming-helpers.js';

const router = express.Router();

/** Minimum length for sessionId (UUIDs are 36 chars; be permissive). */
const MIN_SESSION_ID_LENGTH = 10;

/**
 * Resolve stream auth from query: JWT (token) or session ID. One must be valid.
 * @param {object} authService - auth service with verifyToken(token)
 * @param {{ token?: string, sessionId?: string }} query - req.query
 * @returns {{ userId?: string, sessionId?: string } | null}
 */
function validateStreamAuth(authService, query) {
  const token = query?.token;
  if (token && typeof token === 'string') {
    const t = token.trim();
    if (t) {
      try {
        const decoded = authService.verifyToken(t);
        if (decoded?.userId) return { userId: decoded.userId };
      } catch {
        // fall through to sessionId
      }
    }
  }
  const sessionId = query?.sessionId;
  if (sessionId && typeof sessionId === 'string') {
    const s = sessionId.trim();
    if (s.length >= MIN_SESSION_ID_LENGTH) return { sessionId: s };
  }
  return null;
}

/**
 * GET /api/v1/stream/:connectionId?token=JWT | ?sessionId=
 * Joins an existing stream by connectionId (returned from POST .../generate-stream).
 * Auth: ?token= (JWT) for logged-in users, or ?sessionId= for anonymous/session users.
 * Response: SSE stream of events for that connection.
 */
function handleStreamByConnectionId(authService, req, res) {
  const connectionId = req.params.connectionId;
  const context = validateStreamAuth(authService, req.query);
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
    sessionId: context.sessionId
  });
  writeSSE(res, 'connected', { connectionId });
}

/**
 * GET /api/v1/stream?token=JWT | ?sessionId=
 * Opens an SSE connection. Auth via ?token= (JWT) or ?sessionId= (anonymous).
 * Response: stream of events (connectionId, keepalive, and app events via stream-manager).
 */
export function registerStreamRoute(authService) {
  // Root first so /stream matches (/:connectionId would match / with connectionId='')
  router.get('/', (req, res) => {
    const context = validateStreamAuth(authService, req.query);
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
      sessionId: context.sessionId
    });

    writeSSE(res, 'connected', { connectionId });
  });

  router.get('/:connectionId', (req, res) => {
    handleStreamByConnectionId(authService, req, res);
  });

  return router;
}
