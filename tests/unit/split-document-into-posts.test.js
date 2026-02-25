/**
 * Unit tests for split-document-into-posts utility.
 * Used by voice-samples upload when documents contain multiple posts (e.g. newsletter with date headers).
 */
import { describe, it, expect } from 'vitest';
import {
  splitDocumentIntoPosts,
  isLikelyMultiPostDocument,
} from '../../utils/split-document-into-posts.js';

describe('split-document-into-posts', () => {
  describe('splitDocumentIntoPosts', () => {
    it('returns empty array for null or undefined', () => {
      expect(splitDocumentIntoPosts(null)).toEqual([]);
      expect(splitDocumentIntoPosts(undefined)).toEqual([]);
    });

    it('returns empty array for empty or whitespace-only string', () => {
      expect(splitDocumentIntoPosts('')).toEqual([]);
      expect(splitDocumentIntoPosts('   \n\t  ')).toEqual([]);
    });

    it('returns single post when no date headers and content >= minWords', () => {
      const text = 'Hello world. '.repeat(80);
      const posts = splitDocumentIntoPosts(text);
      expect(posts).toHaveLength(1);
      expect(posts[0].date).toBe('');
      expect(posts[0].wordCount).toBeGreaterThanOrEqual(150);
      expect(posts[0].body).toBe(text.trim());
    });

    it('returns empty array when content below minWords and no dates', () => {
      const text = 'Short doc.';
      const posts = splitDocumentIntoPosts(text);
      expect(posts).toEqual([]);
    });

    it('splits on date headers like "February 8, 2026"', () => {
      const chunk1 = 'Hello and Happy Sunday. This is the first post. We have raised 6 funds. ';
      const chunk2 = 'Second post intro. Another week of founder meetings. More milestones to share. ';
      const text = `Preamble here.

February 8, 2026
${chunk1.repeat(35)}

February 15, 2026
${chunk2.repeat(35)}`;

      const posts = splitDocumentIntoPosts(text);
      expect(posts.length).toBeGreaterThanOrEqual(2);
      expect(posts[0].date).toMatch(/February|february/i);
      expect(posts[0].body).toContain('Hello and Happy Sunday');
      expect(posts[0].wordCount).toBeGreaterThanOrEqual(150);
      expect(posts[1].body).toContain('Second post');
      expect(posts[1].wordCount).toBeGreaterThanOrEqual(150);
    });

    it('uses custom minWords when provided', () => {
      const text = 'Short. '.repeat(20);
      expect(splitDocumentIntoPosts(text, 200)).toEqual([]);
      expect(splitDocumentIntoPosts(text, 5)).toHaveLength(1);
    });

    it('filters out chunks below minWords', () => {
      const text = `February 1, 2026
Tiny.

February 8, 2026
${'This is a valid post with enough words to exceed the minimum. '.repeat(20)}`;
      const posts = splitDocumentIntoPosts(text);
      expect(posts).toHaveLength(1);
      expect(posts[0].date).toMatch(/February/);
      expect(posts[0].body).toContain('valid post');
    });
  });

  describe('isLikelyMultiPostDocument', () => {
    it('returns false for empty or short text', () => {
      expect(isLikelyMultiPostDocument('')).toBe(false);
      expect(isLikelyMultiPostDocument('Short.')).toBe(false);
    });

    it('returns false when single post (no date headers)', () => {
      expect(isLikelyMultiPostDocument('Hello world. '.repeat(60))).toBe(false);
    });

    it('returns true when multiple posts detected', () => {
      const multiPost = `February 8, 2026
${'First post content here. '.repeat(40)}

March 15, 2026
${'Second post content here. '.repeat(40)}`;
      expect(isLikelyMultiPostDocument(multiPost)).toBe(true);
    });
  });
});
