/**
 * Unit tests: Content service (memory fallback path).
 * Mocks database; testConnection rejects so we use in-memory storage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/database.js', () => ({
  default: {
    query: vi.fn(),
    testConnection: vi.fn().mockRejectedValue(new Error('mock')),
  },
}));

let content;

beforeEach(async () => {
  vi.resetModules();
  process.env.USE_DATABASE = '';
  const mod = await import('../../services/content.js');
  content = mod.default;
});

describe('content', () => {
  describe('saveBlogPost (memory)', () => {
    it('saves post to memory and returns id, title, status, createdAt, updatedAt', async () => {
      const data = {
        title: 'Test Post',
        content: 'Hello world.',
        topic: { name: 'Testing' },
        businessInfo: { name: 'Acme' },
        status: 'draft',
      };
      const out = await content.saveBlogPost('user-1', data);
      expect(out).toHaveProperty('id');
      expect(out.title).toBe('Test Post');
      expect(out.status).toBe('draft');
      expect(out).toHaveProperty('createdAt');
      expect(out).toHaveProperty('updatedAt');
    });
  });

  describe('getUserBlogPosts (memory)', () => {
    it('returns saved posts for user with pagination', async () => {
      await content.saveBlogPost('user-1', {
        title: 'First',
        content: 'A',
        topic: {},
        businessInfo: {},
        status: 'draft',
      });
      await content.saveBlogPost('user-1', {
        title: 'Second',
        content: 'B',
        topic: {},
        businessInfo: {},
        status: 'published',
      });

      const page1 = await content.getUserBlogPosts('user-1', { limit: 1, offset: 0, status: 'all' });
      expect(page1.posts).toHaveLength(1);
      expect(page1.total).toBe(2);
      expect(page1.limit).toBe(1);
      expect(page1.offset).toBe(0);
      expect(page1.hasMore).toBe(true);

      const page2 = await content.getUserBlogPosts('user-1', { limit: 1, offset: 1, status: 'all' });
      expect(page2.posts).toHaveLength(1);
      expect(page2.hasMore).toBe(false);
    });

    it('filters by status', async () => {
      await content.saveBlogPost('user-1', {
        title: 'Draft',
        content: 'X',
        topic: {},
        businessInfo: {},
        status: 'draft',
      });
      await content.saveBlogPost('user-1', {
        title: 'Pub',
        content: 'Y',
        topic: {},
        businessInfo: {},
        status: 'published',
      });

      const drafts = await content.getUserBlogPosts('user-1', { limit: 25, offset: 0, status: 'draft' });
      expect(drafts.posts).toHaveLength(1);
      expect(drafts.posts[0].title).toBe('Draft');
      expect(drafts.posts[0].status).toBe('draft');

      const pub = await content.getUserBlogPosts('user-1', { limit: 25, offset: 0, status: 'published' });
      expect(pub.posts).toHaveLength(1);
      expect(pub.posts[0].status).toBe('published');
    });

    it('filters by search', async () => {
      await content.saveBlogPost('user-1', {
        title: 'Alpha Beta',
        content: 'X',
        topic: {},
        businessInfo: {},
        status: 'draft',
      });
      await content.saveBlogPost('user-1', {
        title: 'Alpha Gamma',
        content: 'Y',
        topic: {},
        businessInfo: {},
        status: 'draft',
      });
      await content.saveBlogPost('user-1', {
        title: 'Delta',
        content: 'Z',
        topic: {},
        businessInfo: {},
        status: 'draft',
      });

      const search = await content.getUserBlogPosts('user-1', { limit: 25, offset: 0, status: 'all', search: 'Alpha' });
      expect(search.posts).toHaveLength(2);
      expect(search.posts.every((p) => p.title.toLowerCase().includes('alpha'))).toBe(true);
    });

    it('returns only posts for given user', async () => {
      await content.saveBlogPost('user-A', {
        title: 'A',
        content: 'A',
        topic: {},
        businessInfo: {},
        status: 'draft',
      });
      await content.saveBlogPost('user-B', {
        title: 'B',
        content: 'B',
        topic: {},
        businessInfo: {},
        status: 'draft',
      });

      const forA = await content.getUserBlogPosts('user-A', { limit: 25, offset: 0, status: 'all' });
      expect(forA.posts).toHaveLength(1);
      expect(forA.posts[0].title).toBe('A');
    });
  });

  describe('getBlogPost (memory)', () => {
    it('returns post by id for user', async () => {
      const saved = await content.saveBlogPost('user-1', {
        title: 'Single',
        content: 'Body',
        topic: {},
        businessInfo: {},
        status: 'draft',
      });
      const post = await content.getBlogPost(saved.id, 'user-1');
      expect(post.title).toBe('Single');
      expect(post.content).toBe('Body');
      expect(post.status).toBe('draft');
    });

    it('throws when post not found', async () => {
      await expect(
        content.getBlogPost('non-existent-id', 'user-1')
      ).rejects.toThrow('Blog post not found');
    });
  });

  describe('updateBlogPost (memory)', () => {
    it('updates title, content, status and returns updated post', async () => {
      const saved = await content.saveBlogPost('user-1', {
        title: 'Original',
        content: 'Old',
        topic: {},
        businessInfo: {},
        status: 'draft',
      });
      const out = await content.updateBlogPost(saved.id, 'user-1', {
        title: 'Updated',
        content: 'New',
        status: 'published',
      });
      expect(out.title).toBe('Updated');
      expect(out.status).toBe('published');
      const got = await content.getBlogPost(saved.id, 'user-1');
      expect(got.content).toBe('New');
      expect(got.status).toBe('published');
    });
  });

  describe('deleteBlogPost (memory)', () => {
    it('removes post and returns success', async () => {
      const saved = await content.saveBlogPost('user-1', {
        title: 'To Delete',
        content: 'X',
        topic: {},
        businessInfo: {},
        status: 'draft',
      });
      const out = await content.deleteBlogPost(saved.id, 'user-1');
      expect(out.success).toBe(true);
      await expect(content.getBlogPost(saved.id, 'user-1')).rejects.toThrow('Blog post not found');
    });
  });
});
