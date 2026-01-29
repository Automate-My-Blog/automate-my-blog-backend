/**
 * Unit tests: Projects service DB path (getProjectByUserAndUrl, isUserAdmin).
 * Mocks database with testConnection resolving.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../services/database.js', () => ({
  default: {
    query: (...args) => mockQuery(...args),
    transaction: vi.fn((fn) => fn({ query: (...a) => mockQuery(...a) })),
    testConnection: vi.fn().mockResolvedValue(undefined),
  },
}));

let projectsService;

beforeEach(async () => {
  vi.resetModules();
  mockQuery.mockReset();
  process.env.USE_DATABASE = 'true';
  const mod = await import('../../services/projects.js');
  projectsService = mod.default;
  await new Promise((r) => setTimeout(r, 20));
});

describe('projects (DB path)', () => {
  describe('getProjectByUserAndUrl', () => {
    it('returns mapped project when db has a row', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'proj-1',
          website_url: 'https://example.com',
          business_analysis: { name: 'Acme' },
          brand_colors: null,
          target_audience: null,
          content_focus: null,
          brand_voice: null,
          business_type: null,
          scenarios: ['a', 'b'],
          customer_psychology: null,
          keywords: [],
          description: null,
          decision_makers: null,
          end_users: null,
          business_model: null,
          website_goals: null,
          blog_strategy: null,
          search_behavior: null,
          connection_message: null,
          updated_at: new Date(),
          created_at: new Date(),
        }],
      });

      const out = await projectsService.getProjectByUserAndUrl('user-1', 'https://example.com');
      expect(out).not.toBeNull();
      expect(out.id).toBe('proj-1');
      expect(out.websiteUrl).toBe('https://example.com');
      expect(out.businessAnalysis).toEqual({ name: 'Acme' });
      expect(out.scenarios).toEqual(['a', 'b']);
    });

    it('returns null when db has no rows', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const out = await projectsService.getProjectByUserAndUrl('user-1', 'https://example.com');
      expect(out).toBeNull();
    });
  });

  describe('isUserAdmin', () => {
    it('returns true when user has admin role', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ role: 'admin' }] });

      const out = await projectsService.isUserAdmin('user-1');
      expect(out).toBe(true);
    });

    it('returns true when user has super_admin role', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ role: 'super_admin' }] });

      const out = await projectsService.isUserAdmin('user-1');
      expect(out).toBe(true);
    });

    it('returns false when user has no admin role', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const out = await projectsService.isUserAdmin('user-1');
      expect(out).toBe(false);
    });
  });

  describe('updateOrganizationWebsite', () => {
    it('returns success when org updated', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'org-1', website_url: 'https://updated.com' }],
      });

      const out = await projectsService.updateOrganizationWebsite('user-1', 'https://updated.com');
      expect(out).toEqual({ success: true, organizationId: 'org-1' });
    });

    it('returns success false when no organization found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const out = await projectsService.updateOrganizationWebsite('user-1', 'https://x.com');
      expect(out).toEqual({ success: false, reason: 'No organization found' });
    });
  });

  describe('createProject', () => {
    it('creates project in database and returns ids', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const out = await projectsService.createProject('user-1', 'https://example.com', {
        businessName: 'Acme',
        businessType: 'SaaS',
        targetAudience: 'B2B',
        contentFocus: 'Product',
        brandVoice: 'Professional',
        brandColors: null,
        scenarios: [],
      });

      expect(out.success).toBe(true);
      expect(out.projectId).toBeDefined();
      expect(out.strategyId).toBeDefined();
      expect(out.message).toContain('successfully');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO projects'),
        expect.any(Array)
      );
    });

    it('creates content strategy when scenarios provided', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const out = await projectsService.createProject('user-1', 'https://example.com', {
        businessName: 'Acme',
        scenarios: ['Scenario A', 'Scenario B'],
      });

      expect(out.success).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO content_strategies'),
        expect.any(Array)
      );
    });
  });

  describe('getUserMostRecentAnalysis', () => {
    it('returns null when no userId', async () => {
      expect(await projectsService.getUserMostRecentAnalysis(null)).toBeNull();
      expect(await projectsService.getUserMostRecentAnalysis('')).toBeNull();
    });

    it('returns mapped project when db has row', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'proj-1',
          website_url: 'https://example.com',
          business_analysis: { name: 'Acme' },
          brand_colors: null,
          target_audience: null,
          content_focus: null,
          brand_voice: null,
          business_type: null,
          scenarios: ['a'],
          customer_psychology: null,
          keywords: [],
          description: null,
          decision_makers: null,
          end_users: null,
          business_model: null,
          website_goals: null,
          blog_strategy: null,
          search_behavior: null,
          connection_message: null,
          updated_at: new Date(),
          created_at: new Date(),
        }],
      });

      const out = await projectsService.getUserMostRecentAnalysis('user-1');
      expect(out).not.toBeNull();
      expect(out.id).toBe('proj-1');
      expect(out.websiteUrl).toBe('https://example.com');
      expect(out.scenarios).toEqual(['a']);
    });

    it('returns null when db has no rows', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      expect(await projectsService.getUserMostRecentAnalysis('user-1')).toBeNull();
    });
  });
});
