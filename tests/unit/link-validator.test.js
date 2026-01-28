import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import linkValidator from '../../services/link-validator.js';
import { validationResultFixtures, linkFixtures } from '../utils/fixtures.js';

const { validateLinks, getValidationStatusMessage, validateOrganizationCTAs } = linkValidator;

describe('link-validator', () => {
  describe('getValidationStatusMessage', () => {
    it('returns "Link validation not performed" when result is null or missing results', () => {
      expect(getValidationStatusMessage(null)).toBe('Link validation not performed');
      expect(getValidationStatusMessage(undefined)).toBe('Link validation not performed');
      expect(getValidationStatusMessage({})).toBe('Link validation not performed');
      expect(getValidationStatusMessage({ results: null })).toBe('Link validation not performed');
    });

    it('returns success message when all links valid', () => {
      const msg = getValidationStatusMessage(validationResultFixtures.allValid);
      expect(msg).toContain('All');
      expect(msg).toContain('working');
      expect(msg).toContain('2');
      expect(msg).toContain('link');
    });

    it('uses singular "link" when exactly one', () => {
      const msg = getValidationStatusMessage({ results: [{ href: '/a', valid: true }] });
      expect(msg).toMatch(/1 link.*working/);
      expect(msg).not.toMatch(/1 links/);
    });

    it('returns warning when some links invalid', () => {
      const msg = getValidationStatusMessage(validationResultFixtures.someInvalid);
      expect(msg).toMatch(/⚠️|issues/);
      expect(msg).toContain('1');
      expect(msg).toContain('2');
    });

    it('handles empty results', () => {
      const msg = getValidationStatusMessage(validationResultFixtures.empty);
      expect(msg).toContain('All');
      expect(msg).toContain('0');
    });

    it('handles all invalid', () => {
      const msg = getValidationStatusMessage(validationResultFixtures.singleInvalid);
      expect(msg).toContain('1');
      expect(msg).not.toContain('All');
    });
  });

  describe('validateLinks', () => {
    it('returns all_valid true and empty invalid_links for empty input', async () => {
      const result = await validateLinks([]);
      expect(result.all_valid).toBe(true);
      expect(result.invalid_links).toEqual([]);
      expect(result.results).toEqual([]);
    });

    it('returns all_valid true for null/empty links', async () => {
      const result = await validateLinks(null);
      expect(result.all_valid).toBe(true);
      expect(result.invalid_links).toEqual([]);
      expect(result.results).toEqual([]);
    });
  });

  describe('validateLinks with mocked axios', () => {
    it('marks relative URLs as valid without HTTP request', async () => {
      const headSpy = vi.spyOn(axios, 'head').mockRejectedValue(new Error('should not be called'));
      try {
        const result = await validateLinks([linkFixtures.relative]);
        expect(result.all_valid).toBe(true);
        expect(result.results).toHaveLength(1);
        expect(result.results[0].valid).toBe(true);
        expect(result.results[0].status).toBe('relative');
        expect(headSpy).not.toHaveBeenCalled();
      } finally {
        headSpy.mockRestore();
      }
    });

    it('marks mailto and tel as valid without HTTP request', async () => {
      const headSpy = vi.spyOn(axios, 'head').mockRejectedValue(new Error('should not be called'));
      try {
        const result = await validateLinks([linkFixtures.mailto, linkFixtures.tel]);
        expect(result.all_valid).toBe(true);
        expect(result.results).toHaveLength(2);
        expect(result.results[0].valid).toBe(true);
        expect(result.results[0].status).toBe('special');
        expect(result.results[1].valid).toBe(true);
        expect(result.results[1].status).toBe('special');
        expect(headSpy).not.toHaveBeenCalled();
      } finally {
        headSpy.mockRestore();
      }
    });

    it('marks anchor links as valid without HTTP request', async () => {
      const headSpy = vi.spyOn(axios, 'head').mockRejectedValue(new Error('should not be called'));
      try {
        const result = await validateLinks([linkFixtures.anchor]);
        expect(result.all_valid).toBe(true);
        expect(result.results[0].valid).toBe(true);
        expect(result.results[0].status).toBe('anchor');
        expect(headSpy).not.toHaveBeenCalled();
      } finally {
        headSpy.mockRestore();
      }
    });

    it('returns invalid when link has no href or target_url', async () => {
      const result = await validateLinks([linkFixtures.noHref]);
      expect(result.all_valid).toBe(false);
      expect(result.results[0].valid).toBe(false);
      expect(result.results[0].error).toBe('No URL provided');
    });

    it('uses target_url when href missing', async () => {
      const headSpy = vi.spyOn(axios, 'head').mockResolvedValue({ status: 200 });
      try {
        const result = await validateLinks([linkFixtures.targetUrl]);
        expect(result.results[0].href).toBe('https://example.com/alt');
        expect(headSpy).toHaveBeenCalled();
      } finally {
        headSpy.mockRestore();
      }
    });

    it('uses url when href and target_url missing', async () => {
      const headSpy = vi.spyOn(axios, 'head').mockResolvedValue({ status: 200 });
      try {
        const result = await validateLinks([linkFixtures.urlOnly]);
        expect(result.all_valid).toBe(true);
        expect(result.results[0].href).toBe('https://example.com/url-only');
        expect(headSpy).toHaveBeenCalled();
      } finally {
        headSpy.mockRestore();
      }
    });

    it('validates absolute URLs via HEAD and records success', async () => {
      const headSpy = vi.spyOn(axios, 'head').mockResolvedValue({ status: 200 });
      try {
        const result = await validateLinks([linkFixtures.absolute]);
        expect(result.all_valid).toBe(true);
        expect(result.results[0].valid).toBe(true);
        expect(result.results[0].status).toBe(200);
        expect(headSpy).toHaveBeenCalledWith(
          'https://example.com/page',
          expect.objectContaining({
            timeout: 5000,
            validateStatus: expect.any(Function),
          })
        );
      } finally {
        headSpy.mockRestore();
      }
    });

    it('records invalid when HEAD returns 4xx', async () => {
      const headSpy = vi.spyOn(axios, 'head').mockResolvedValue({ status: 404 });
      try {
        const result = await validateLinks([linkFixtures.absolute]);
        expect(result.all_valid).toBe(false);
        expect(result.results[0].valid).toBe(false);
        expect(result.results[0].status).toBe(404);
      } finally {
        headSpy.mockRestore();
      }
    });

    it('records invalid on network error (ENOTFOUND, ETIMEDOUT, etc.)', async () => {
      const err = Object.assign(new Error('fail'), { code: 'ENOTFOUND' });
      const headSpy = vi.spyOn(axios, 'head').mockRejectedValue(err);
      const getSpy = vi.spyOn(axios, 'get').mockRejectedValue(new Error('get fail'));
      try {
        const result = await validateLinks([linkFixtures.absolute]);
        expect(result.all_valid).toBe(false);
        expect(result.results[0].valid).toBe(false);
        expect(result.results[0].error).toBe('Domain not found');
      } finally {
        headSpy.mockRestore();
        getSpy.mockRestore();
      }
    });

    it('uses GET fallback when HEAD fails and GET succeeds', async () => {
      const headSpy = vi.spyOn(axios, 'head').mockRejectedValue(new Error('HEAD not supported'));
      const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({
        status: 200,
        data: { destroy: vi.fn() },
      });
      try {
        const result = await validateLinks([linkFixtures.absolute]);
        expect(result.all_valid).toBe(true);
        expect(result.results[0].valid).toBe(true);
        expect(result.results[0].status).toBe(200);
        expect(headSpy).toHaveBeenCalled();
        expect(getSpy).toHaveBeenCalled();
      } finally {
        headSpy.mockRestore();
        getSpy.mockRestore();
      }
    });
  });

  describe('validateOrganizationCTAs', () => {
    it('returns success when no CTAs to validate', async () => {
      const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) };
      const out = await validateOrganizationCTAs('org-1', mockDb);
      expect(out.success).toBe(true);
      expect(out.all_valid).toBe(true);
      expect(out.invalid_count).toBe(0);
      expect(out.message).toContain('No CTAs');
    });

    it('validates org CTAs via db and returns all valid', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue({
          rows: [
            { id: 1, cta_text: 'Sign Up', href: '/signup', cta_type: 'button', placement: 'header' },
            { id: 2, cta_text: 'Contact', href: 'mailto:hi@example.com', cta_type: 'link', placement: 'footer' },
          ],
        }),
      };
      const out = await validateOrganizationCTAs('org-1', mockDb);
      expect(out.success).toBe(true);
      expect(out.all_valid).toBe(true);
      expect(out.invalid_count).toBe(0);
      expect(out.message).toMatch(/All 2 CTAs/);
    });

    it('returns success false when db.query throws', async () => {
      const mockDb = { query: vi.fn().mockRejectedValue(new Error('Connection refused')) };
      const out = await validateOrganizationCTAs('org-1', mockDb);
      expect(out.success).toBe(false);
      expect(out.all_valid).toBe(false);
      expect(out.error).toContain('Connection refused');
    });
  });
});
