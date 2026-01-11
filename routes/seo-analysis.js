import { Router } from 'express';
import crypto from 'crypto';
import openaiService from '../services/openai.js';
import db from '../services/database.js';

const router = Router();

/**
 * Comprehensive SEO Analysis Service
 * Provides AI-powered educational SEO analysis for solopreneurs
 */
class ComprehensiveSEOAnalysisService {
  constructor() {
    this.rateLimit = new Map(); // Simple in-memory rate limiting
  }

  /**
   * Generate content hash for deduplication
   */
  generateContentHash(content) {
    return crypto.createHash('sha256').update(content.trim()).digest('hex');
  }

  /**
   * Check rate limiting (10 analyses per user per hour)
   */
  checkRateLimit(userId) {
    const now = Date.now();
    const userKey = `user_${userId}`;
    
    if (!this.rateLimit.has(userKey)) {
      this.rateLimit.set(userKey, []);
    }
    
    const userRequests = this.rateLimit.get(userKey);
    
    // Remove requests older than 1 hour
    const oneHourAgo = now - (60 * 60 * 1000);
    const recentRequests = userRequests.filter(timestamp => timestamp > oneHourAgo);
    this.rateLimit.set(userKey, recentRequests);
    
    if (recentRequests.length >= 10) {
      return false;
    }
    
    // Add current request
    recentRequests.push(now);
    return true;
  }

  /**
   * Validate content length and format
   */
  validateContent(content) {
    if (!content || typeof content !== 'string') {
      throw new Error('Content must be a non-empty string');
    }
    
    if (content.trim().length < 200) {
      throw new Error('Content must be at least 200 characters long for meaningful analysis');
    }
    
    if (content.length > 50000) { // ~10,000 words
      throw new Error('Content is too long. Maximum 50,000 characters allowed');
    }
    
    return true;
  }

