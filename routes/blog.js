/**
 * Blog API routes. POST /api/v1/blog/generate-stream for streaming blog content (typing effect).
 * Frontend path: POST /api/v1/blog/generate-stream
 * Body: { topic, businessInfo, organizationId, additionalInstructions?, tweets? }
 * Returns 200 { connectionId }. Stream content via GET /api/v1/stream/:connectionId?token=
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import enhancedBlogGenerationService from '../services/enhanced-blog-generation.js';
import billingService from '../services/billing.js';

const router = express.Router();

router.post('/generate-stream', async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
    }

    const {
      topic,
      businessInfo,
      organizationId,
      additionalInstructions,
      tweets,
      options = {}
    } = req.body;

    if (!topic || !businessInfo || !organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'topic, businessInfo, and organizationId are required'
      });
    }
    if (!topic.title || !businessInfo.businessType || !businessInfo.targetAudience) {
      return res.status(400).json({
        success: false,
        error: 'Invalid data structure',
        message: 'topic must have title, businessInfo must have businessType and targetAudience'
      });
    }

    const hasCredits = await billingService.hasCredits(userId);
    if (!hasCredits) {
      const credits = await billingService.getUserCredits(userId);
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits',
        message: 'You have used all your blog post credits for this billing period.',
        data: { currentPlan: credits.basePlan, creditsUsed: credits.usedCredits, creditsAvailable: credits.availableCredits, upgradeUrl: '/pricing' }
      });
    }

    const connectionId = uuidv4();

    const baseUrl = req.protocol + '://' + (req.get('host') || '');
    const token = req.query?.token || req.headers?.authorization?.replace(/^Bearer\s+/i, '') || '';
    const streamUrl = token
      ? `${baseUrl}/api/v1/stream/${connectionId}?token=${encodeURIComponent(token)}`
      : `${baseUrl}/api/v1/stream/${connectionId}`;

    setImmediate(() => {
      const opts = { additionalInstructions, ...options };
      if (tweets != null) opts.tweets = tweets;
      enhancedBlogGenerationService.generateBlogPostStream(
        topic,
        businessInfo,
        organizationId,
        connectionId,
        opts
      ).catch((err) => console.error('blog generate-stream background error:', err));
    });

    res.status(200).json({ connectionId, streamUrl });
  } catch (error) {
    console.error('blog generate-stream endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start stream',
      message: error.message
    });
  }
});

export default router;
