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
});