  /**
   * Build comprehensive SEO analysis prompt
   */
  buildComprehensivePrompt(content, context) {
    const businessType = context.businessType || 'Business';
    const targetAudience = context.targetAudience || 'General audience';
    const primaryKeywords = context.primaryKeywords || [];
    const businessGoals = context.businessGoals || 'Generate more customers through content';

    return `You are an expert content strategist analyzing blog content for a solopreneur who understands technology but is new to marketing. They need to understand WHY each element matters for getting customers, not just technical metrics.

CONTENT TO ANALYZE:
"""
${content}
"""

BUSINESS CONTEXT:
- Industry: ${businessType}
- Target Audience: ${targetAudience}
- Primary Keywords: ${primaryKeywords.join(', ') || 'Not specified'}
- Business Goals: ${businessGoals}

ANALYSIS REQUIREMENTS:
1. Provide scores (1-100) for each element
2. Quote specific phrases from their content as examples
3. Explain WHY each metric matters for getting customers
4. Use encouraging, educational language (no marketing jargon)
5. Focus on how content serves the target audience
6. Compare to what competitors typically do
7. Suggest specific improvements with examples

TONE GUIDELINES:
- Explain like you're talking to a smart friend who's new to marketing
- Use analogies (storefront signs, helpful store clerk, etc.)
- Focus on customer psychology, not SEO technicalities
- Be encouraging while offering concrete improvements
- Teach concepts through their actual content

Return analysis in this exact JSON structure:
{
  "titleAnalysis": {
    "titleEffectiveness": {
      "score": 85,
      "explanation": "Educational explanation with specific quotes from their content..."
    },
    "titleLength": {
      "score": 92,
      "characterCount": 35,
      "explanation": "Simple explanation of why length matters for search results..."
    },
    "clickThroughPotential": {
      "score": 78,
      "explanation": "Analysis of emotional hooks and compelling language..."
    },
    "headlineHierarchy": {
      "score": 88,
      "h1Count": 1,
      "h2Count": 3,
      "h3Count": 7,
      "explanation": "How heading structure guides readers and search engines..."
    },
    "subheadingQuality": {
      "score": 85,
      "explanation": "Analysis of scannable format and user questions answered..."
    }
  },
  "contentFlow": {
    "introductionEffectiveness": {
      "score": 92,
      "explanation": "Analysis of opening hook with quoted example...",
      "hookQuote": "Actual quote from their opening"
    },
    "logicalProgression": {
      "score": 88,
      "explanation": "How content flows from problem to solution..."
    },
    "paragraphLength": {
      "score": 85,
      "averageWordsPerParagraph": 45,
      "explanation": "Mobile readability and bite-sized content analysis..."
    },
    "transitionQuality": {
      "score": 82,
      "explanation": "How sections connect smoothly..."
    },
    "conclusionStrength": {
      "score": 79,
      "explanation": "Analysis of ending impact and call-to-action..."
    }
  },
  "engagementUX": {
    "readingLevel": {
      "score": 88,
      "grade": "8th grade",
      "explanation": "Accessibility for target audience..."
    },
    "sentenceVariety": {
      "score": 85,
      "explanation": "Mix of short and long sentences for engagement..."
    },
    "activeVoiceUsage": {
      "score": 90,
      "percentage": 85,
      "explanation": "Direct, actionable language analysis..."
    },
    "questionUsage": {
      "score": 82,
      "explanation": "Mental engagement through strategic questions..."
    },
    "storytellingElements": {
      "score": 88,
      "explanation": "Concrete examples and relatable scenarios..."
    }
  },
  "authorityEAT": {
    "expertiseDemonstration": {
      "score": 83,
      "explanation": "Specific knowledge and professional insights shown..."
    },
    "authoritySignals": {
      "score": 75,
      "explanation": "Credentials and professional background indicators..."
    },
    "trustworthinessIndicators": {
      "score": 88,
      "explanation": "Empathy and authentic approach to audience concerns..."
    },
    "personalExperience": {
      "score": 90,
      "explanation": "First-hand knowledge and authentic anecdotes..."
    }
  },
  "technicalSEO": {
    "internalLinkingOpportunities": {
      "score": 65,
      "explanation": "Potential for helpful content connections...",
      "suggestions": [
        "Link 'specific phrase' to related content topic",
        "Connect 'another phrase' to helpful resource"
      ]
    },
    "externalLinkQuality": {
      "score": 70,
      "explanation": "Credibility through authoritative sources..."
    },
    "featuredSnippetOptimization": {
      "score": 85,
      "explanation": "Clear answers optimized for search features..."
    },
    "schemaMarkupPotential": {
      "score": 80,
      "explanation": "Structured data opportunities for better visibility..."
    }
  },
  "conversionOptimization": {
    "valuePropositionClarity": {
      "score": 88,
      "explanation": "Clear benefits and outcomes for readers..."
    },
    "trustBuildingElements": {
      "score": 85,
      "explanation": "Empathy and realistic expectations..."
    },
    "urgencyCreation": {
      "score": 65,
      "explanation": "Gentle motivation without being pushy..."
    },
    "leadMagnetPotential": {
      "score": 90,
      "explanation": "Content that could become valuable resources..."
    },
    "emailCaptureOptimization": {
      "score": 75,
      "explanation": "Natural opportunities for continued engagement..."
    }
  },
  "contentDepth": {
    "topicCoverage": {
      "score": 85,
      "explanation": "Comprehensive addressing of audience needs..."
    },
    "competingContentAnalysis": {
      "score": 82,
      "explanation": "Differentiation from typical generic advice..."
    },
    "informationGaps": {
      "score": 78,
      "explanation": "Additional topics that could enhance value..."
    },
    "uniqueAngle": {
      "score": 88,
      "explanation": "Distinctive approach that sets content apart..."
    },
    "resourceCompleteness": {
      "score": 80,
      "explanation": "Actionable tools and next steps provided..."
    }
  },
  "mobileAccessibility": {
    "mobileReadability": {
      "score": 90,
      "explanation": "Mobile-friendly formatting and structure..."
    },
    "voiceSearchOptimization": {
      "score": 85,
      "explanation": "Natural language matching voice queries..."
    },
    "accessibilityConsiderations": {
      "score": 88,
      "explanation": "Inclusive design for all readers..."
    },
    "loadingSpeedImpact": {
      "score": 92,
      "explanation": "Lightweight content for fast loading..."
    }
  },
  "socialSharing": {
    "shareabilityFactors": {
      "score": 85,
      "explanation": "Quotable insights and valuable takeaways..."
    },
    "socialProofIntegration": {
      "score": 70,
      "explanation": "Testimonials and success stories potential..."
    },
    "visualContentNeeds": {
      "score": 75,
      "explanation": "Infographic and visual enhancement opportunities..."
    },
    "viralPotential": {
      "score": 80,
      "explanation": "Emotional connection and community sharing appeal..."
    }
  },
  "contentFreshness": {
    "evergreenPotential": {
      "score": 95,
      "explanation": "Timeless value that remains relevant..."
    },
    "updateRequirements": {
      "score": 85,
      "explanation": "Minimal maintenance needed for ongoing relevance..."
    },
    "seasonalRelevance": {
      "score": 80,
      "explanation": "Opportunities for seasonal content refreshes..."
    },
    "contentSeriesPotential": {
      "score": 90,
      "explanation": "Foundation for expanded content library..."
    }
  },
  "competitiveDifferentiation": {
    "uniqueValueAdds": {
      "score": 88,
      "explanation": "Distinctive elements that set content apart..."
    },
    "contentGapAnalysis": {
      "score": 82,
      "explanation": "Market opportunities and underserved topics..."
    },
    "competitiveAdvantages": {
      "score": 85,
      "explanation": "Strengths that differentiate from competitors..."
    },
    "marketPositioning": {
      "score": 87,
      "explanation": "Brand voice and expertise positioning..."
    }
  },
  "overallAssessment": {
    "score": 87,
    "summary": "Your content perfectly balances expertise with empathy, making your target audience feel both understood and guided. The specific examples and actionable advice set you apart from generic content.",
    "topStrengths": [
      "Emotional connection with real examples",
      "Specific, actionable advice",
      "Perfect reading level for target audience"
    ],
    "topImprovements": [
      "Add authority signals (credentials/experience)",
      "Include more internal links to related content",
      "Create gentle urgency without being pushy"
    ]
  }
}`;
  }

