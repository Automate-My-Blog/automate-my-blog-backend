import { describe, it, expect, vi } from 'vitest';

vi.mock('../../services/database.js', () => ({
  default: {
    query: vi.fn(),
    transaction: vi.fn((fn) => fn({ query: vi.fn() })),
    testConnection: vi.fn().mockRejectedValue(new Error('mock')),
  },
}));

import projectsService from '../../services/projects.js';

describe('projects', () => {
  describe('isAnalysisFresh', () => {
    it('returns false when updatedAt is null or undefined', () => {
      expect(projectsService.isAnalysisFresh(null)).toBe(false);
      expect(projectsService.isAnalysisFresh(undefined)).toBe(false);
    });

    it('returns true when updatedAt is within maxAgeDays', () => {
      const recent = new Date();
      recent.setDate(recent.getDate() - 5);
      expect(projectsService.isAnalysisFresh(recent, 30)).toBe(true);
      expect(projectsService.isAnalysisFresh(recent.toISOString(), 30)).toBe(true);
    });

    it('returns false when updatedAt is older than maxAgeDays', () => {
      const old = new Date();
      old.setDate(old.getDate() - 40);
      expect(projectsService.isAnalysisFresh(old, 30)).toBe(false);
      expect(projectsService.isAnalysisFresh(old.toISOString(), 30)).toBe(false);
    });

    it('uses default maxAgeDays of 30', () => {
      const d = new Date();
      d.setDate(d.getDate() - 15);
      expect(projectsService.isAnalysisFresh(d)).toBe(true);
      d.setDate(d.getDate() - 20); // 35 days ago
      expect(projectsService.isAnalysisFresh(d)).toBe(false);
    });

    it('treats as fresh when just under maxAgeDays, stale when just over', () => {
      const d29 = new Date();
      d29.setDate(d29.getDate() - 29);
      expect(projectsService.isAnalysisFresh(d29, 30)).toBe(true);
      const d31 = new Date();
      d31.setDate(d31.getDate() - 31);
      expect(projectsService.isAnalysisFresh(d31, 30)).toBe(false);
    });
  });

  describe('getProjectByUserAndUrl', () => {
    it('returns null when userId or websiteUrl missing', async () => {
      expect(await projectsService.getProjectByUserAndUrl(null, 'https://a.com')).toBeNull();
      expect(await projectsService.getProjectByUserAndUrl('u1', '')).toBeNull();
      expect(await projectsService.getProjectByUserAndUrl('', 'https://a.com')).toBeNull();
    });

    it('returns null when no project in memory fallback', async () => {
      const out = await projectsService.getProjectByUserAndUrl('user-1', 'https://example.com');
      expect(out).toBeNull();
    });
  });

  describe('isUserAdmin', () => {
    it('returns false when database unavailable (memory fallback)', async () => {
      expect(await projectsService.isUserAdmin('user-1')).toBe(false);
    });
  });

  describe('createProject (memory)', () => {
    it('stores project in memory and returns ids', async () => {
      const out = await projectsService.createProject('user-1', 'https://example.com', {
        businessName: 'Acme',
        scenarios: [],
      });
      expect(out.success).toBe(true);
      expect(out.projectId).toBeDefined();
      expect(out.strategyId).toBeDefined();
      expect(out.message).toContain('memory');
      const got = await projectsService.getProjectByUserAndUrl('user-1', 'https://example.com');
      expect(got).not.toBeNull();
      expect(got.websiteUrl).toBe('https://example.com');
    });
  });

  describe('getUserMostRecentAnalysis (memory)', () => {
    it('returns null when no projects for user', async () => {
      expect(await projectsService.getUserMostRecentAnalysis('user-no-projects')).toBeNull();
    });

    it('returns most recent project when present', async () => {
      await projectsService.createProject('user-2', 'https://example.com', { businessName: 'Acme', scenarios: [] });
      const out = await projectsService.getUserMostRecentAnalysis('user-2');
      expect(out).not.toBeNull();
      expect(out.websiteUrl).toBe('https://example.com');
    });
  });
});
