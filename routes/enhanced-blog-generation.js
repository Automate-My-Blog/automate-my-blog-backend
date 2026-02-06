import express from 'express';
import enhancedBlogGenerationService from '../services/enhanced-blog-generation.js';
import billingService from '../services/billing.js';
import { waitUntil } from '@vercel/functions';

// Mock SEO analysis service for now
const seoAnalysisService = {
  analyzeContent: async (userId, content, options) => {
    // Mock analysis that returns a score
    const wordCount = content.split(' ').length;
    const hasHeaders = content.includes('#');
    const hasKeywords = options.primaryKeywords?.some(keyword => 
      content.toLowerCase().includes(keyword.toLowerCase())
    );
    
    const score = Math.min(95, 
      60 + 
      (wordCount > 1000 ? 15 : 10) + 
      (hasHeaders ? 10 : 0) + 
      (hasKeywords ? 15 : 5)
    );
    
    return {
      analysis: {
        overallScore: score,
        topImprovements: score < 90 ? ['Add more keywords', 'Improve headers', 'Increase content length'] : []
      }
    };
  }
};

const router = express.Router();

/**
 * Enhanced Blog Generation API
 * Integrates website analysis data and targets 95+ SEO scores
 */

/**
 * POST /api/v1/enhanced-blog-generation/generate
 * Generate blog post with website analysis integration
 */
