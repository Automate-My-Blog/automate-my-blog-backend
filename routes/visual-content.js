import express from 'express';
import visualContentService from '../services/visual-content-generation.js';

const router = express.Router();

/**
 * Visual Content Generation API
 * Handles AI-powered image, infographic, and chart generation
 */

/**
 * POST /api/v1/visual-content/generate
 * Generate visual content for blog posts
 */
router.post('/generate', async (req, res) => {
  try {
    const {
      organizationId,
      postId,
      contentType,
      prompt,
      brandGuidelines = {},
      options = {},
      servicePreference = null
    } = req.body;

    // Validate required fields
    if (!organizationId || !contentType || !prompt) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'organizationId, contentType, and prompt are required'
      });
    }

    // Validate content type
    const validContentTypes = [
      'hero_image', 'infographic', 'chart', 'diagram', 'illustration',
      'social_media', 'thumbnail', 'banner', 'icon'
    ];

    if (!validContentTypes.includes(contentType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid content type',
        message: `Content type must be one of: ${validContentTypes.join(', ')}`
      });
    }

    console.log(`🎨 Generating ${contentType} for organization: ${organizationId}`);
    if (servicePreference) {
      console.log(`🎯 Service preference specified: ${servicePreference}`);
    }

    const result = await visualContentService.generateVisualContent({
      organizationId,
      postId,
      contentType,
      prompt,
      brandGuidelines,
      options,
      servicePreference
    });

    res.json(result);

  } catch (error) {
    console.error('Visual content generation endpoint error:', error);
    
    // Specific error handling
    if (error.message.includes('API key') || error.message.includes('token')) {
      res.status(503).json({
        success: false,
        error: 'Service unavailable',
        message: 'Visual content generation service is not properly configured'
      });
    } else if (error.message.includes('quota') || error.message.includes('rate limit')) {
      res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: 'Visual content generation rate limit exceeded. Please try again later.'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Generation failed',
        message: error.message
      });
    }
  }
});

/**
 * POST /api/v1/visual-content/batch-generate
 * Generate multiple visual content pieces in batch
 */
