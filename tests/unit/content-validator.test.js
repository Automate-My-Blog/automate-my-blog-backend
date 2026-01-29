import { describe, it, expect } from 'vitest';
import contentValidator from '../../services/content-validator.js';
import { contentFixtures, ctaFixtures } from '../utils/fixtures.js';
import { withMockedConsole } from '../utils/mocks.js';

const {
  extractURLs,
  isPlaceholderURL,
  validateGeneratedContent,
  removePlaceholderLinks,
  getValidationSummary,
} = contentValidator;

describe('content-validator', () => {
  describe('extractURLs', () => {
    it('returns empty array for empty or missing content', () => {
      expect(extractURLs('')).toEqual([]);
      expect(extractURLs(null)).toEqual([]);
      expect(extractURLs(undefined)).toEqual([]);
    });

    it('extracts markdown links [text](url)', () => {
      const urls = extractURLs(contentFixtures.markdownOnly);
      expect(urls).toHaveLength(1);
      expect(urls[0].url).toBe('https://example.com/docs');
      expect(urls[0].text).toBe('our docs');
      expect(urls[0].type).toBe('markdown');
    });

    it('extracts HTML <a href="..."> links', () => {
      const urls = extractURLs(contentFixtures.htmlOnly);
      expect(urls).toHaveLength(1);
      expect(urls[0].url).toBe('https://example.com');
      expect(urls[0].type).toBe('html');
    });

    it('extracts bare http(s) URLs', () => {
      const urls = extractURLs(contentFixtures.bareUrls);
      expect(urls.length).toBeGreaterThanOrEqual(2);
      expect(urls.some((u) => u.url === 'https://example.com' && u.type === 'bare')).toBe(true);
      // Trailing period may be included by regex
      expect(urls.some((u) => u.url.startsWith('https://other.com') && u.type === 'bare')).toBe(true);
    });

    it('does not duplicate URLs already in markdown/HTML when also bare', () => {
      const content = 'Check [link](https://example.com) and https://example.com';
      const urls = extractURLs(content);
      const matched = urls.filter((u) => u.url === 'https://example.com');
      expect(matched.length).toBe(1);
    });

    it('extracts from mixed content', () => {
      const urls = extractURLs(contentFixtures.mixed);
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.some((u) => u.url.includes('example.com'))).toBe(true);
    });

    it('returns empty for content with no URLs', () => {
      expect(extractURLs(contentFixtures.noUrls)).toEqual([]);
    });
  });

  describe('isPlaceholderURL', () => {
    it('returns true for placeholder patterns', () => {
      expect(isPlaceholderURL('https://yourwebsite.com/page')).toBe(true);
      expect(isPlaceholderURL('https://example.com')).toBe(true);
      expect(isPlaceholderURL('https://yourdomain.com')).toBe(true);
      expect(isPlaceholderURL('https://foo.com/your-website')).toBe(true);
      expect(isPlaceholderURL('https://x.com/[insert url]')).toBe(true);
      expect(isPlaceholderURL('https://x.com/[your url]')).toBe(true);
      expect(isPlaceholderURL('https://placeholder.com')).toBe(true);
      expect(isPlaceholderURL('https://xxx.com')).toBe(true);
    });

    it('returns false for real URLs', () => {
      expect(isPlaceholderURL('https://example.org/real')).toBe(false);
      expect(isPlaceholderURL('https://mycompany.com')).toBe(false);
      expect(isPlaceholderURL('/about')).toBe(false);
    });
  });

  describe('validateGeneratedContent', () => {
    it('validates clean content with no issues', async () => {
      // Use non-placeholder URLs (example.com is treated as placeholder)
      const content = 'Check [our site](https://realcompany.org) and [relative](/about).';
      const allowedCTAs = [{ href: 'https://realcompany.org' }];
      const allowedInternal = [{ target_url: '/about' }];
      const result = await withMockedConsole(() =>
        validateGeneratedContent(content, allowedCTAs, allowedInternal)
      );
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.stats.approved_urls).toBe(2);
      expect(result.stats.placeholder_urls).toBe(0);
      expect(result.stats.unapproved_urls).toBe(0);
    });

    it('flags placeholder URLs as high severity', async () => {
      const content = contentFixtures.placeholder;
      const result = await withMockedConsole(() =>
        validateGeneratedContent(content, [], [])
      );
      expect(result.valid).toBe(false);
      const placeholderIssues = result.issues.filter((i) => i.type === 'placeholder');
      expect(placeholderIssues.length).toBeGreaterThan(0);
      expect(placeholderIssues.every((i) => i.severity === 'high')).toBe(true);
      expect(result.stats.placeholder_urls).toBeGreaterThan(0);
    });

    it('approves relative URLs', async () => {
      const content = contentFixtures.relative;
      const result = await withMockedConsole(() =>
        validateGeneratedContent(content, [], [])
      );
      expect(result.stats.approved_urls).toBeGreaterThan(0);
      const relativeIssues = result.issues.filter(
        (i) => i.message && i.message.includes('relative')
      );
      expect(relativeIssues.length).toBe(0);
    });

    it('approves mailto and tel links', async () => {
      const content = contentFixtures.mailtoTel;
      const result = await withMockedConsole(() =>
        validateGeneratedContent(content, [], [])
      );
      expect(result.stats.approved_urls).toBeGreaterThan(0);
    });

    it('approves authoritative domains (e.g. nih.gov, cdc.gov)', async () => {
      const content = contentFixtures.authoritative;
      const result = await withMockedConsole(() =>
        validateGeneratedContent(content, [], [])
      );
      expect(result.stats.approved_urls).toBeGreaterThan(0);
    });

    it('returns valid summary string', async () => {
      const content = 'Text [a](https://example.com).';
      const result = await withMockedConsole(() =>
        validateGeneratedContent(content, [{ href: 'https://example.com' }], [])
      );
      expect(result.summary).toBeDefined();
      expect(typeof result.summary).toBe('string');
    });
  });

  describe('removePlaceholderLinks', () => {
    it('returns content unchanged when empty or no placeholders', () => {
      expect(removePlaceholderLinks('')).toBe('');
      expect(removePlaceholderLinks(null)).toBe(null);
      expect(removePlaceholderLinks(contentFixtures.noUrls)).toBe(contentFixtures.noUrls);
    });

    it('removes markdown placeholder links but keeps link text', () => {
      const content = 'Sign up at [your site](https://yourwebsite.com) today.';
      const out = removePlaceholderLinks(content);
      expect(out).not.toContain('https://yourwebsite.com');
      expect(out).not.toMatch(/\[.*\]\(.*\)/);
      expect(out).toContain('your site');
    });

    it('removes HTML placeholder links but keeps inner text', () => {
      const content = '<a href="https://yourwebsite.com">Click here</a>';
      const out = removePlaceholderLinks(content);
      expect(out).not.toContain('https://yourwebsite.com');
      expect(out).not.toContain('<a ');
      expect(out).toContain('Click here');
    });
  });

  describe('getValidationSummary', () => {
    it('returns "No validation performed" for null/undefined', () => {
      expect(getValidationSummary(null)).toBe('No validation performed');
      expect(getValidationSummary(undefined)).toBe('No validation performed');
    });

    it('returns clean summary when valid and no issues', () => {
      const validation = {
        valid: true,
        issues: [],
        stats: { total_urls: 3, approved_urls: 3 },
      };
      const s = getValidationSummary(validation);
      expect(s).toContain('clean');
      expect(s).toContain('3');
    });

    it('returns issue summary when there are high/medium issues', () => {
      const validation = {
        valid: false,
        issues: [
          { severity: 'high' },
          { severity: 'medium' },
        ],
        stats: { total_urls: 5 },
      };
      const s = getValidationSummary(validation);
      expect(s).toContain('critical');
      expect(s).toContain('medium');
      expect(s).toContain('5');
    });
  });
});
