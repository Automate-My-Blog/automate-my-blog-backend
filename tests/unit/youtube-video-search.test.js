/**
 * Unit tests: YouTube video search service.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');

describe('YouTubeVideoSearchService', () => {
  let originalEnv;
  let service;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    process.env.YOUTUBE_API_KEY = '';
    vi.resetModules();
    const mod = await import('../../services/youtube-video-search.js');
    service = mod.default;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns empty array when no API key configured', async () => {
    const result = await service.searchRelevantVideos({
      topic: 'remote work',
      businessType: 'Tech',
      targetAudience: 'Professionals'
    });
    expect(result).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('returns empty array on API error', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    vi.resetModules();
    const mod = await import('../../services/youtube-video-search.js');
    const svc = mod.default;

    axios.get.mockRejectedValueOnce(new Error('Network error'));

    const result = await svc.searchRelevantVideos({
      topic: 'test topic',
      businessType: 'X',
      targetAudience: 'Y',
      maxVideos: 3
    });

    expect(result).toEqual([]);
  });

  it('returns videos when API returns valid data', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    vi.resetModules();
    const mod = await import('../../services/youtube-video-search.js');
    const svc = mod.default;

    axios.get
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: { videoId: 'abc123' },
              snippet: {
                title: 'Test Video',
                channelTitle: 'Test Channel',
                publishedAt: '2024-01-15T00:00:00Z',
                thumbnails: { medium: { url: 'https://example.com/thumb.jpg' } }
              }
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: 'abc123',
              snippet: {
                title: 'Test Video',
                channelTitle: 'Test Channel',
                publishedAt: '2024-01-15T00:00:00Z',
                thumbnails: { medium: { url: 'https://example.com/thumb.jpg' } }
              },
              statistics: { viewCount: '1000', likeCount: '50' },
              contentDetails: { duration: 'PT5M30S' }
            }
          ]
        }
      });

    const result = await svc.searchRelevantVideos({
      topic: 'test',
      businessType: 'X',
      targetAudience: 'Y',
      maxVideos: 5
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      url: 'https://www.youtube.com/watch?v=abc123',
      videoId: 'abc123',
      title: 'Test Video',
      channelTitle: 'Test Channel',
      viewCount: 1000,
      likeCount: 50
    });
    expect(result[0].duration).toBe('5m 30s');
  });

  it('parseDuration handles various ISO 8601 formats', () => {
    expect(service.parseDuration('PT5M30S')).toBe('5m 30s');
    expect(service.parseDuration('PT1H2M3S')).toBe('1h 2m 3s');
    expect(service.parseDuration('PT30S')).toBe('30s');
    expect(service.parseDuration(null)).toBe(null);
  });
});