router.post('/generate', async (req, res) => {
  try {
    const {
      topic,
      businessInfo,
      organizationId,
      additionalInstructions,
      options = {}
    } = req.body;

    const userId = req.user.userId;

    // Validate required fields
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

    console.log(`🚀 Enhanced blog generation requested for organization: ${organizationId}`);
    console.log(`📝 Topic: ${topic.title}`);

    // Check if user has credits available
    const hasCredits = await billingService.hasCredits(userId);
    if (!hasCredits) {
      const credits = await billingService.getUserCredits(userId);
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits',
        message: 'You have used all your blog post credits for this billing period.',
        data: {
          currentPlan: credits.basePlan,
          creditsUsed: credits.usedCredits,
          creditsAvailable: credits.availableCredits,
          upgradeUrl: '/pricing'
        }
      });
    }

    // Generate complete enhanced blog
    const result = await enhancedBlogGenerationService.generateCompleteEnhancedBlog(
      topic,
      businessInfo,
      organizationId,
      {
        additionalInstructions,
        includeVisuals: options.includeVisuals !== false,
        ...options
      }
    );

    // Save to database if requested
    let savedPost = null;
    if (options.autoSave !== false) {
      try {
        savedPost = await enhancedBlogGenerationService.saveEnhancedBlogPost(
          userId,
          organizationId,
          result,
          { status: options.status || 'draft' }
        );
        console.log(`💾 Blog post auto-saved: ${savedPost.id}`);

        // Deduct credit for successful generation
        try {
          await billingService.useCredit(userId, 'generation');
          console.log(`✅ Credit deducted for user ${userId}`);
        } catch (creditError) {
          console.error('Failed to deduct credit:', creditError);
          // Don't fail the response, but log for admin review
        }

        // ✨ REMOVED: Async image generation moved to dedicated endpoint
        // Images are now generated via /api/images/generate-for-blog
        // This prevents timeout issues by giving image generation its own 60s window
        // Frontend will call the image endpoint after receiving the blog response
        if (result._hasImagePlaceholders && savedPost.id) {
          console.log(`🎨 Blog has ${result._hasImagePlaceholders} image placeholders`);
          console.log(`💡 Frontend should call /api/images/generate-for-blog to generate images`);
        }

        // Trigger ASYNC tweet enrichment if needed
        if (result._needsTweetEnrichment && savedPost.id) {
          console.log(`🐦 [ASYNC] Triggering background tweet enrichment for blog: ${savedPost.id}`);

          // Use Vercel's waitUntil to keep function alive for background processing
          waitUntil(
            enhancedBlogGenerationService.enrichTweetsAsync(
              savedPost.id,
              result.content,
              result._topicForTweets,
              result._businessInfoForTweets
            ).then(async (tweetResult) => {
              if (tweetResult.success) {
                console.log(`✅ [BACKGROUND] Tweets enriched for blog: ${savedPost.id} (${tweetResult.tweetsAdded} tweets), updating post...`);

                // Update the blog post with enriched tweets
                try {
                  await enhancedBlogGenerationService.updateBlogPostContent(
                    savedPost.id,
                    tweetResult.content
                  );
                  console.log(`✅ [BACKGROUND] Blog post ${savedPost.id} updated with tweets`);
                } catch (updateError) {
                  console.error(`❌ [BACKGROUND] Failed to update blog ${savedPost.id}:`, updateError.message);
                }
              } else {
                console.error(`❌ [BACKGROUND] Tweet enrichment failed for blog: ${savedPost.id}`);
              }
            }).catch(err => {
              console.error(`❌ [BACKGROUND] Tweet enrichment error for blog ${savedPost.id}:`, err.message);
            })
          );

          console.log(`✅ Blog saved, tweets will be enriched in background`);
        }
      } catch (saveError) {
        console.warn('Auto-save failed, continuing without saving:', saveError.message);
      }
    }

    res.json({
      success: true,
      data: result,
      savedPost,
      enhancedGeneration: true,
      metadata: {
        generationTime: result.generationMetadata?.duration,
        tokensUsed: result.generationMetadata?.tokensUsed,
        qualityPrediction: result.qualityPrediction,
        dataCompleteness: result.organizationContext?.dataCompleteness,
        visualSuggestions: result.visualContentSuggestions?.length || 0
      },
      // NEW: Image generation metadata for frontend
      imageGeneration: {
        hasPlaceholders: result._hasImagePlaceholders || false,
        needsImageGeneration: (result._hasImagePlaceholders && savedPost?.id) || false,
        blogPostId: savedPost?.id || null,
        topic: result._topicForImages || null,
        organizationId: result._organizationIdForImages || null
      }
    });

  } catch (error) {
    console.error('Enhanced blog generation endpoint error:', error);
    
    // Specific error handling
    if (error.message.includes('Organization not found')) {
      res.status(404).json({
        success: false,
        error: 'Organization not found',
        message: error.message
      });
    } else if (error.message.includes('rate limit') || error.message.includes('quota')) {
      res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: 'AI service rate limit exceeded. Please try again in a few minutes.'
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
 * POST /api/v1/enhanced-blog-generation/generate-stream (Phase 2)
 * Start streaming blog content. Client must open GET /api/v1/stream?token= first to get connectionId.
 * Body: { connectionId, topic, businessInfo, organizationId, additionalInstructions?, options? }
 * Returns 202 { connectionId, streamUrl }. Events: content-chunk, complete, error.
 */
router.post('/generate-stream', async (req, res) => {
  try {
    const { connectionId, topic, businessInfo, organizationId, additionalInstructions, options = {} } = req.body;
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
    }
    if (!connectionId || typeof connectionId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing connectionId',
        message: 'Open GET /api/v1/stream?token= first, then pass connectionId from the connected event'
      });
    }
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

    const baseUrl = req.protocol + '://' + (req.get('host') || '');
    const token = req.query?.token || req.headers?.authorization?.replace(/^Bearer\s+/i, '') || '';
    const streamUrl = token ? `${baseUrl}/api/v1/stream?token=${encodeURIComponent(token)}` : `${baseUrl}/api/v1/stream`;

    setImmediate(() => {
      enhancedBlogGenerationService.generateBlogPostStream(
        topic,
        businessInfo,
        organizationId,
        connectionId,
        { additionalInstructions, ...options }
      ).catch((err) => console.error('generate-stream background error:', err));
    });

    res.status(202).json({
      connectionId,
      streamUrl
    });
  } catch (error) {
    console.error('generate-stream endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start stream',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/enhanced-blog-generation/related-content
 * Fetch related tweets and videos for a topic in one request (runs both pipelines in parallel).
 * Body: { topic, businessInfo, maxTweets?, maxVideos? }
 * Returns 200 { tweets, videos, searchTermsUsed: { tweets: string[], videos: string[] } }
 */
router.post('/related-content', async (req, res) => {
  try {
    const { topic, businessInfo, maxTweets, maxVideos } = req.body;
    if (!topic || !businessInfo || !topic.title) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'topic (with title) and businessInfo are required'
      });
    }
    const result = await enhancedBlogGenerationService.searchRelatedTweetsAndVideos(topic, businessInfo, {
      maxTweets: maxTweets ?? 3,
      maxVideos: maxVideos ?? 5
    });
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('related-content endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch related content',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/enhanced-blog-generation/analyze-and-improve
 * Generate blog and automatically analyze with SEO analysis
 */
router.post('/analyze-and-improve', async (req, res) => {
  try {
    const {
      topic,
      businessInfo,
      organizationId,
      targetScore = 95,
      maxIterations = 3
    } = req.body;

    const userId = req.user.userId;

    console.log(`🎯 Starting analyze-and-improve cycle targeting ${targetScore}+ SEO score`);

    let currentIteration = 0;
    let bestResult = null;
    let bestScore = 0;
    const attempts = [];

    while (currentIteration < maxIterations) {
      currentIteration++;
      console.log(`🔄 Generation attempt ${currentIteration}/${maxIterations}`);

      try {
        // Generate blog post
        const blogResult = await enhancedBlogGenerationService.generateCompleteEnhancedBlog(
          topic,
          businessInfo,
          organizationId,
          {
            additionalInstructions: currentIteration > 1 ? 
              `Previous attempt scored ${bestScore}. Focus on improving: ${bestResult?.analysis?.topImprovements?.join(', ') || 'SEO optimization, content depth, internal linking'}. Target ${targetScore}+ score.` : 
              `Target ${targetScore}+ SEO score with comprehensive optimization.`,
            includeVisuals: true
          }
        );

        // Analyze the generated content
        const analysisResult = await seoAnalysisService.analyzeContent(
          userId,
          blogResult.content,
          {
            businessType: businessInfo.businessType,
            targetAudience: businessInfo.targetAudience,
            primaryKeywords: blogResult.seoKeywords || []
          }
        );

        const score = analysisResult.analysis.overallScore;
        console.log(`📊 Attempt ${currentIteration} SEO score: ${score}`);

        attempts.push({
          iteration: currentIteration,
          score: score,
          blog: blogResult,
          analysis: analysisResult.analysis
        });

        // Update best result if this is better
        if (score > bestScore) {
          bestScore = score;
          bestResult = {
            blog: blogResult,
            analysis: analysisResult.analysis
          };
        }

        // If we hit the target score, stop iterating
        if (score >= targetScore) {
          console.log(`🎉 Target score ${targetScore} achieved with score ${score}!`);
          break;
        }

      } catch (iterationError) {
        console.error(`❌ Iteration ${currentIteration} failed:`, iterationError.message);
        attempts.push({
          iteration: currentIteration,
          error: iterationError.message,
          score: 0
        });
      }
    }

    if (!bestResult) {
      throw new Error('All generation attempts failed');
    }

    // Save the best result
    const savedPost = await enhancedBlogGenerationService.saveEnhancedBlogPost(
      userId,
      organizationId,
      bestResult.blog,
      { status: 'draft' }
    );

    res.json({
      success: true,
      data: bestResult.blog,
      analysis: bestResult.analysis,
      savedPost,
      optimizationResults: {
        targetScore,
        achievedScore: bestScore,
        targetReached: bestScore >= targetScore,
        iterations: currentIteration,
        maxIterations,
        attempts: attempts.map(a => ({
          iteration: a.iteration,
          score: a.score,
          error: a.error || null
        }))
      },
      metadata: {
        finalScore: bestScore,
        improvementStrategy: bestScore >= targetScore ? 'success' : 'partial_optimization',
        recommendations: bestResult.analysis.topImprovements || []
      }
    });

  } catch (error) {
    console.error('Analyze-and-improve endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Optimization failed',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/enhanced-blog-generation/context/:organizationId
 * Get organization context and data availability for blog generation
 */
router.get('/context/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params;

    console.log(`📊 Loading context for organization: ${organizationId}`);

    const context = await enhancedBlogGenerationService.getOrganizationContext(organizationId);

    res.json({
      success: true,
      data: context,
      recommendations: enhancedBlogGenerationService.generateQualityRecommendations(context),
      metadata: {
        dataCompleteness: context.completenessScore,
        enhancementLevel: context.completenessScore > 60 ? 'high' : 
                         context.completenessScore > 30 ? 'medium' : 'basic',
        expectedQualityRange: {
          min: Math.max(60, context.completenessScore - 10),
          max: Math.min(95, context.completenessScore + 20)
        }
      }
    });

  } catch (error) {
    console.error('Context loading error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load context',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/enhanced-blog-generation/preview
 * Generate preview/outline without full content generation
 */
router.post('/preview', async (req, res) => {
  try {
    const { topic, businessInfo, organizationId } = req.body;

    // Validate required fields
    if (!topic || !businessInfo || !organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    console.log(`👀 Generating preview for: ${topic.title}`);

    // Load organization context
    const context = await enhancedBlogGenerationService.getOrganizationContext(organizationId);

    // Generate visual content suggestions
    const visualSuggestions = await enhancedBlogGenerationService.generateVisualContentSuggestions(
      { title: topic.title, content: topic.subheader || '' },
      organizationId
    );

    // Create preview response
    const preview = {
      topic,
      organizationContext: context,
      predictedQuality: {
        expectedSEOScore: context.completenessScore > 60 ? '90-95' :
                         context.completenessScore > 30 ? '80-90' : '70-85',
        enhancementLevel: context.completenessScore > 60 ? 'high' :
                         context.completenessScore > 30 ? 'medium' : 'basic',
        dataCompleteness: context.completenessScore
      },
      visualSuggestions,
      recommendations: enhancedBlogGenerationService.generateQualityRecommendations(context),
      estimatedLength: '1200-1800 words',
      estimatedReadTime: '6-9 minutes'
    };

    // Send admin alert for preview activity (async, don't block response)
    const emailService = (await import('../services/email.js')).default;
    emailService.sendLeadPreviewAlert({
      websiteUrl: context.websiteUrl || businessInfo.websiteUrl || 'Unknown',
      businessName: context.businessName || businessInfo.businessName || 'Unknown Business',
      topic: topic.title
    }).catch(err => console.error('Failed to send preview alert:', err));

    res.json({
      success: true,
      data: preview
    });

  } catch (error) {
    console.error('Preview generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate preview',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/enhanced-blog-generation/statistics/:organizationId
 * Get generation statistics and performance metrics
 */
router.get('/statistics/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { timeRange = '30' } = req.query; // days

    console.log(`📈 Loading generation statistics for organization: ${organizationId}`);

    const stats = await db.query(`
      SELECT 
        COUNT(*) as total_posts,
        AVG(seo_score_prediction) as avg_seo_score,
        AVG(word_count) as avg_word_count,
        COUNT(*) FILTER (WHERE enhancement_level = 'high') as high_enhancement_count,
        COUNT(*) FILTER (WHERE enhancement_level = 'medium') as medium_enhancement_count,
        COUNT(*) FILTER (WHERE enhancement_level = 'basic') as basic_enhancement_count,
        COUNT(*) FILTER (WHERE seo_score_prediction >= 90) as high_score_count,
        MAX(created_at) as last_generated
      FROM blog_posts 
      WHERE organization_id = $1 
        AND created_at > NOW() - INTERVAL '${parseInt(timeRange)} days'
        AND enhancement_level IS NOT NULL
    `, [organizationId]);

    const visualStats = await db.query(`
      SELECT 
        COUNT(*) as total_visuals,
        AVG(generation_cost) as avg_cost,
        COUNT(DISTINCT content_type) as unique_types,
        SUM(generation_cost) as total_cost
      FROM generated_visual_content 
      WHERE organization_id = $1 
        AND created_at > NOW() - INTERVAL '${parseInt(timeRange)} days'
    `, [organizationId]);

    const statistics = {
      blogPosts: stats.rows[0],
      visualContent: visualStats.rows[0],
      performance: {
        averageSEOScore: parseFloat(stats.rows[0].avg_seo_score || 0),
        highScoreRate: stats.rows[0].total_posts > 0 ? 
          (stats.rows[0].high_score_count / stats.rows[0].total_posts * 100) : 0,
        enhancementDistribution: {
          high: parseInt(stats.rows[0].high_enhancement_count),
          medium: parseInt(stats.rows[0].medium_enhancement_count),
          basic: parseInt(stats.rows[0].basic_enhancement_count)
        }
      },
      timeRange: parseInt(timeRange)
    };

    res.json({
      success: true,
      data: statistics
    });

  } catch (error) {
    console.error('Statistics loading error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load statistics',
      message: error.message
    });
  }
});

export default router;