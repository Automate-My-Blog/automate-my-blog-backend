/**
 * Unit tests: Content service DB path (saveBlogPost -> saveBlogPostToDatabase).
 * Mocks database with testConnection resolving.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../services/database.js', () => ({
  default: {
    query: (...args) => mockQuery(...args),
    testConnection: vi.fn().mockResolvedValue(undefined),
  },
}));

let content;

beforeEach(async () => {
  vi.resetModules();
  mockQuery.mockReset();
  process.env.USE_DATABASE = 'true';
  const mod = await import('../../services/content.js');
  content = mod.default;
  await new Promise((r) => setTimeout(r, 20));
});

describe('content (DB path)', () => {
  describe('saveBlogPost', () => {
    it('saves to database and returns id, title, status, createdAt, updatedAt', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'post-uuid-1',
          title: 'DB Post',
          status: 'draft',
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      const out = await content.saveBlogPost('user-1', {
        title: 'DB Post',
        content: 'Body',
        topic: { name: 'Test' },
        businessInfo: {},
        status: 'draft',
      });

      expect(out.id).toBe('post-uuid-1');
      expect(out.title).toBe('DB Post');
      expect(out.status).toBe('draft');
      expect(out).toHaveProperty('createdAt');
      expect(out).toHaveProperty('updatedAt');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO blog_posts'),
        expect.any(Array)
      );
    });

    it('records generation history when generationMetadata provided', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 'p1', title: 'T', status: 'draft', created_at: new Date(), updated_at: new Date() }],
        })
        .mockResolvedValueOnce({ rows: [] });

      await content.saveBlogPost('user-1', {
        title: 'T',
        content: 'C',
        topic: {},
        businessInfo: {},
        generationMetadata: { tokensUsed: 100, generationTime: 50, aiModel: 'gpt-4' },
        status: 'draft',
      });

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('INSERT INTO blog_posts'), expect.any(Array));
      expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('generation_history'), expect.any(Array));
    });

    it('falls back to memory when db insert throws with database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('database connection failed'));

      const out = await content.saveBlogPost('user-1', {
        title: 'Fallback',
        content: 'X',
        topic: {},
        businessInfo: {},
        status: 'draft',
      });

      expect(out.id).toBeDefined();
      expect(out.title).toBe('Fallback');
      expect(out.status).toBe('draft');
    });
  });

  describe('getBlogPost', () => {
    it('returns mapped post from database when found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'bp-1',
          title: 'From DB',
          content: 'Body',
          status: 'published',
          word_count: 1,
          export_count: 0,
          topic_data: { name: 'X' },
          business_context: {},
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      const post = await content.getBlogPost('bp-1', 'user-1');
      expect(post.id).toBe('bp-1');
      expect(post.title).toBe('From DB');
      expect(post.content).toBe('Body');
      expect(post.status).toBe('published');
      expect(post.wordCount).toBe(1);
    });
  });

  describe('getUserBlogPosts', () => {
    it('returns posts and total from database', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { id: 'p1', title: 'T1', content_preview: 'C1', status: 'draft', word_count: 1, export_count: 0, topic_data: null, business_context: null, created_at: new Date(), updated_at: new Date() },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ total: '1' }] });

      const out = await content.getUserBlogPosts('user-1', { limit: 25, offset: 0, status: 'all', sortBy: 'created_at', order: 'DESC' });
      expect(out.posts).toHaveLength(1);
      expect(out.posts[0].title).toBe('T1');
      expect(out.total).toBe(1);
      expect(out.limit).toBe(25);
      expect(out.offset).toBe(0);
      expect(out.hasMore).toBe(false);
    });
  });

  describe('updateBlogPost', () => {
    it('updates in database and returns row', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'bp-1', title: 'Updated', status: 'published', updated_at: new Date() }],
      });

      const out = await content.updateBlogPost('bp-1', 'user-1', { title: 'Updated', status: 'published' });
      expect(out.title).toBe('Updated');
      expect(out.status).toBe('published');
    });
  });

  describe('deleteBlogPost', () => {
    it('soft-deletes in database and returns success', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'bp-1' }] });

      const out = await content.deleteBlogPost('bp-1', 'user-1');
      expect(out.success).toBe(true);
    });
  });
});
