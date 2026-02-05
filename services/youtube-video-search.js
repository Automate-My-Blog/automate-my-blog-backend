import axios from 'axios';

/**
 * YouTube Video Search Service
 * Uses YouTube Data API v3 to find relevant videos for blog content
 * Requires YOUTUBE_API_KEY (Google Cloud Console, YouTube Data API v3 enabled)
 */
export class YouTubeVideoSearchService {
  constructor() {
    this.apiKey = process.env.YOUTUBE_API_KEY?.trim().replace(/^["']|["']$/g, '');
    this.baseUrl = 'https://www.googleapis.com/youtube/v3';

    if (!this.apiKey) {
      console.warn('⚠️ YOUTUBE_API_KEY not configured - YouTube video search disabled');
    }
  }

  /**
   * Search for relevant YouTube videos by topic
   * @param {Object} params - Search parameters
   * @param {string} params.topic - Search topic (e.g., "remote work productivity")
   * @param {string} params.businessType - Business context
   * @param {string} params.targetAudience - Target audience
   * @param {number} params.maxVideos - Max videos to find (default: 5)
   * @returns {Array<Object>} Array of video objects
   */
  async searchRelevantVideos({ topic, businessType, targetAudience, maxVideos = 5 }) {
    if (!this.apiKey) {
      console.log('⚠️ YouTube video search skipped - no API key');
      return [];
    }

    try {
      console.log(`🔍 [YOUTUBE] Searching for videos about: ${topic}`);

      // Search for videos
      const searchResponse = await axios.get(`${this.baseUrl}/search`, {
        params: {
          part: 'snippet',
          q: topic,
          type: 'video',
          maxResults: Math.min(maxVideos, 25),
          order: 'relevance',
          safeSearch: 'moderate',
          key: this.apiKey
        },
        headers: { Accept: 'application/json' },
        timeout: 10000
      });

      const items = searchResponse.data?.items || [];
      const videoIds = items
        .filter((item) => item.id?.videoId)
        .map((item) => item.id.videoId);

      if (videoIds.length === 0) {
        console.log('⚠️ [YOUTUBE] No videos found');
        return [];
      }

      // Fetch statistics and contentDetails for view count, like count, duration
      const statsResponse = await axios.get(`${this.baseUrl}/videos`, {
        params: {
          part: 'statistics,contentDetails,snippet',
          id: videoIds.join(','),
          key: this.apiKey
        },
        headers: { Accept: 'application/json' },
        timeout: 10000
      });

      const statsItems = statsResponse.data?.items || [];
      const searchItemsById = Object.fromEntries(
        items.map((i) => [i.id?.videoId, i]).filter(([k]) => k)
      );

      const videos = statsItems.map((item) => {
        const videoId = item.id;
        const snippet = item.snippet || searchItemsById[videoId]?.snippet || {};
        const stats = item.statistics || {};
        const contentDetails = item.contentDetails || {};
        const thumbnails = snippet.thumbnails || {};
        const thumbUrl =
          thumbnails.medium?.url || thumbnails.high?.url || thumbnails.default?.url || '';

        return {
          url: `https://www.youtube.com/watch?v=${videoId}`,
          videoId,
          title: snippet.title || '',
          description: (snippet.description || '').substring(0, 200),
          channelTitle: snippet.channelTitle || '',
          channelId: snippet.channelId || '',
          publishedAt: snippet.publishedAt || '',
          thumbnailUrl: thumbUrl,
          viewCount: parseInt(stats.viewCount || '0', 10),
          likeCount: parseInt(stats.likeCount || '0', 10),
          duration: this.parseDuration(contentDetails.duration)
        };
      });

      console.log(`✅ [YOUTUBE] Found ${videos.length} videos`);
      return videos;
    } catch (error) {
      if (error.response?.status === 403) {
        console.warn('⚠️ [YOUTUBE] API quota exceeded or API not enabled');
      } else {
        console.error('❌ [YOUTUBE] Video search failed:', error.message);
        if (error.response) {
          console.error('Response:', error.response.status, error.response.data?.error?.message);
        }
      }
      return [];
    }
  }

  /**
   * Parse ISO 8601 duration (PT1H2M30S) to human-readable
   */
  parseDuration(isoDuration) {
    if (!isoDuration) return null;
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return isoDuration;
    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    return parts.join(' ');
  }
}

// Singleton export
const service = new YouTubeVideoSearchService();
export default service;
