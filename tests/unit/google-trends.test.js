/**
 * Unit tests: Google Trends service (rising queries parsing and timeframe).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRelatedQueries = vi.fn();
vi.mock('google-trends-api', () => ({ default: { relatedQueries: mockRelatedQueries } }));

const mockQuery = vi.fn();
vi.mock('../../services/database.js', () => ({ default: { query: mockQuery } }));

describe('GoogleTrendsService', () => {
  let service;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] }); // cache miss, then cache write
    const mod = await import('../../services/google-trends.js');
    service = mod.default;
  });

  describe('getRisingQueries', () => {
    it('prefers Rising list (rankedList[1]) when both Top and Rising exist', async () => {
      const apiResponse = JSON.stringify({
        default: {
          rankedList: [
            {
              rankedKeyword: [
                { query: 'top query', value: 100, formattedValue: '100' }
              ]
            },
            {
              rankedKeyword: [
                { query: 'breakout query', value: 836500, formattedValue: 'Breakout' },
                { query: 'rising query', value: 40, formattedValue: '+40%' }
              ]
            }
          ]
        }
      });
      mockRelatedQueries.mockResolvedValue(apiResponse);

      const result = await service.getRisingQueries('test keyword', 'US', '7d', null);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ query: 'breakout query', formattedValue: 'Breakout' });
      expect(result[1]).toMatchObject({ query: 'rising query', value: 40, formattedValue: '+40%' });
      expect(mockRelatedQueries).toHaveBeenCalledWith(
        expect.objectContaining({
          keyword: 'test keyword',
          geo: 'US',
          category: 0,
          hl: 'en-US',
          startTime: expect.any(Date),
          endTime: expect.any(Date)
        })
      );
    });

    it('falls back to Top list (rankedList[0]) when only one list has data', async () => {
      const apiResponse = JSON.stringify({
        default: {
          rankedList: [
            {
              rankedKeyword: [
                { query: 'top only', value: 95, formattedValue: '95' }
              ]
            },
            { rankedKeyword: [] }
          ]
        }
      });
      mockRelatedQueries.mockResolvedValue(apiResponse);

      const result = await service.getRisingQueries('niche keyword', 'US', '30d', null);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ query: 'top only', value: 95 });
    });

    it('passes date range for 7d timeframe', async () => {
      mockRelatedQueries.mockResolvedValue(JSON.stringify({ default: { rankedList: [] } }));

      await service.getRisingQueries('kw', 'US', '7d');

      const call = mockRelatedQueries.mock.calls[0][0];
      const diffDays = (call.endTime - call.startTime) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThanOrEqual(6);
      expect(diffDays).toBeLessThanOrEqual(8);
    });

    it('returns cached result when cache hit', async () => {
      const cached = [
        { query: 'cached', value: 100, formattedValue: '100%', hasData: true }
      ];
      mockQuery
        .mockResolvedValueOnce({ rows: [{ rising_queries: cached }] }); // cache hit

      const result = await service.getRisingQueries('keyword', 'US', '7d', 'user-123');

      expect(result).toEqual(cached);
      expect(mockRelatedQueries).not.toHaveBeenCalled();
    });

    it('returns empty array on API error', async () => {
      mockRelatedQueries.mockRejectedValue(new Error('Rate limited'));

      const result = await service.getRisingQueries('keyword', 'US', '7d');

      expect(result).toEqual([]);
    });
  });

  describe('_timeframeToDates', () => {
    it('returns 7-day range for 7d', () => {
      const { startTime, endTime } = service._timeframeToDates('7d');
      const diff = (endTime - startTime) / (1000 * 60 * 60 * 24);
      expect(diff).toBeGreaterThanOrEqual(6);
      expect(diff).toBeLessThanOrEqual(8);
    });

    it('returns 30-day range for 30d and today 1-m', () => {
      const { startTime: s1, endTime: e1 } = service._timeframeToDates('30d');
      const { startTime: s2, endTime: e2 } = service._timeframeToDates('today 1-m');
      const diff1 = (e1 - s1) / (1000 * 60 * 60 * 24);
      const diff2 = (e2 - s2) / (1000 * 60 * 60 * 24);
      expect(diff1).toBeGreaterThanOrEqual(29);
      expect(diff1).toBeLessThanOrEqual(31);
      expect(diff2).toBeGreaterThanOrEqual(29);
      expect(diff2).toBeLessThanOrEqual(31);
    });
  });
});
