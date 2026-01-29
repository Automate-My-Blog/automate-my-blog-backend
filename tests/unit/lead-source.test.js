import { describe, it, expect } from 'vitest';
import { deriveLeadSourceFromReferrer } from '../../utils/lead-source.js';

describe('lead-source', () => {
  describe('deriveLeadSourceFromReferrer', () => {
    it('returns website_analysis when referrer is null or undefined', () => {
      expect(deriveLeadSourceFromReferrer(null)).toBe('website_analysis');
      expect(deriveLeadSourceFromReferrer(undefined)).toBe('website_analysis');
    });

    it('returns website_analysis when referrer is empty string', () => {
      expect(deriveLeadSourceFromReferrer('')).toBe('website_analysis');
    });

    it('returns organic_search for Google', () => {
      expect(deriveLeadSourceFromReferrer('https://www.google.com/search?q=test')).toBe('organic_search');
      expect(deriveLeadSourceFromReferrer('https://google.com')).toBe('organic_search');
    });

    it('returns organic_search for Bing', () => {
      expect(deriveLeadSourceFromReferrer('https://www.bing.com/search?q=test')).toBe('organic_search');
      expect(deriveLeadSourceFromReferrer('https://bing.com')).toBe('organic_search');
    });

    it('returns social for Facebook and LinkedIn', () => {
      expect(deriveLeadSourceFromReferrer('https://www.facebook.com/page')).toBe('social');
      expect(deriveLeadSourceFromReferrer('https://linkedin.com/feed')).toBe('social');
    });

    it('returns referral when from automatemyblog.com with ?ref= or &ref=', () => {
      expect(deriveLeadSourceFromReferrer('https://automatemyblog.com/?ref=ABC123')).toBe('referral');
      expect(deriveLeadSourceFromReferrer('https://automatemyblog.com/pricing&ref=XYZ')).toBe('referral');
    });

    it('returns direct when from automatemyblog.com without ref param', () => {
      expect(deriveLeadSourceFromReferrer('https://automatemyblog.com/')).toBe('direct');
      expect(deriveLeadSourceFromReferrer('https://automatemyblog.com/pricing')).toBe('direct');
    });

    it('returns referral for other external domains', () => {
      expect(deriveLeadSourceFromReferrer('https://example.com')).toBe('referral');
      expect(deriveLeadSourceFromReferrer('https://twitter.com/share')).toBe('referral');
    });
  });
});