router.post('/batch-generate', async (req, res) => {
  try {
    const { requests } = req.body;

    if (!Array.isArray(requests) || requests.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid requests',
        message: 'requests must be a non-empty array'
      });
    }

    if (requests.length > 10) {
      return res.status(400).json({
        success: false,
        error: 'Too many requests',
        message: 'Maximum 10 requests per batch'
      });
    }

    console.log(`🎨 Batch generating ${requests.length} visual content pieces`);

    const results = await visualContentService.batchGenerate(requests);

    res.json({
      success: true,
      data: results,
      summary: {
        total: requests.length,
        successful: results.successful.length,
        failed: results.failed.length,
        totalCost: results.totalCost
      }
    });

  } catch (error) {
    console.error('Batch visual content generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Batch generation failed',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/visual-content/suggest
 * Get visual content suggestions for blog content
 */
router.post('/suggest', async (req, res) => {
  try {
    const { blogContent, brandGuidelines = {} } = req.body;

    if (!blogContent) {
      return res.status(400).json({
        success: false,
        error: 'Missing blog content',
        message: 'blogContent is required for suggestions'
      });
    }

    console.log(`💡 Generating visual content suggestions for blog: ${blogContent.title || 'Untitled'}`);

    const suggestions = await visualContentService.suggestVisualContent(
      blogContent,
      brandGuidelines
    );

    res.json({
      success: true,
      data: suggestions,
      count: suggestions.length
    });

  } catch (error) {
    console.error('Visual content suggestion error:', error);
    res.status(500).json({
      success: false,
      error: 'Suggestion generation failed',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/visual-content/:organizationId
 * Get all visual content for an organization
 */
router.get('/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { postId } = req.query;

    console.log(`🔍 Retrieving visual content for organization: ${organizationId}`);

    const content = await visualContentService.getVisualContent(organizationId, postId);

    res.json({
      success: true,
      data: content,
      count: content.length
    });

  } catch (error) {
    console.error('Visual content retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve visual content',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/visual-content/services/status
 * Get status of available visual content generation services
 */
router.get('/services/status', async (req, res) => {
  try {
    const services = {
      stable_diffusion: {
        available: !!process.env.REPLICATE_API_TOKEN,
        name: 'Stable Diffusion',
        costPerImage: 0.02,
        supportedTypes: ['hero_image', 'illustration', 'social_media', 'thumbnail', 'banner'],
        description: 'High-quality AI image generation'
      },
      dalle: {
        available: !!process.env.OPENAI_API_KEY,
        name: 'DALL-E 3',
        costPerImage: 0.04,
        supportedTypes: ['hero_image', 'illustration', 'social_media', 'icon'],
        description: 'OpenAI\'s premium image generation'
      },
      canva: {
        available: !!process.env.CANVA_API_KEY,
        name: 'Canva API',
        costPerImage: 0.01,
        supportedTypes: ['infographic', 'social_media', 'banner', 'thumbnail'],
        description: 'Template-based design generation'
      },
      quickchart: {
        available: true,
        name: 'QuickChart',
        costPerImage: 0.005,
        supportedTypes: ['chart'],
        description: 'Data visualization and charts'
      },
      adobe_firefly: {
        available: !!process.env.ADOBE_API_KEY,
        name: 'Adobe Firefly',
        costPerImage: 0.03,
        supportedTypes: ['hero_image', 'illustration', 'banner'],
        description: 'Commercial-safe AI image generation'
      }
    };

    const availableServices = Object.entries(services)
      .filter(([_, service]) => service.available)
      .reduce((acc, [key, service]) => {
        acc[key] = service;
        return acc;
      }, {});

    const unavailableServices = Object.entries(services)
      .filter(([_, service]) => !service.available)
      .map(([key, service]) => ({
        key,
        name: service.name,
        reason: 'API key not configured'
      }));

    res.json({
      success: true,
      data: {
        available: availableServices,
        unavailable: unavailableServices,
        totalAvailable: Object.keys(availableServices).length,
        recommendations: {
          economy: 'quickchart',
          standard: 'stable_diffusion',
          premium: 'dalle'
        }
      }
    });

  } catch (error) {
    console.error('Service status check error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check service status',
      message: error.message
    });
  }
});

/**
 * PUT /api/v1/visual-content/:contentId/rate
 * Rate generated visual content
 */
router.put('/:contentId/rate', async (req, res) => {
  try {
    const { contentId } = req.params;
    const { rating, feedback } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        error: 'Invalid rating',
        message: 'Rating must be between 1 and 5'
      });
    }

    console.log(`⭐ Rating visual content: ${contentId} with ${rating} stars`);

    // Update rating in database
    const result = await db.query(`
      UPDATE generated_visual_content 
      SET user_rating = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [rating, contentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Content not found',
        message: 'Visual content not found'
      });
    }

    res.json({
      success: true,
      message: 'Rating saved successfully',
      data: {
        contentId,
        rating,
        updatedAt: result.rows[0].updated_at
      }
    });

  } catch (error) {
    console.error('Visual content rating error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save rating',
      message: error.message
    });
  }
});

/**
 * DELETE /api/v1/visual-content/:contentId
 * Delete generated visual content
 */
router.delete('/:contentId', async (req, res) => {
  try {
    const { contentId } = req.params;

    console.log(`🗑️ Deleting visual content: ${contentId}`);

    const result = await db.query(
      'DELETE FROM generated_visual_content WHERE id = $1 RETURNING *',
      [contentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Content not found',
        message: 'Visual content not found'
      });
    }

    res.json({
      success: true,
      message: 'Visual content deleted successfully'
    });

  } catch (error) {
    console.error('Visual content deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete visual content',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/visual-content/analytics/:organizationId
 * Get visual content analytics for an organization
 */
router.get('/analytics/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params;

    console.log(`📊 Retrieving visual content analytics for organization: ${organizationId}`);

    const result = await db.query(
      'SELECT get_visual_content_summary($1) as summary',
      [organizationId]
    );

    const summary = result.rows[0].summary;

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    console.error('Visual content analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve analytics',
      message: error.message
    });
  }
});

export default router;