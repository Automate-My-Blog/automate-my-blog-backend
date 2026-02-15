/**
 * Unit tests: Job queue service (create, status, retry, cancel, progress, worker helpers).
 * Mocks database, Redis, and BullMQ.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

const mockAdd = vi.fn().mockResolvedValue({ id: 'mock-bull-id' });

vi.mock('../../services/database.js', () => ({
  default: { query: vi.fn() },
}));

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(function MockIORedis() {
    return { on: vi.fn(), duplicate: vi.fn().mockReturnValue({ on: vi.fn(), psubscribe: vi.fn() }) };
  }),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(function MockQueue() { return { add: mockAdd }; }),
}));

const db = (await import('../../services/database.js')).default;
let jobQueue;

beforeAll(async () => {
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
  const mod = await import('../../services/job-queue.js');
  jobQueue = mod;
});

afterEach(() => {
  vi.mocked(db.query).mockReset();
  mockAdd.mockClear();
});

describe('job-queue', () => {
  describe('state constants', () => {
    it('exports retry and cancel transition rules', () => {
      expect(jobQueue.RETRIABLE_STATUS).toBe('failed');
      expect(jobQueue.CANCELLABLE_STATUSES).toEqual(['queued', 'running']);
    });
  });

  describe('createJob', () => {
    it('throws on invalid type', async () => {
      await expect(
        jobQueue.createJob('invalid', {}, { userId: 'u1' })
      ).rejects.toThrow('Invalid job type');
      expect(db.query).not.toHaveBeenCalled();
    });

    it('throws when neither userId nor sessionId', async () => {
      await expect(
        jobQueue.createJob('website_analysis', { url: 'https://x.com' }, {})
      ).rejects.toThrow('Either userId or sessionId is required');
      expect(db.query).not.toHaveBeenCalled();
    });

    it('throws ServiceUnavailableError when REDIS_URL missing', async () => {
      const orig = process.env.REDIS_URL;
      delete process.env.REDIS_URL;
      await expect(
        jobQueue.createJob('website_analysis', { url: 'https://x.com' }, { sessionId: 's1' })
      ).rejects.toMatchObject({ name: 'ServiceUnavailableError', message: expect.stringContaining('REDIS_URL') });
      process.env.REDIS_URL = orig;
    });

    it('inserts row, enqueues, returns jobId', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 });
      const { jobId } = await jobQueue.createJob('website_analysis', { url: 'https://example.com' }, {
        sessionId: 's1',
      });
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO jobs'),
        expect.any(Array)
      );
      expect(mockAdd).toHaveBeenCalledWith('website_analysis', { jobId }, { jobId });
    });

    it('accepts userId and tenantId', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ id: 'u1' }] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await jobQueue.createJob('content_generation', { topic: {}, businessInfo: {}, organizationId: 'org1' }, {
        userId: 'u1',
        tenantId: 'org1',
      });
      expect(db.query).toHaveBeenNthCalledWith(1, 'SELECT id FROM users WHERE id = $1', ['u1']);
      const [, params] = vi.mocked(db.query).mock.calls[1];
      expect(params[0]).toBeDefined();
      expect(params[2]).toBe('u1');
      expect(params[1]).toBe('org1');
    });

    it('throws UserNotFoundError when userId is not in users table and no sessionId', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [] });
      await expect(
        jobQueue.createJob('website_analysis', { url: 'https://x.com' }, { userId: 'nonexistent-user-id' })
      ).rejects.toMatchObject({ name: 'UserNotFoundError', userId: 'nonexistent-user-id' });
      expect(db.query).toHaveBeenCalledWith('SELECT id FROM users WHERE id = $1', ['nonexistent-user-id']);
      expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO jobs'), expect.any(Array));
    });

    it('falls back to session-only when userId not in users table but sessionId present', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const { jobId } = await jobQueue.createJob('website_analysis', { url: 'https://x.com' }, {
        userId: 'deleted-user-id',
        sessionId: 'session_anon_123',
      });
      expect(jobId).toBeDefined();
      expect(db.query).toHaveBeenNthCalledWith(1, 'SELECT id FROM users WHERE id = $1', ['deleted-user-id']);
      const [, params] = vi.mocked(db.query).mock.calls[1];
      expect(params[2]).toBe(null);
      expect(params[3]).toBe('session_anon_123');
    });
  });

  describe('createContentCalendarJob', () => {
    it('creates content_calendar job with strategyIds', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ id: 'u1' }] }) // createContentCalendarJob user check
        .mockResolvedValueOnce({ rows: [{ id: 'u1' }] }) // createJob user check
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT
      const result = await jobQueue.createContentCalendarJob(['strat-1', 'strat-2'], 'u1');
      expect(result).not.toBeNull();
      expect(result.jobId).toBeDefined();
      expect(mockAdd).toHaveBeenCalledWith('content_calendar', { jobId: result.jobId }, { jobId: result.jobId });
      const insertCall = vi.mocked(db.query).mock.calls.find((c) => c[0].includes('INSERT INTO jobs'));
      const params = insertCall[1];
      const input = JSON.parse(params[5]);
      expect(input.strategyIds).toEqual(['strat-1', 'strat-2']);
    });

    it('throws when strategyIds empty', async () => {
      await expect(
        jobQueue.createContentCalendarJob([], 'u1')
      ).rejects.toThrow('non-empty strategyIds');
    });

    it('throws when userId missing', async () => {
      await expect(
        jobQueue.createContentCalendarJob(['s1'], null)
      ).rejects.toThrow('userId');
    });
  });

  describe('getJobStatus', () => {
    it('returns null when job not found', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [] });
      const status = await jobQueue.getJobStatus('j1', { userId: 'u1' });
      expect(status).toBeNull();
    });

    it('returns null when not owned (wrong user)', async () => {
      vi.mocked(db.query).mockResolvedValue({
        rows: [{ id: 'j1', user_id: 'other', session_id: null, status: 'succeeded', progress: 100 }],
      });
      const status = await jobQueue.getJobStatus('j1', { userId: 'u1' });
      expect(status).toBeNull();
    });

    it('returns status when owned by user', async () => {
      const row = {
        id: 'j1',
        user_id: 'u1',
        session_id: null,
        status: 'succeeded',
        progress: 100,
        current_step: null,
        estimated_seconds_remaining: null,
        error: null,
        error_code: null,
        result: { foo: 'bar' },
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:01:00Z'),
      };
      vi.mocked(db.query).mockResolvedValue({ rows: [row] });
      const status = await jobQueue.getJobStatus('j1', { userId: 'u1' });
      expect(status).not.toBeNull();
      expect(status.jobId).toBe('j1');
      expect(status.status).toBe('succeeded');
      expect(status.progress).toBe(100);
      expect(status.result).toEqual({ foo: 'bar' });
      expect(status.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(status.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns status when owned by session', async () => {
      vi.mocked(db.query).mockResolvedValue({
        rows: [{
          id: 'j2', user_id: null, session_id: 's1', status: 'running', progress: 50,
          current_step: 'Analyzing...', estimated_seconds_remaining: 30, error: null, error_code: null,
          result: null, created_at: new Date(), updated_at: new Date(),
        }],
      });
      const status = await jobQueue.getJobStatus('j2', { sessionId: 's1' });
      expect(status).not.toBeNull();
      expect(status.status).toBe('running');
      expect(status.currentStep).toBe('Analyzing...');
      expect(status.estimatedTimeRemaining).toBe(30);
    });
  });

  describe('retryJob', () => {
    it('returns null when job not found', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [] });
      const out = await jobQueue.retryJob('j1', { userId: 'u1' });
      expect(out).toBeNull();
    });

    it('throws InvariantViolation when job not failed', async () => {
      vi.mocked(db.query).mockResolvedValue({
        rows: [{ id: 'j1', user_id: 'u1', session_id: null, status: 'running', type: 'website_analysis' }],
      });
      await expect(jobQueue.retryJob('j1', { userId: 'u1' })).rejects.toMatchObject({
        name: 'InvariantViolation',
        message: 'Job is not in failed state',
        statusCode: 400,
      });
    });

    it('updates row, enqueues, returns jobId', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'j1', user_id: 'u1', session_id: null, status: 'failed', type: 'content_generation' }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const { jobId } = await jobQueue.retryJob('j1', { userId: 'u1' });
      expect(jobId).toBe('j1');
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(mockAdd).toHaveBeenCalledWith('content_generation', { jobId: 'j1' }, { jobId: 'j1' });
    });
  });

  describe('cancelJob', () => {
    it('returns null when job not found', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [] });
      const out = await jobQueue.cancelJob('j1', { userId: 'u1' });
      expect(out).toBeNull();
    });

    it('throws InvariantViolation when job not cancellable', async () => {
      vi.mocked(db.query).mockResolvedValue({
        rows: [{ id: 'j1', user_id: 'u1', session_id: null, status: 'succeeded' }],
      });
      await expect(jobQueue.cancelJob('j1', { userId: 'u1' })).rejects.toMatchObject({
        name: 'InvariantViolation',
        message: 'Job is not cancellable',
        statusCode: 400,
      });
    });

    it('sets cancelled_at and returns { cancelled: true }', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'j1', user_id: 'u1', session_id: null, status: 'running' }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const out = await jobQueue.cancelJob('j1', { userId: 'u1' });
      expect(out).toEqual({ cancelled: true });
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('cancelled_at = NOW()'),
        ['j1']
      );
    });
  });

  describe('updateJobProgress', () => {
    it('updates only provided fields', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 });
      await jobQueue.updateJobProgress('j1', {
        status: 'running',
        progress: 25,
        current_step: 'Analyzing...',
      });
      const [sql, params] = vi.mocked(db.query).mock.calls[0];
      expect(sql).toMatch(/status = \$1/);
      expect(sql).toMatch(/progress = \$2/);
      expect(sql).toMatch(/current_step = \$3/);
      expect(params).toContain('running');
      expect(params).toContain(25);
      expect(params).toContain('Analyzing...');
      expect(params).toContain('j1');
    });
  });

  describe('isJobCancelled', () => {
    it('returns false when cancelled_at is null', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [{ cancelled_at: null }] });
      expect(await jobQueue.isJobCancelled('j1')).toBe(false);
    });

    it('returns true when cancelled_at is set', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [{ cancelled_at: new Date() }] });
      expect(await jobQueue.isJobCancelled('j1')).toBe(true);
    });

    it('returns false when job missing', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [] });
      expect(await jobQueue.isJobCancelled('j1')).toBe(false);
    });
  });

  describe('getJobRow', () => {
    it('returns row when found', async () => {
      const row = { id: 'j1', type: 'website_analysis', status: 'queued', input: {} };
      vi.mocked(db.query).mockResolvedValue({ rows: [row] });
      expect(await jobQueue.getJobRow('j1')).toEqual(row);
    });

    it('returns null when not found', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [] });
      expect(await jobQueue.getJobRow('j1')).toBeNull();
    });
  });
});
