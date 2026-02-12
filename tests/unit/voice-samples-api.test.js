/**
 * Unit tests: Voice samples API (upload, list, profile, delete, reanalyze).
 * @see GitHub issue #248
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockDbQuery = vi.fn();
vi.mock('../../services/database.js', () => ({ default: { query: mockDbQuery } }));

const mockCreateVoiceAnalysisJob = vi.fn();
vi.mock('../../services/job-queue.js', () => ({
  createVoiceAnalysisJob: (...args) => mockCreateVoiceAnalysisJob(...args),
}));

const mockExtractTextFromFile = vi.fn();
vi.mock('../../utils/file-extractors.js', () => ({
  extractTextFromFile: (...args) => mockExtractTextFromFile(...args),
  SUPPORTED_SOURCE_TYPES: new Set(['blog_post', 'whitepaper', 'email', 'newsletter', 'social_post', 'call_summary', 'other_document']),
}));

function mockAuth(req, _res, next) {
  if (req.headers['x-test-user-id']) req.user = { userId: req.headers['x-test-user-id'] };
  next();
}

describe('voice-samples api', () => {
  let app;

  beforeAll(async () => {
    const { default: voiceSamplesRouter } = await import('../../routes/voice-samples.js');
    app = express();
    app.use(express.json());
    app.use(mockAuth);
    app.use('/api/v1/voice-samples', voiceSamplesRouter);
  });

  afterEach(() => {
    mockDbQuery.mockReset();
    mockCreateVoiceAnalysisJob.mockReset();
    mockExtractTextFromFile.mockReset();
  });

  it('GET /:organizationId returns 401 without auth', async () => {
    await request(app)
      .get('/api/v1/voice-samples/00000000-0000-0000-0000-000000000001')
      .expect(401);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('GET /:organizationId returns 404 when org not owned', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    await request(app)
      .get('/api/v1/voice-samples/00000000-0000-0000-0000-000000000001')
      .set('x-test-user-id', 'user-1')
      .expect(404);
    expect(mockDbQuery).toHaveBeenCalledWith(
      'SELECT id FROM organizations WHERE id = $1 AND owner_user_id = $2',
      expect.any(Array)
    );
  });

  it('GET /:organizationId returns samples when org owned', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 's1', source_type: 'blog_post', file_name: 'a.txt', word_count: 10, processing_status: 'completed' }] });
    const res = await request(app)
      .get('/api/v1/voice-samples/00000000-0000-0000-0000-000000000001')
      .set('x-test-user-id', 'user-1')
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.samples)).toBe(true);
  });

  it('GET /:organizationId/profile returns 401 without auth', async () => {
    await request(app)
      .get('/api/v1/voice-samples/00000000-0000-0000-0000-000000000001/profile')
      .expect(401);
  });
});
