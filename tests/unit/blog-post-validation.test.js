/**
 * Unit tests: blog post validation (create and update body).
 */
import { describe, it, expect } from 'vitest';
import { validateCreateBlogPostBody, validateUpdateBlogPostBody } from '../../lib/blog-post-validation.js';
import { ValidationError } from '../../lib/errors.js';

describe('lib/blog-post-validation', () => {
  describe('validateCreateBlogPostBody', () => {
    it('returns parsed fields when title and content provided', () => {
      const out = validateCreateBlogPostBody({
        title: ' My Title ',
        content: 'Body text',
        topic: { id: 't1' },
        businessInfo: {},
        status: 'draft',
      });
      expect(out).toEqual({
        title: 'My Title',
        content: 'Body text',
        topic: { id: 't1' },
        businessInfo: {},
        status: 'draft',
      });
    });

    it('defaults status to draft when omitted', () => {
      const out = validateCreateBlogPostBody({ title: 'T', content: 'C' });
      expect(out.status).toBe('draft');
    });

    it('throws ValidationError when title missing', () => {
      expect(() => validateCreateBlogPostBody({ content: 'C' })).toThrow(ValidationError);
      try {
        validateCreateBlogPostBody({ content: 'C' });
      } catch (e) {
        expect(e.details).toBe('title and content are required');
      }
    });

    it('throws ValidationError when content missing', () => {
      expect(() => validateCreateBlogPostBody({ title: 'T' })).toThrow(ValidationError);
      try {
        validateCreateBlogPostBody({ title: 'T' });
      } catch (e) {
        expect(e.details).toBe('title and content are required');
      }
    });

    it('throws ValidationError when title is empty string', () => {
      expect(() => validateCreateBlogPostBody({ title: '  ', content: 'C' })).toThrow(ValidationError);
    });

    it('throws ValidationError when body is null or undefined', () => {
      expect(() => validateCreateBlogPostBody(null)).toThrow(ValidationError);
      expect(() => validateCreateBlogPostBody(undefined)).toThrow(ValidationError);
    });
  });

  describe('validateUpdateBlogPostBody', () => {
    it('returns only provided fields', () => {
      expect(validateUpdateBlogPostBody({ title: 'New' })).toEqual({ title: 'New' });
      expect(validateUpdateBlogPostBody({ content: 'New' })).toEqual({ content: 'New' });
      expect(validateUpdateBlogPostBody({ status: 'published' })).toEqual({ status: 'published' });
      expect(validateUpdateBlogPostBody({ title: 'A', content: 'B', status: 'draft' })).toEqual({
        title: 'A',
        content: 'B',
        status: 'draft',
      });
    });

    it('throws ValidationError when no updatable fields provided', () => {
      expect(() => validateUpdateBlogPostBody({})).toThrow(ValidationError);
      try {
        validateUpdateBlogPostBody({});
      } catch (e) {
        expect(e.details).toContain('At least one field');
      }
      expect(() => validateUpdateBlogPostBody({ other: 'x' })).toThrow(ValidationError);
    });

    it('throws ValidationError when body is null or undefined', () => {
      expect(() => validateUpdateBlogPostBody(null)).toThrow(ValidationError);
      expect(() => validateUpdateBlogPostBody(undefined)).toThrow(ValidationError);
    });
  });
});
