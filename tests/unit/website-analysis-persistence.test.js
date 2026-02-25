/**
 * Unit tests: website-analysis-persistence service (org resolution, data building, saveAnalysisResult).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveOrganization,
  buildOrganizationAndIntelligenceData,
  saveAnalysisResult,
  storeCTAs,
  getStoredCTAs
} from '../../services/website-analysis-persistence.js';

describe('website-analysis-persistence', () => {
  describe('resolveOrganization', () => {
    it('returns user_owned when user has an organization', async () => {
      const db = {
        query: vi.fn().mockResolvedValue({
          rows: [{ id: 'org-1', website_url: 'https://example.com' }]
        })
      };
      const result = await resolveOrganization(db, { userId: 'user-1', sessionId: null, url: 'https://example.com' });
      expect(result.organizationSource).toBe('user_owned');
      expect(result.existingOrganization).toEqual({ id: 'org-1', website_url: 'https://example.com' });
      expect(result.shouldAdoptAnonymousOrg).toBe(false);
    });

    it('returns anonymous_adoption when user has no org but anonymous org exists for URL', async () => {
      const db = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({
            rows: [{ id: 'anon-org', website_url: 'https://example.com' }]
          })
      };
      const result = await resolveOrganization(db, { userId: 'user-1', sessionId: null, url: 'https://example.com' });
      expect(result.organizationSource).toBe('anonymous_adoption');
      expect(result.shouldAdoptAnonymousOrg).toBe(true);
      expect(result.existingOrganization?.id).toBe('anon-org');
    });

    it('returns new_for_user when user has no org and no anonymous org for URL', async () => {
      const db = {
        query: vi.fn().mockResolvedValue({ rows: [] })
      };
      const result = await resolveOrganization(db, { userId: 'user-1', sessionId: null, url: 'https://example.com' });
      expect(result.organizationSource).toBe('new_for_user');
      expect(result.existingOrganization).toBeNull();
    });

    it('returns anonymous_session when no userId but session and anonymous org exists for URL', async () => {
      const db = {
        query: vi.fn().mockResolvedValue({
          rows: [{ id: 'anon-org', website_url: 'https://example.com' }]
        })
      };
      const result = await resolveOrganization(db, { userId: null, sessionId: 'sess-1', url: 'https://example.com' });
      expect(result.organizationSource).toBe('anonymous_session');
      expect(result.existingOrganization?.id).toBe('anon-org');
    });

    it('returns new_anonymous when no userId and no anonymous org for URL', async () => {
      const db = {
        query: vi.fn().mockResolvedValue({ rows: [] })
      };
      const result = await resolveOrganization(db, { userId: null, sessionId: 'sess-1', url: 'https://example.com' });
      expect(result.organizationSource).toBe('new_anonymous');
      expect(result.existingOrganization).toBeNull();
    });
  });

  describe('buildOrganizationAndIntelligenceData', () => {
    it('builds organizationData and intelligenceData from analysis and url', () => {
      const analysis = {
        businessName: 'Acme',
        businessType: 'B2B',
        targetAudience: 'Developers',
        customerScenarios: [{ title: 'S1' }]
      };
      const url = 'https://acme.com';
      const { organizationData, intelligenceData, organizationName, now } = buildOrganizationAndIntelligenceData(analysis, url);

      expect(organizationName).toBe('Acme');
      expect(organizationData.website_url).toBe(url);
      expect(organizationData.business_type).toBe('B2B');
      expect(organizationData.target_audience).toBe('Developers');
      expect(intelligenceData.customer_scenarios).toBe(JSON.stringify([{ title: 'S1' }]));
      expect(intelligenceData.analysis_confidence_score).toBe(0.75);
      expect(now).toBeInstanceOf(Date);
    });

    it('uses hostname for organization name when analysis has no businessName', () => {
      const { organizationName } = buildOrganizationAndIntelligenceData({}, 'https://foo.example.com/page');
      expect(organizationName).toBe('foo.example.com');
    });
  });

  describe('saveAnalysisResult', () => {
    it('returns null organizationId and empty CTAs when neither userId nor sessionId', async () => {
      const db = { query: vi.fn() };
      const result = await saveAnalysisResult(db, {
        userId: null,
        sessionId: null,
        url: 'https://example.com',
        analysis: {},
        ctas: []
      });
      expect(result.organizationId).toBeNull();
      expect(result.storedCTAs).toEqual([]);
      expect(result.ctaStoredCount).toBe(0);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('creates org and intelligence and returns organizationId when userId provided', async () => {
      const orgId = 'org-new-uuid';
      const db = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined)
      };
      vi.doMock('uuid', () => ({ v4: () => orgId }));

      const result = await saveAnalysisResult(db, {
        userId: 'user-1',
        sessionId: null,
        url: 'https://example.com',
        analysis: { businessName: 'Test', businessType: 'B2B' },
        ctas: []
      });

      expect(result.organizationId).toBeDefined();
      expect(result.storedCTAs).toEqual([]);
      expect(result.ctaStoredCount).toBe(0);
      expect(db.query).toHaveBeenCalled();
    });
  });

  describe('storeCTAs', () => {
    it('calls DELETE then INSERT and returns ctaStoredCount', async () => {
      const db = {
        query: vi.fn().mockResolvedValue({ rows: [] })
      };
      const ctas = [
        { text: 'Sign up', type: 'button', href: '/signup', placement: 'header' }
      ];
      const result = await storeCTAs(db, 'org-1', 'https://example.com', ctas);
      expect(result.ctaStoredCount).toBe(1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM cta_analysis'),
        ['org-1']
      );
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO cta_analysis'),
        expect.any(Array)
      );
    });
  });

  describe('getStoredCTAs', () => {
    it('returns rows from query with limit', async () => {
      const rows = [
        { id: '1', text: 'CTA 1', type: 'button', href: '/a', placement: 'header' }
      ];
      const db = {
        query: vi.fn().mockResolvedValue({ rows })
      };
      const result = await getStoredCTAs(db, 'org-1', 5);
      expect(result).toEqual(rows);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['org-1', 5]
      );
    });
  });
});
