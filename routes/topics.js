/**
 * Topics API routes.
 * - POST /api/v1/topics/generate-stream — streaming topic generation
 * - POST /api/v1/trending-topics/stream — same (alias for trending-topics)
 * Body: { businessType, targetAudience, contentFocus }
 * Returns 200 { connectionId, streamUrl }. Stream via GET /api/v1/stream/:connectionId?token=
 * Events: topic-complete, topic-image-start, topic-image-complete, complete, error.
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import openaiService from '../services/openai.js';

const router = express.Router();

async function handleGenerateStream(req, res) {
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

    const { businessType, targetAudience, contentFocus } = req.body;
    if (!businessType || !targetAudience || !contentFocus) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'businessType, targetAudience, and contentFocus are required'
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
      openaiService.generateTrendingTopicsStream(
        businessType,
        targetAudience,
        contentFocus,
        connectionId
      ).catch((err) => console.error('topics generate-stream error:', err));
    });

    res.status(200).json({ connectionId, streamUrl });
  } catch (error) {
    console.error('topics generate-stream endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start stream',
      message: error.message
    });
  }
}

router.post('/generate-stream', handleGenerateStream);
router.post('/stream', handleGenerateStream);

export default router;
