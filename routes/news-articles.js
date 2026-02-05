/**
 * News article search API routes. POST /api/v1/news-articles/search-for-topic-stream for streaming article search.
 * Body: { topic, businessInfo, maxArticles? }
 * Returns 200 { connectionId, streamUrl }. Stream via GET /api/v1/stream/:connectionId?token=|?sessionId=
 * Events: queries-extracted, complete, error.
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import enhancedBlogGenerationService from '../services/enhanced-blog-generation.js';

const router = express.Router();

router.post('/search-for-topic-stream', async (req, res) => {
  try {
    const userContext = req.user?.userId
      ? { userId: req.user.userId }
      : { sessionId: req.headers['x-session-id'] || req.query?.sessionId };
    if (!userContext.userId && !userContext.sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Either authentication or session ID is required'
      });
    }

    const { topic, businessInfo, maxArticles = 5 } = req.body;

    if (!topic || !businessInfo) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters',
        message: 'topic and businessInfo are required'
      });
    }

    const connectionId = uuidv4();

    const baseUrl = req.protocol + '://' + (req.get('host') || '');
    const token = req.query?.token || req.headers?.authorization?.replace(/^Bearer\s+/i, '') || '';
    const streamUrl = token
      ? `${baseUrl}/api/v1/stream/${connectionId}?token=${encodeURIComponent(token)}`
      : userContext.sessionId
        ? `${baseUrl}/api/v1/stream/${connectionId}?sessionId=${encodeURIComponent(userContext.sessionId)}`
        : `${baseUrl}/api/v1/stream/${connectionId}`;

    setImmediate(() => {
      enhancedBlogGenerationService
        .searchForTopicStreamNews(topic, businessInfo, maxArticles, connectionId)
        .catch((err) =>
          console.error('news-articles search-for-topic-stream error:', err)
        );
    });

    res.status(200).json({ connectionId, streamUrl });
  } catch (error) {
    console.error('news-articles search-for-topic-stream endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start stream',
      message: error.message
    });
  }
});

export default router;
