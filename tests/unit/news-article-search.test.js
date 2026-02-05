/**
 * Unit tests: News article search service.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');

describe('NewsArticleSearchService', () => {
  let originalEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    process.env.NEWS_API_KEY = '';
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns empty array when no API key configured', async () => {
    const mod = await import('../../services/news-article-search.js');
    const service = mod.default;

    const result = await service.searchRelevantArticles({
      topic: 'remote work',
      businessType: 'Tech',
      targetAudience: 'Professionals'
    });
    expect(result).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('returns empty array on API error', async () => {
    process.env.NEWS_API_KEY = 'test-key';
    vi.resetModules();
    const mod = await import('../../services/news-article-search.js');
    const svc = mod.default;

    axios.get.mockRejectedValueOnce(new Error('Network error'));

    const result = await svc.searchRelevantArticles({
      topic: 'test topic',
      businessType: 'X',
      targetAudience: 'Y',
      maxArticles: 3
    });

    expect(result).toEqual([]);
  });

  it('returns empty array when API status is not ok', async () => {
    process.env.NEWS_API_KEY = 'test-key';
    vi.resetModules();
    const mod = await import('../../services/news-article-search.js');
    const svc = mod.default;

    axios.get.mockResolvedValueOnce({
      data: { status: 'error', message: 'Invalid request' }
    });

    const result = await svc.searchRelevantArticles({
      topic: 'test',
      businessType: 'X',
      targetAudience: 'Y',
      maxArticles: 5
    });

    expect(result).toEqual([]);
  });

  it('returns articles when API returns valid data', async () => {
    process.env.NEWS_API_KEY = 'test-key';
    vi.resetModules();
    const mod = await import('../../services/news-article-search.js');
    const svc = mod.default;

    axios.get.mockResolvedValueOnce({
      data: {
        status: 'ok',
        articles: [
          {
            url: 'https://example.com/article-1',
            title: 'Test Article',
            description: 'A test article description',
            source: { id: 'example', name: 'Example News' },
            author: 'John Doe',
            publishedAt: '2024-01-15T12:00:00Z',
            urlToImage: 'https://example.com/image.jpg',
            content: 'Article content...'
          }
        ]
      }
    });

    const result = await svc.searchRelevantArticles({
      topic: 'test',
      businessType: 'X',
      targetAudience: 'Y',
      maxArticles: 5
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      url: 'https://example.com/article-1',
      title: 'Test Article',
      sourceName: 'Example News',
      sourceId: 'example',
      author: 'John Doe'
    });
  });
});
