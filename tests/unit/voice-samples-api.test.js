/**
 * Unit tests: Voice samples API (upload, list, profile, delete, reanalyze).
 * @see GitHub issue #248
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockDbQuery = vi.fn();
vi.mock('../../services/database.js', () => ({ default: { query: mockDbQuery } }));

const mockCreateVoiceAnalysisJob = vi.fn().mockResolvedValue({ jobId: 'job-1' });
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

function multiPostDoc() {
  return `Preamble.

February 8, 2026
${'First post content here. '.repeat(40)}

February 15, 2026
${'Second post content here. '.repeat(40)}`;
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

  describe('POST /upload', () => {
    const orgId = '00000000-0000-0000-0000-000000000001';

    it('returns 401 without auth', async () => {
      await request(app)
        .post('/api/v1/voice-samples/upload')
        .field('organizationId', orgId)
        .attach('files', Buffer.from('hello'), 'test.txt')
        .expect(401);
    });

    it('splits multi-post document into separate samples', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: orgId }] })
        .mockResolvedValueOnce({
          rows: [{ id: 's1', source_type: 'newsletter', file_name: 'newsletter.docx-part-1', word_count: 200, processing_status: 'pending', weight: 1, created_at: new Date() }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 's2', source_type: 'newsletter', file_name: 'newsletter.docx-part-2', word_count: 200, processing_status: 'pending', weight: 1, created_at: new Date() }],
        });
      mockExtractTextFromFile.mockResolvedValue(multiPostDoc());

      const res = await request(app)
        .post('/api/v1/voice-samples/upload')
        .set('x-test-user-id', 'user-1')
        .field('organizationId', orgId)
        .field('sourceType', 'newsletter')
        .attach('files', Buffer.from('doc content'), 'newsletter.docx')
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.samples).toHaveLength(2);
      expect(res.body.samples[0].split_from).toBe('newsletter.docx');
      expect(res.body.samples[0].part).toBe(1);
      expect(res.body.samples[0].total_parts).toBe(2);
      expect(res.body.samples[1].split_from).toBe('newsletter.docx');
      expect(res.body.samples[1].part).toBe(2);
      expect(res.body.samples[1].total_parts).toBe(2);
      expect(mockCreateVoiceAnalysisJob).toHaveBeenCalledTimes(2);
    });

    it('keeps single sample when document has no date splits', async () => {
      const singleContent = 'Single post content. '.repeat(30);
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: orgId }] }).mockResolvedValueOnce({
        rows: [{ id: 's1', source_type: 'blog_post', file_name: 'post.txt', word_count: 600, processing_status: 'pending', weight: 1, created_at: new Date() }],
      });
      mockExtractTextFromFile.mockResolvedValue(singleContent);

      const res = await request(app)
        .post('/api/v1/voice-samples/upload')
        .set('x-test-user-id', 'user-1')
        .field('organizationId', orgId)
        .field('sourceType', 'blog_post')
        .attach('files', Buffer.from(singleContent), 'post.txt')
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.samples).toHaveLength(1);
      expect(res.body.samples[0].split_from).toBeUndefined();
      expect(res.body.samples[0].part).toBeUndefined();
      expect(mockCreateVoiceAnalysisJob).toHaveBeenCalledTimes(1);
    });
  });
});