  /**
   * Parse and validate OpenAI response
   */
  parseAnalysisResponse(response) {
    try {
      console.log('🔍 Raw OpenAI response length:', response?.length || 0);
      console.log('🔍 Response starts with:', response?.substring(0, 100));
      console.log('🔍 Response ends with:', response?.substring(response.length - 100));
      
      // Check for problematic content
      if (!response || typeof response !== 'string') {
        throw new Error('Empty or invalid response from OpenAI');
      }
      
      if (response.includes('[object Object]')) {
        console.error('❌ Found [object Object] in OpenAI response!');
        throw new Error('OpenAI response contains serialization errors');
      }
      
      // Clean the response
      let cleanedResponse = response.trim();
      
      // Remove markdown code blocks
      if (cleanedResponse.startsWith('```json')) {
        cleanedResponse = cleanedResponse.substring(7);
      } else if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse.substring(3);
      }
      
      if (cleanedResponse.endsWith('```')) {
        cleanedResponse = cleanedResponse.slice(0, -3);
      }
      
      cleanedResponse = cleanedResponse.trim();
      
      console.log('🧹 Cleaned response length:', cleanedResponse.length);
      
      const analysis = JSON.parse(cleanedResponse);
      
      // Validate required sections exist
      const requiredSections = [
        'titleAnalysis', 'contentFlow', 'engagementUX', 'authorityEAT',
        'technicalSEO', 'conversionOptimization', 'contentDepth', 
        'mobileAccessibility', 'socialSharing', 'contentFreshness',
        'competitiveDifferentiation', 'overallAssessment'
      ];
      
      for (const section of requiredSections) {
        if (!analysis[section]) {
          throw new Error(`Missing required section: ${section}`);
        }
      }
      
      // Validate overall score
      if (!analysis.overallAssessment.score || analysis.overallAssessment.score < 1 || analysis.overallAssessment.score > 100) {
        throw new Error('Invalid overall score');
      }
      
      console.log('✅ Analysis response parsed and validated successfully');
      console.log('🔍 Analysis sections found:', Object.keys(analysis));
      console.log('🔍 titleAnalysis keys:', Object.keys(analysis.titleAnalysis || {}));
      return analysis;
    } catch (error) {
      console.error('❌ Parse error details:', {
        errorMessage: error.message,
        responseLength: response?.length || 0,
        responseType: typeof response,
        responsePreview: response?.substring(0, 200)
      });
      throw new Error(`Failed to parse analysis response: ${error.message}`);
    }
  }

  /**
   * Check for existing analysis
   */
  async checkExistingAnalysis(userId, contentHash) {
    try {
      const result = await db.query(
        'SELECT * FROM comprehensive_seo_analyses WHERE user_id = $1 AND content_hash = $2 ORDER BY created_at DESC LIMIT 1',
        [userId, contentHash]
      );
      
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error checking existing analysis:', error);
      return null;
    }
  }

  /**
   * Save analysis to database
   */
  async saveAnalysis(userId, contentHash, content, analysis, metadata) {
    const { v4: uuidv4 } = await import('uuid');
    const analysisId = uuidv4();
    
    // Create content preview (first 200 characters)
    const contentPreview = content.substring(0, 200).trim();
    const wordCount = content.split(/\s+/).length;
    
    console.log('🔍 Saving analysis sections:', {
      titleAnalysis: !!analysis.titleAnalysis,
      contentFlow: !!analysis.contentFlow,
      engagementUX: !!analysis.engagementUX,
      overallScore: analysis.overallAssessment?.score
    });
    
    const insertData = {
      id: analysisId,
      user_id: userId,
      post_id: metadata.postId || null,
      content_hash: contentHash,
      content_preview: contentPreview,
      content_word_count: wordCount,
      title_analysis: JSON.stringify(analysis.titleAnalysis),
      content_flow: JSON.stringify(analysis.contentFlow),
      engagement_ux: JSON.stringify(analysis.engagementUX),
      authority_eat: JSON.stringify(analysis.authorityEAT),
      technical_seo: JSON.stringify(analysis.technicalSEO),
      conversion_optimization: JSON.stringify(analysis.conversionOptimization),
      content_depth: JSON.stringify(analysis.contentDepth),
      mobile_accessibility: JSON.stringify(analysis.mobileAccessibility),
      social_sharing: JSON.stringify(analysis.socialSharing),
      content_freshness: JSON.stringify(analysis.contentFreshness),
      competitive_differentiation: JSON.stringify(analysis.competitiveDifferentiation),
      overall_score: analysis.overallAssessment.score,
      top_strengths: JSON.stringify(analysis.overallAssessment.topStrengths || []),
      top_improvements: JSON.stringify(analysis.overallAssessment.topImprovements || []),
      ai_summary: analysis.overallAssessment.summary,
      analysis_version: 'v1.0',
      openai_model: metadata.model || 'gpt-4',
      analysis_duration_ms: metadata.duration
    };
    
    const insertFields = Object.keys(insertData);
    const insertValues = Object.values(insertData);
    const insertPlaceholders = insertFields.map((_, i) => `$${i + 1}`).join(', ');
    
    // Use UPSERT to handle potential duplicate content hash for same user
    const result = await db.query(
      `INSERT INTO comprehensive_seo_analyses (${insertFields.join(', ')}) 
       VALUES (${insertPlaceholders}) 
       ON CONFLICT (content_hash, user_id) 
       DO UPDATE SET
         title_analysis = EXCLUDED.title_analysis,
         content_flow = EXCLUDED.content_flow,
         engagement_ux = EXCLUDED.engagement_ux,
         authority_eat = EXCLUDED.authority_eat,
         technical_seo = EXCLUDED.technical_seo,
         conversion_optimization = EXCLUDED.conversion_optimization,
         content_depth = EXCLUDED.content_depth,
         mobile_accessibility = EXCLUDED.mobile_accessibility,
         social_sharing = EXCLUDED.social_sharing,
         content_freshness = EXCLUDED.content_freshness,
         competitive_differentiation = EXCLUDED.competitive_differentiation,
         overall_score = EXCLUDED.overall_score,
         top_strengths = EXCLUDED.top_strengths,
         top_improvements = EXCLUDED.top_improvements,
         ai_summary = EXCLUDED.ai_summary,
         analysis_version = EXCLUDED.analysis_version,
         openai_model = EXCLUDED.openai_model,
         analysis_duration_ms = EXCLUDED.analysis_duration_ms,
         updated_at = NOW()
       RETURNING *`,
      insertValues
    );
    
    return result.rows[0];
  }

  /**
   * Clean up corrupted data for a user
   */
  async cleanupCorruptedData(userId) {
    try {
      const result = await db.query(`
        DELETE FROM comprehensive_seo_analyses 
        WHERE user_id = $1 AND (
          title_analysis = '[object Object]' OR
          content_flow = '[object Object]' OR
          engagement_ux = '[object Object]' OR
          authority_eat = '[object Object]' OR
          technical_seo = '[object Object]' OR
          conversion_optimization = '[object Object]' OR
          content_depth = '[object Object]' OR
          mobile_accessibility = '[object Object]' OR
          social_sharing = '[object Object]' OR
          content_freshness = '[object Object]' OR
          competitive_differentiation = '[object Object]'
        )
      `, [userId]);
      
      if (result.rowCount > 0) {
        console.log(`🧹 Cleaned up ${result.rowCount} corrupted records for user ${userId}`);
      }
    } catch (error) {
      console.warn('⚠️ Failed to cleanup corrupted data:', error.message);
      // Don't throw - this is just maintenance
    }
  }

  /**
   * Analyze content with comprehensive SEO insights
   */
  async analyzeContent(userId, content, context = {}, postId = null) {
    const startTime = Date.now();
    
    try {
      // Clean up any remaining corrupted data for this user
      await this.cleanupCorruptedData(userId);
      
      // Rate limiting check
      if (!this.checkRateLimit(userId)) {
        throw new Error('Rate limit exceeded. Maximum 10 analyses per hour.');
      }
      
      // Validate content
      this.validateContent(content);
      
      // Generate content hash for deduplication
      const contentHash = this.generateContentHash(content);
      
      // Build comprehensive prompt
      const prompt = this.buildComprehensivePrompt(content, context);
      
      // Call OpenAI for analysis
      console.log('🧠 Calling OpenAI for comprehensive SEO analysis...');
      
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',  // Use faster, cheaper model
        max_tokens: 4000,      // Sufficient tokens for detailed analysis
        temperature: 0.3,      // Balanced creativity and consistency
        messages: [
          {
            role: 'system',
            content: 'You are an expert content strategist providing educational SEO analysis for solopreneurs. Always respond with valid JSON in the exact structure specified.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      });
      
      const rawResponse = completion.choices[0].message.content;
      console.log('🔍 OpenAI completion received, response type:', typeof rawResponse);
      
      // Check for empty response
      if (!rawResponse) {
        throw new Error('OpenAI returned empty response');
      }
      
      // Parse and validate response
      const analysis = this.parseAnalysisResponse(rawResponse);
      
      // Save to database
      const duration = Date.now() - startTime;
      const savedAnalysis = await this.saveAnalysis(
        userId,
        contentHash,
        content,
        analysis,
        { postId, duration, model: 'gpt-4' }
      );
      
      console.log(`✅ Comprehensive SEO analysis completed in ${duration}ms for user: ${userId}`);
      
      return {
        success: true,
        analysisId: savedAnalysis.id,
        fromCache: false,
        analysis: this.formatStoredAnalysis(savedAnalysis)
      };
      
    } catch (error) {
      console.error('Comprehensive SEO analysis error:', error);
      throw error;
    }
  }

  /**
   * Format stored analysis for API response
   */
  formatStoredAnalysis(stored) {
    const safeJsonParse = (jsonString, fieldName, fallback = {}) => {
      try {
        if (!jsonString || jsonString === '[object Object]') {
          console.warn(`⚠️ Corrupted data found in ${fieldName}, using fallback`);
          return fallback;
        }
        return JSON.parse(jsonString);
      } catch (error) {
        console.error(`❌ Failed to parse ${fieldName}:`, error.message);
        console.error(`Raw data type: ${typeof jsonString}`);
        console.error(`Raw data preview:`, typeof jsonString === 'string' ? jsonString.substring(0, 100) : jsonString);
        return fallback;
      }
    };

    return {
      id: stored.id,
      overallScore: stored.overall_score,
      titleAnalysis: safeJsonParse(stored.title_analysis, 'titleAnalysis', { titleEffectiveness: { score: 0, explanation: 'Data corrupted' } }),
      contentFlow: safeJsonParse(stored.content_flow, 'contentFlow', { introductionEffectiveness: { score: 0, explanation: 'Data corrupted' } }),
      engagementUX: safeJsonParse(stored.engagement_ux, 'engagementUX', { readingLevel: { score: 0, explanation: 'Data corrupted' } }),
      authorityEAT: safeJsonParse(stored.authority_eat, 'authorityEAT', { expertiseDemonstration: { score: 0, explanation: 'Data corrupted' } }),
      technicalSEO: safeJsonParse(stored.technical_seo, 'technicalSEO', { internalLinkingOpportunities: { score: 0, explanation: 'Data corrupted' } }),
      conversionOptimization: safeJsonParse(stored.conversion_optimization, 'conversionOptimization', { valuePropositionClarity: { score: 0, explanation: 'Data corrupted' } }),
      contentDepth: safeJsonParse(stored.content_depth, 'contentDepth', { topicCoverage: { score: 0, explanation: 'Data corrupted' } }),
      mobileAccessibility: safeJsonParse(stored.mobile_accessibility, 'mobileAccessibility', { mobileReadability: { score: 0, explanation: 'Data corrupted' } }),
      socialSharing: safeJsonParse(stored.social_sharing, 'socialSharing', { shareabilityFactors: { score: 0, explanation: 'Data corrupted' } }),
      contentFreshness: safeJsonParse(stored.content_freshness, 'contentFreshness', { evergreenPotential: { score: 0, explanation: 'Data corrupted' } }),
      competitiveDifferentiation: safeJsonParse(stored.competitive_differentiation, 'competitiveDifferentiation', { uniqueValueAdds: { score: 0, explanation: 'Data corrupted' } }),
      topStrengths: safeJsonParse(stored.top_strengths || '[]', 'topStrengths', []),
      topImprovements: safeJsonParse(stored.top_improvements || '[]', 'topImprovements', []),
      aiSummary: stored.ai_summary,
      contentPreview: stored.content_preview,
      contentWordCount: stored.content_word_count,
      analysisDate: stored.created_at,
      analysisVersion: stored.analysis_version
    };
  }

  /**
   * Get user's analysis history
   */
  async getUserAnalyses(userId, limit = 10) {
    try {
      const result = await db.query(
        'SELECT id, content_preview, overall_score, created_at, content_word_count FROM comprehensive_seo_analyses WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
        [userId, limit]
      );
      
      return result.rows.map(row => ({
        id: row.id,
        contentPreview: row.content_preview,
        overallScore: row.overall_score,
        wordCount: row.content_word_count,
        createdAt: row.created_at
      }));
    } catch (error) {
      console.error('Error getting user analyses:', error);
      throw error;
    }
  }

  /**
   * Get specific analysis by ID
   */
  async getAnalysis(analysisId, userId) {
    try {
      const result = await db.query(
        'SELECT * FROM comprehensive_seo_analyses WHERE id = $1 AND user_id = $2',
        [analysisId, userId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Analysis not found or access denied');
      }
      
      return this.formatStoredAnalysis(result.rows[0]);
    } catch (error) {
      console.error('Error getting analysis:', error);
      throw error;
    }
  }
}

// Initialize service
const seoAnalysisService = new ComprehensiveSEOAnalysisService();

/**
 * POST /api/v1/seo-analysis
 * Create comprehensive SEO analysis
 */
router.post('/', async (req, res) => {
  try {
    const { content, context = {}, postId } = req.body;
    const userId = req.user.userId;
    
    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field',
        message: 'Content is required for analysis'
      });
    }
    
    console.log(`📊 Starting comprehensive SEO analysis for user: ${userId}`);
    
    const result = await seoAnalysisService.analyzeContent(
      userId,
      content,
      context,
      postId
    );
    
    res.json({
      success: true,
      analysisId: result.analysisId,
      fromCache: result.fromCache,
      analysis: result.analysis,
      metadata: {
        analysisDate: new Date().toISOString(),
        contentWordCount: result.analysis.contentWordCount
      }
    });
    
  } catch (error) {
    console.error('SEO analysis endpoint error:', error);
    
    if (error.message.includes('Rate limit')) {
      res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: error.message
      });
    } else if (error.message.includes('too long') || error.message.includes('too short')) {
      res.status(400).json({
        success: false,
        error: 'Invalid content length',
        message: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Analysis failed',
        message: error.message
      });
    }
  }
});

/**
 * GET /api/v1/seo-analysis/history
 * Get user's analysis history
 */
router.get('/history', async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit) || 10;
    
    const analyses = await seoAnalysisService.getUserAnalyses(userId, limit);
    
    res.json({
      success: true,
      data: analyses
    });
    
  } catch (error) {
    console.error('Get analysis history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve analysis history',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/seo-analysis/:id
 * Get specific analysis by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    
    const analysis = await seoAnalysisService.getAnalysis(id, userId);
    
    res.json({
      success: true,
      analysis
    });
    
  } catch (error) {
    console.error('Get analysis error:', error);
    
    if (error.message.includes('not found')) {
      res.status(404).json({
        success: false,
        error: 'Analysis not found',
        message: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve analysis',
        message: error.message
      });
    }
  }
});

export default router;