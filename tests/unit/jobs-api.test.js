/**
 * Unit tests: Jobs API routes (create, status, retry, cancel).
 * Uses minimal Express app with mocked job-queue and mock auth.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockCreateJob = vi.fn();
const mockGetJobStatus = vi.fn();
const mockRetryJob = vi.fn();
const mockCancelJob = vi.fn();

vi.mock('../../services/job-queue.js', () => ({
  createJob: (...args) => mockCreateJob(...args),
  getJobStatus: (...args) => mockGetJobStatus(...args),
  retryJob: (...args) => mockRetryJob(...args),
  cancelJob: (...args) => mockCancelJob(...args),
}));

/** Mock auth: set req.user when x-test-user-id present; x-session-id passed through. */
function mockAuth(req, _res, next) {
  const uid = req.headers['x-test-user-id'];
  if (uid) req.user = { userId: uid };
  next();
}

describe('jobs api', () => {
  /** @type {import('express').Express} */
  let app;

  beforeAll(async () => {
    const { default: jobsRouter } = await import('../../routes/jobs.js');
    app = express();
    app.use(express.json());
    app.use(mockAuth);
    app.use('/api/v1/jobs', jobsRouter);
  });

  afterEach(() => {
    mockCreateJob.mockReset();
    mockGetJobStatus.mockReset();
    mockRetryJob.mockReset();
    mockCancelJob.mockReset();
  });

  describe('POST /api/v1/jobs/website-analysis', () => {
    it('returns 401 without auth or session', async () => {
      await request(app)
        .post('/api/v1/jobs/website-analysis')
        .send({ url: 'https://example.com' })
        .expect(401);
      expect(mockCreateJob).not.toHaveBeenCalled();
    });

    it('returns 400 when url missing', async () => {
      await request(app)
        .post('/api/v1/jobs/website-analysis')
        .set('x-session-id', 's1')
        .send({})
        .expect(400);
      expect(mockCreateJob).not.toHaveBeenCalled();
    });

    it('returns 201 and jobId with session', async () => {
      mockCreateJob.mockResolvedValue({ jobId: 'j1' });
      const res = await request(app)
        .post('/api/v1/jobs/website-analysis')
        .set('x-session-id', 's1')
        .send({ url: 'https://example.com' })
        .expect(201);
      expect(res.body.jobId).toBe('j1');
      expect(mockCreateJob).toHaveBeenCalledWith(
        'website_analysis',
        { url: 'https://example.com' },
        expect.objectContaining({ sessionId: 's1' })
      );
    });

    it('returns 201 and jobId with user', async () => {
      mockCreateJob.mockResolvedValue({ jobId: 'j2' });
      const res = await request(app)
        .post('/api/v1/jobs/website-analysis')
        .set('x-test-user-id', 'u1')
        .send({ url: 'https://example.com' })
        .expect(201);
      expect(res.body.jobId).toBe('j2');
      expect(mockCreateJob).toHaveBeenCalledWith(
        'website_analysis',
        { url: 'https://example.com' },
        expect.objectContaining({ userId: 'u1' })
      );
    });
  });

  describe('POST /api/v1/jobs/content-generation', () => {
    it('returns 401 without user', async () => {
      await request(app)
        .post('/api/v1/jobs/content-generation')
        .set('x-session-id', 's1')
        .send({
          topic: { title: 'x' },
          businessInfo: { businessType: 'x', targetAudience: 'y' },
          organizationId: 'org1',
        })
        .expect(401);
      expect(mockCreateJob).not.toHaveBeenCalled();
    });

    it('returns 400 when required fields missing', async () => {
      await request(app)
        .post('/api/v1/jobs/content-generation')
        .set('x-test-user-id', 'u1')
        .send({ topic: { title: 'x' } })
        .expect(400);
      expect(mockCreateJob).not.toHaveBeenCalled();
    });

    it('returns 201 and jobId with user', async () => {
      mockCreateJob.mockResolvedValue({ jobId: 'j3' });
      const payload = {
        topic: { title: 't' },
        businessInfo: { businessType: 'b', targetAudience: 'a' },
        organizationId: 'org1',
      };
      const res = await request(app)
        .post('/api/v1/jobs/content-generation')
        .set('x-test-user-id', 'u1')
        .send(payload)
        .expect(201);
      expect(res.body.jobId).toBe('j3');
      expect(mockCreateJob).toHaveBeenCalledWith(
        'content_generation',
        expect.objectContaining({
          topic: payload.topic,
          businessInfo: payload.businessInfo,
          organizationId: payload.organizationId,
        }),
        expect.objectContaining({ userId: 'u1', tenantId: 'org1' })
      );
    });
  });

  describe('GET /api/v1/jobs/:jobId/status', () => {
    it('returns 401 without auth or session', async () => {
      await request(app).get('/api/v1/jobs/j1/status').expect(401);
      expect(mockGetJobStatus).not.toHaveBeenCalled();
    });

    it('returns 404 when job not found', async () => {
      mockGetJobStatus.mockResolvedValue(null);
      await request(app)
        .get('/api/v1/jobs/j1/status')
        .set('x-test-user-id', 'u1')
        .expect(404);
      expect(mockGetJobStatus).toHaveBeenCalledWith('j1', { userId: 'u1', sessionId: null });
    });

    it('returns 200 with status when found', async () => {
      mockGetJobStatus.mockResolvedValue({
        jobId: 'j1',
        status: 'succeeded',
        progress: 100,
        result: { foo: 'bar' },
      });
      const res = await request(app)
        .get('/api/v1/jobs/j1/status')
        .set('x-test-user-id', 'u1')
        .expect(200);
      expect(res.body.jobId).toBe('j1');
      expect(res.body.status).toBe('succeeded');
      expect(res.body.result).toEqual({ foo: 'bar' });
    });
  });

  describe('POST /api/v1/jobs/:jobId/retry', () => {
    it('returns 401 without auth or session', async () => {
      await request(app).post('/api/v1/jobs/j1/retry').expect(401);
      expect(mockRetryJob).not.toHaveBeenCalled();
    });

    it('returns 404 when job not found', async () => {
      mockRetryJob.mockResolvedValue(null);
      await request(app)
        .post('/api/v1/jobs/j1/retry')
        .set('x-test-user-id', 'u1')
        .expect(404);
    });

    it('returns 400 when job not failed', async () => {
      const err = new Error('Job is not in failed state');
      err.statusCode = 400;
      mockRetryJob.mockRejectedValue(err);
      await request(app)
        .post('/api/v1/jobs/j1/retry')
        .set('x-test-user-id', 'u1')
        .expect(400);
    });

    it('returns 200 with jobId on success', async () => {
      mockRetryJob.mockResolvedValue({ jobId: 'j1' });
      const res = await request(app)
        .post('/api/v1/jobs/j1/retry')
        .set('x-test-user-id', 'u1')
        .expect(200);
      expect(res.body.jobId).toBe('j1');
    });
  });

  describe('POST /api/v1/jobs/:jobId/cancel', () => {
    it('returns 401 without auth or session', async () => {
      await request(app).post('/api/v1/jobs/j1/cancel').expect(401);
      expect(mockCancelJob).not.toHaveBeenCalled();
    });

    it('returns 404 when job not found', async () => {
      mockCancelJob.mockResolvedValue(null);
      await request(app)
        .post('/api/v1/jobs/j1/cancel')
        .set('x-test-user-id', 'u1')
        .expect(404);
    });

    it('returns 200 with cancelled: true on success', async () => {
      mockCancelJob.mockResolvedValue({ cancelled: true });
      const res = await request(app)
        .post('/api/v1/jobs/j1/cancel')
        .set('x-test-user-id', 'u1')
        .expect(200);
      expect(res.body.cancelled).toBe(true);
    });
  });
});
