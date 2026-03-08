/**
 * Unit tests: fetchTrendsForContentCalendar fallback when no seo_keywords.
 * Verifies keywords are derived from target_segment (demographics, psychographics, searchBehavior)
 * and customer_problem, and that getRisingQueries is called with those keywords.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockQuery = vi.fn();
const mockGetRisingQueries = vi.fn();

vi.mock('../../services/database.js', () => ({ default: { query: mockQuery } }));
vi.mock('../../services/google-trends.js', () => ({
  default: { getRisingQueries: mockGetRisingQueries }
}));

describe('fetchTrendsForContentCalendar fallback', () => {
  const userId = 'user-123';
  const strategyIds = ['audience-id-1'];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetRisingQueries.mockResolvedValue([
      { query: 'trending topic', value: 150, formattedValue: '+150%' }
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses seo_keywords when present', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ keyword: 'content marketing' }] })
      .mockResolvedValue({ rows: [] });

    const { fetchTrendsForContentCalendar } = await import('../../services/content-calendar-service.js');
    const resultP = fetchTrendsForContentCalendar(userId, strategyIds);
    await vi.advanceTimersByTimeAsync(3000);
    const result = await resultP;

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('seo_keywords'),
      expect.any(Array)
    );
    expect(mockGetRisingQueries).toHaveBeenCalledWith('content marketing', 'US', '7d', userId);
    expect(result.keywordCount).toBe(1);
    expect(result.fetched).toBe(1);
  });

  it('fallback: extracts keyword from target_segment.demographics when no seo_keywords', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // seo_keywords empty
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'audience-id-1',
            customer_problem: null,
            target_segment: { demographics: 'Small business owners', psychographics: '', searchBehavior: '' }
          }
        ]
      })
      .mockResolvedValue({ rows: [] });

    const { fetchTrendsForContentCalendar } = await import('../../services/content-calendar-service.js');
    const resultP = fetchTrendsForContentCalendar(userId, strategyIds);
    await vi.advanceTimersByTimeAsync(3000);
    const result = await resultP;

    expect(mockGetRisingQueries).toHaveBeenCalledWith('Small business owners', 'US', '7d', userId);
    expect(result.keywordCount).toBe(1);
    expect(result.fetched).toBe(1);
  });

  it('fallback: extracts keyword from customer_problem first phrase', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'audience-id-1',
            customer_problem: 'Need to save time on marketing. They struggle with consistency.',
            target_segment: null
          }
        ]
      })
      .mockResolvedValue({ rows: [] });

    const { fetchTrendsForContentCalendar } = await import('../../services/content-calendar-service.js');
    const resultP = fetchTrendsForContentCalendar(userId, strategyIds);
    await vi.advanceTimersByTimeAsync(3000);
    const result = await resultP;

    expect(mockGetRisingQueries).toHaveBeenCalledWith('Need to save time on marketing', 'US', '7d', userId);
    expect(result.keywordCount).toBe(1);
  });

  it('fallback: uses psychographics and searchBehavior from target_segment', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'audience-id-1',
            customer_problem: null,
            target_segment: {
              demographics: '',
              psychographics: 'Value efficiency and automation',
              searchBehavior: 'Search for how-to guides'
            }
          }
        ]
      })
      .mockResolvedValue({ rows: [] });

    const { fetchTrendsForContentCalendar } = await import('../../services/content-calendar-service.js');
    const resultP = fetchTrendsForContentCalendar(userId, strategyIds);
    await vi.advanceTimersByTimeAsync(10000);
    const result = await resultP;

    expect(mockGetRisingQueries).toHaveBeenCalledTimes(2);
    expect(mockGetRisingQueries).toHaveBeenNthCalledWith(1, 'Value efficiency and automation', 'US', '7d', userId);
    expect(mockGetRisingQueries).toHaveBeenNthCalledWith(2, 'Search for how-to guides', 'US', '7d', userId);
    expect(result.keywordCount).toBe(2);
  });

  it('uses default keywords when audiences have no extractable fallback text', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'audience-id-1',
            customer_problem: null,
            target_segment: {} // empty object
          }
        ]
      });

    const { fetchTrendsForContentCalendar } = await import('../../services/content-calendar-service.js');
    const resultP = fetchTrendsForContentCalendar(userId, strategyIds);
    await vi.advanceTimersByTimeAsync(10000);
    const result = await resultP;

    expect(mockGetRisingQueries).toHaveBeenCalledWith('content marketing', 'US', '7d', userId);
    expect(mockGetRisingQueries).toHaveBeenCalledWith('digital marketing', 'US', '7d', userId);
    expect(result.keywordCount).toBe(2);
    expect(result.fetched).toBe(2);
  });

  it('uses default keywords when strategyIds empty so user still gets topics', async () => {
    const { fetchTrendsForContentCalendar } = await import('../../services/content-calendar-service.js');
    const resultP = fetchTrendsForContentCalendar(userId, []);
    await vi.advanceTimersByTimeAsync(10000);
    const result = await resultP;

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockGetRisingQueries).toHaveBeenCalledWith('content marketing', 'US', '7d', userId);
    expect(mockGetRisingQueries).toHaveBeenCalledWith('digital marketing', 'US', '7d', userId);
    expect(result.keywordCount).toBe(2);
    expect(result.fetched).toBe(2);
  });

  it('uses only default keywords when fallback yields only long phrases (avoids timeout, Trends API returns empty for long queries)', async () => {
    const longPhrase = 'Finding reliable solutions and expert guidance in their field of interest';
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'audience-id-1',
            customer_problem: null,
            target_segment: { demographics: longPhrase, psychographics: '', searchBehavior: '' }
          }
        ]
      })
      .mockResolvedValue({ rows: [] });

    const { fetchTrendsForContentCalendar } = await import('../../services/content-calendar-service.js');
    const resultP = fetchTrendsForContentCalendar(userId, strategyIds);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await resultP;

    expect(mockGetRisingQueries).toHaveBeenCalledTimes(2);
    expect(mockGetRisingQueries).toHaveBeenNthCalledWith(1, 'content marketing', 'US', '7d', userId);
    expect(mockGetRisingQueries).toHaveBeenNthCalledWith(2, 'digital marketing', 'US', '7d', userId);
    expect(result.keywordCount).toBe(2);
  });
});
