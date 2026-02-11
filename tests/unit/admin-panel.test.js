/**
 * Unit tests: Admin panel (stats, cache view/clear, requireAdmin).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.fn();
const mockTransaction = vi.fn();
vi.mock('../../services/database.js', () => ({
  default: {
    query: (...args) => mockQuery(...args),
    transaction: (fn) => mockTransaction(fn),
  },
}));

const mockGetConnection = vi.fn();
vi.mock('../../services/job-queue.js', () => ({
  getConnection: () => mockGetConnection(),
}));

describe('admin panel', () => {
  const ADMIN_KEY = 'test-admin-key-123';
  let app;
  let originalEnv;
  let adminLoginHtml;
  let isAdminRequest;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    vi.resetModules();
    const { default: adminPanelRouter, requireAdmin, adminLoginHtml: loginHtml, isAdminRequest: adminCheck } = await import('../../routes/admin-panel.js');
    adminLoginHtml = loginHtml;
    isAdminRequest = adminCheck;
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = req.headers['x-test-user'] ? JSON.parse(req.headers['x-test-user']) : undefined;
      next();
    });
    app.use(requireAdmin);
    app.use('/api/v1/admin-panel', adminPanelRouter);
  });

  afterEach(() => {
    process.env = originalEnv;
    mockQuery.mockReset();
    mockTransaction.mockReset();
    mockGetConnection.mockReset();
  });

  describe('requireAdmin', () => {
    it('allows access with valid x-admin-key header', async () => {
      mockGetConnection.mockReturnValue(null);
      mockQuery.mockResolvedValue({ rows: [{ c: '1' }] });
      await request(app)
        .get('/api/v1/admin-panel/stats')
        .set('x-admin-key', ADMIN_KEY)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.app).toBeDefined();
          expect(res.body.db).toBeDefined();
        });
    });

    it('allows access with valid admin_key query', async () => {
      mockGetConnection.mockReturnValue(null);
      mockQuery.mockResolvedValue({ rows: [{ c: '1' }] });
      await request(app)
        .get('/api/v1/admin-panel/stats')
        .query({ admin_key: ADMIN_KEY })
        .expect(200);
    });

    it('returns 401 without key or user', async () => {
      await request(app)
        .get('/api/v1/admin-panel/stats')
        .expect(401)
        .then((res) => {
          expect(res.body.error).toBe('Authentication required');
        });
    });

    it('returns 403 with non-super_admin user', async () => {
      await request(app)
        .get('/api/v1/admin-panel/stats')
        .set('x-test-user', JSON.stringify({ role: 'user' }))
        .expect(403)
        .then((res) => {
          expect(res.body.error).toBe('Forbidden');
        });
    });

    it('allows access with super_admin role', async () => {
      mockGetConnection.mockReturnValue(null);
      mockQuery.mockResolvedValue({ rows: [{ c: '1' }] });
      await request(app)
        .get('/api/v1/admin-panel/stats')
        .set('x-test-user', JSON.stringify({ role: 'super_admin' }))
        .expect(200);
    });

    it('allows access with view_platform_analytics permission', async () => {
      mockGetConnection.mockReturnValue(null);
      mockQuery.mockResolvedValue({ rows: [{ c: '1' }] });
      await request(app)
        .get('/api/v1/admin-panel/stats')
        .set('x-test-user', JSON.stringify({ role: 'admin', permissions: ['view_platform_analytics'] }))
        .expect(200);
    });
  });

  describe('GET /stats', () => {
    beforeEach(() => {
      mockGetConnection.mockReturnValue({});
      mockQuery.mockImplementation((sql) => {
        if (sql === 'SELECT 1') return Promise.resolve({ rows: [{ 1: 1 }] });
        if (sql === 'SELECT * FROM platform_metrics_summary') return Promise.reject(new Error('view missing'));
        if (typeof sql === 'string' && sql.includes('pg_database_size')) return Promise.resolve({ rows: [{ bytes: 12345678 }] });
        if (typeof sql === 'string' && sql.includes('jobs') && sql.includes('GROUP BY')) {
          return Promise.resolve({
            rows: [
              { status: 'queued', type: 'website_analysis', c: '2' },
              { status: 'succeeded', type: 'website_analysis', c: '10' },
              { status: 'failed', type: 'content_generation', c: '1' }
            ]
          });
        }
        if (typeof sql === 'string' && sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ c: '42' }] });
        return Promise.resolve({ rows: [] });
      });
    });

    it('returns app and db stats with table counts, size, job summary', async () => {
      await request(app)
        .get('/api/v1/admin-panel/stats')
        .set('x-admin-key', ADMIN_KEY)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.app.nodeVersion).toBeDefined();
          expect(res.body.app.redis).toBeDefined();
          expect(res.body.db.connected).toBe(true);
          expect(res.body.db.tables).toBeDefined();
          expect(res.body.db.tables.users).toBe(42);
          expect(res.body.db.sizeBytes).toBe(12345678);
          expect(res.body.db.jobSummary).toBeDefined();
          expect(res.body.db.jobSummary.byStatus.succeeded).toBe(10);
          expect(res.body.db.jobSummary.byStatus.queued).toBe(2);
          expect(res.body.db.jobSummary.total).toBe(13);
        });
    });

    it('handles Redis not configured', async () => {
      mockGetConnection.mockImplementation(() => {
        throw new Error('REDIS_URL required');
      });
      await request(app)
        .get('/api/v1/admin-panel/stats')
        .set('x-admin-key', ADMIN_KEY)
        .expect(200)
        .then((res) => {
          expect(res.body.app.redis).toBe('error');
          expect(res.body.app.redisError).toContain('REDIS_URL');
        });
    });
  });

  describe('GET /cache', () => {
    it('returns 400 when url is missing', async () => {
      await request(app)
        .get('/api/v1/admin-panel/cache')
        .set('x-admin-key', ADMIN_KEY)
        .expect(400)
        .then((res) => {
          expect(res.body.error).toContain('url');
        });
    });

    it('returns entries for given url', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'org-uuid-1',
            name: 'Example Co',
            website_url: 'https://example.com',
            last_analyzed_at: '2026-01-15T12:00:00Z',
            created_at: '2026-01-01T00:00:00Z',
            owner_user_id: 'user-1',
            session_id: null,
          },
        ],
      });
      await request(app)
        .get('/api/v1/admin-panel/cache')
        .query({ url: 'https://example.com' })
        .set('x-admin-key', ADMIN_KEY)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.url).toBe('https://example.com');
          expect(res.body.entries).toHaveLength(1);
          expect(res.body.entries[0].organizationId).toBe('org-uuid-1');
          expect(res.body.entries[0].websiteUrl).toBe('https://example.com');
          expect(res.body.entries[0].lastAnalyzedAt).toBe('2026-01-15T12:00:00Z');
          expect(res.body.entries[0].hasOwner).toBe(true);
        });
    });
  });

  describe('DELETE /cache', () => {
    it('returns 400 when url is missing', async () => {
      await request(app)
        .delete('/api/v1/admin-panel/cache')
        .set('x-admin-key', ADMIN_KEY)
        .expect(400)
        .then((res) => {
          expect(res.body.error).toContain('url');
        });
    });

    it('returns success with cleared 0 when no orgs match', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      await request(app)
        .delete('/api/v1/admin-panel/cache')
        .query({ url: 'https://nonexistent.example.com' })
        .set('x-admin-key', ADMIN_KEY)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.cleared).toBe(0);
          expect(res.body.message).toContain('No cache entries');
        });
    });

    it('clears cache and returns cleared count when orgs match', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'intel-1' }] });
      mockTransaction.mockImplementation(async (fn) => {
        const client = {
          query: vi.fn().mockResolvedValue({ rows: [] }),
        };
        return fn(client);
      });
      await request(app)
        .delete('/api/v1/admin-panel/cache')
        .query({ url: 'https://example.com' })
        .set('x-admin-key', ADMIN_KEY)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.cleared).toBe(1);
          expect(res.body.message).toContain('Cleared');
        });
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /jobs/recent', () => {
    it('returns recent jobs', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: 'j1', type: 'website_analysis', status: 'succeeded', progress: 100, error: null, created_at: '2026-01-01T00:00:00Z', started_at: null, finished_at: null }
        ]
      });
      await request(app)
        .get('/api/v1/admin-panel/jobs/recent')
        .query({ limit: 10 })
        .set('x-admin-key', ADMIN_KEY)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.jobs).toHaveLength(1);
          expect(res.body.jobs[0].type).toBe('website_analysis');
          expect(res.body.jobs[0].status).toBe('succeeded');
        });
    });
  });

  describe('GET /cache/urls', () => {
    it('returns list of cached URLs', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: 'o1', name: 'Example', website_url: 'https://example.com', last_analyzed_at: '2026-01-15T12:00:00Z' }
        ]
      });
      await request(app)
        .get('/api/v1/admin-panel/cache/urls')
        .set('x-admin-key', ADMIN_KEY)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.urls).toHaveLength(1);
          expect(res.body.urls[0].websiteUrl).toBe('https://example.com');
        });
    });
  });

  describe('DELETE /cache/all', () => {
    it('returns cleared 0 when no cached orgs', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      await request(app)
        .delete('/api/v1/admin-panel/cache/all')
        .set('x-admin-key', ADMIN_KEY)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.cleared).toBe(0);
        });
    });

    it('clears all and returns count', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'org-1' }, { id: 'org-2' }] });
      mockTransaction.mockImplementation(async (fn) => {
        const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
        return fn(client);
      });
      await request(app)
        .delete('/api/v1/admin-panel/cache/all')
        .set('x-admin-key', ADMIN_KEY)
        .expect(200)
        .then((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.cleared).toBe(2);
        });
      expect(mockTransaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('GET / (panel HTML)', () => {
    it('returns HTML when authorized', async () => {
      await request(app)
        .get('/api/v1/admin-panel')
        .set('x-admin-key', ADMIN_KEY)
        .expect(200)
        .then((res) => {
          expect(res.headers['content-type']).toMatch(/text\/html/);
          expect(res.text).toContain('AutoBlog Admin');
          expect(res.text).toContain('Refresh');
          expect(res.text).toContain('Clear cache');
        });
    });
  });

  describe('adminLoginHtml and isAdminRequest', () => {
    it('adminLoginHtml returns login form using existing auth', () => {
      const html = adminLoginHtml();
      expect(html).toContain('Admin Login');
      expect(html).toContain('/api/v1/auth/login');
      expect(html).toContain('super_admin');
      expect(html).toContain('email');
      expect(html).toContain('password');
    });

    it('isAdminRequest returns true for key or super_admin', () => {
      expect(isAdminRequest({ headers: { 'x-admin-key': ADMIN_KEY }, query: {} })).toBe(true);
      expect(isAdminRequest({ headers: {}, query: {}, user: { role: 'super_admin' } })).toBe(true);
      expect(isAdminRequest({ headers: {}, query: {}, user: { permissions: ['view_platform_analytics'] } })).toBe(true);
      expect(isAdminRequest({ headers: {}, query: {} })).toBe(false);
      expect(isAdminRequest({ headers: {}, query: {}, user: { role: 'user' } })).toBe(false);
    });
  });
});
