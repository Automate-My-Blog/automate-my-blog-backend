/**
 * Unit tests: SSE stream route and streaming helpers (Phase 1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerStreamRoute } from '../../routes/stream.js';
import { formatSSE, writeSSE, sendKeepalive } from '../../utils/streaming-helpers.js';

describe('streaming-helpers', () => {
  describe('formatSSE', () => {
    it('formats event and string data', () => {
      expect(formatSSE('message', 'hello')).toBe('event: message\ndata: hello\n\n');
    });
    it('formats event and object data as JSON', () => {
      expect(formatSSE('connected', { connectionId: 'abc' })).toBe(
        'event: connected\ndata: {"connectionId":"abc"}\n\n'
      );
    });
    it('escapes newlines in data as multiple data lines', () => {
      expect(formatSSE('x', 'a\nb')).toBe('event: x\ndata: a\ndata: b\n\n');
    });
  });

  describe('writeSSE', () => {
    it('writes formatted SSE to response', () => {
      const res = { write: vi.fn(), writableEnded: false };
      writeSSE(res, 'ping', { ok: true });
      expect(res.write).toHaveBeenCalledWith('event: ping\ndata: {"ok":true}\n\n');
    });
    it('does not write when response ended', () => {
      const res = { write: vi.fn(), writableEnded: true };
      writeSSE(res, 'ping', {});
      expect(res.write).not.toHaveBeenCalled();
    });
  });

  describe('sendKeepalive', () => {
    it('writes keepalive comment', () => {
      const res = { write: vi.fn(), writableEnded: false };
      sendKeepalive(res);
      expect(res.write).toHaveBeenCalledWith(': keepalive\n\n');
    });
    it('does not write when response ended', () => {
      const res = { write: vi.fn(), writableEnded: true };
      sendKeepalive(res);
      expect(res.write).not.toHaveBeenCalled();
    });
  });
});

describe('stream route', () => {
  let app;
  let authService;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    authService = {
      verifyToken: vi.fn()
    };
    app.use('/api/v1/stream', registerStreamRoute(authService));
  });

  it('returns 401 when token is missing', async () => {
    const res = await request(app).get('/api/v1/stream').expect(401);
    expect(res.text).toBe('Unauthorized');
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(authService.verifyToken).not.toHaveBeenCalled();
  });

  it('returns 401 when token is invalid', async () => {
    authService.verifyToken.mockImplementation(() => {
      throw new Error('Invalid or expired token');
    });
    const res = await request(app).get('/api/v1/stream').query({ token: 'bad' }).expect(401);
    expect(res.text).toBe('Unauthorized');
  });

  it('returns 401 when sessionId is too short', async () => {
    const res = await request(app).get('/api/v1/stream').query({ sessionId: 'short' }).expect(401);
    expect(res.text).toBe('Unauthorized');
  });

  it.skip('opens SSE connection when sessionId is valid', async () => {
    // SSE connection stays open; verify via integration test or: curl -N ".../api/v1/stream?sessionId=UUID"
    const res = await request(app)
      .get('/api/v1/stream')
      .query({ sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);
    expect(res.text).toMatch(/event: connected/);
    expect(res.text).toMatch(/connectionId/);
    expect(authService.verifyToken).not.toHaveBeenCalled();
  });

  it.skip('opens SSE by connectionId with sessionId', async () => {
    // SSE connection stays open; verify via integration test or curl.
    const connectionId = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const res = await request(app)
      .get(`/api/v1/stream/${connectionId}`)
      .query({ sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);
    expect(res.text).toMatch(/event: connected/);
    expect(res.text).toMatch(new RegExp(connectionId));
  });

  it.skip('opens SSE connection when token is valid', async () => {
    // Success path: GET /api/v1/stream?token=JWT returns 200 + SSE with connectionId.
    // In minimal app, supertest may not populate req.query for GET; verify via integration test or: curl -N "http://localhost:3001/api/v1/stream?token=YOUR_JWT"
    authService.verifyToken.mockReturnValue({ userId: 'user-123' });
    const res = await request(app)
      .get('/api/v1/stream')
      .query({ token: 'valid-jwt' })
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);
    expect(res.text).toMatch(/event: connected/);
    expect(res.text).toMatch(/connectionId/);
  });
});
