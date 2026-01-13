import OpenAI from 'openai';
import db from './database.js';
import visualContentService from './visual-content-generation.js';
import { OpenAIService } from './openai.js';

/**
 * Enhanced Blog Generation Service
 * Integrates website analysis data, manual inputs, and visual content generation
 * Targets 95+ SEO scores using comprehensive analysis insights
 */
export class EnhancedBlogGenerationService extends OpenAIService {
  constructor() {
    super();
    this.visualContentService = visualContentService;
    
    // Initialize OpenAI client with proper API key
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Get organization data availability and analysis
   */
  async getOrganizationContext(organizationId) {
    try {
      console.log(`📊 Loading organization context for: ${organizationId}`);

      // Get data availability
      const availabilityResult = await db.query(
        'SELECT data_availability, blog_generation_settings FROM organizations WHERE id = $1',
        [organizationId]
      );

      if (availabilityResult.rows.length === 0) {
        throw new Error('Organization not found');
      }

      const availability = availabilityResult.rows[0].data_availability || {
        has_blog_content: false,
        has_cta_data: false,
        has_internal_links: false,
        completeness_score: 0
      };
      const settings = availabilityResult.rows[0].blog_generation_settings || {};

      // Get manual inputs
      const manualInputs = await db.query(
        'SELECT input_type, input_data FROM user_manual_inputs WHERE organization_id = $1 AND validated = TRUE',
        [organizationId]
      );

      const manualData = {};
      manualInputs.rows.forEach(row => {
        manualData[row.input_type] = JSON.parse(row.input_data);
      });

      // Get website analysis data if available
      const websiteData = {};
      
      if (availability.has_blog_content) {
        const contentResult = await db.query(
          'SELECT tone_analysis, style_patterns, brand_voice_keywords FROM content_analysis_results WHERE organization_id = $1 AND is_current = TRUE ORDER BY created_at DESC LIMIT 1',
          [organizationId]
        );
        if (contentResult.rows.length > 0) {
          websiteData.tone_analysis = JSON.parse(contentResult.rows[0].tone_analysis || '{}');
          websiteData.style_patterns = JSON.parse(contentResult.rows[0].style_patterns || '{}');
          websiteData.brand_voice_keywords = JSON.parse(contentResult.rows[0].brand_voice_keywords || '[]');
        }
      }

      if (availability.has_cta_data) {
        const ctaResult = await db.query(
          'SELECT cta_text, cta_type, placement FROM cta_analysis WHERE organization_id = $1 ORDER BY conversion_potential DESC LIMIT 10',
          [organizationId]
        );
        websiteData.ctas = ctaResult.rows;
      }

      if (availability.has_internal_links) {
        const linkResult = await db.query(
          'SELECT target_url, anchor_text, link_type FROM internal_linking_analysis WHERE organization_id = $1 ORDER BY seo_value DESC LIMIT 15',
          [organizationId]
        );
        websiteData.internal_links = linkResult.rows;
      }

      return {
        availability,
        settings,
        manualData,
        websiteData,
        hasManualFallbacks: Object.keys(manualData).length > 0,
        hasWebsiteData: Object.keys(websiteData).length > 0,
        completenessScore: availability.completeness_score || 0
      };

    } catch (error) {
      console.error('Error loading organization context:', error);
      throw error;
    }
  }

  /**
   * Build enhanced generation prompt with all available data
   */
  buildEnhancedPrompt(topic, businessInfo, organizationContext, additionalInstructions = '') {
    const { availability, settings, manualData, websiteData, completenessScore } = organizationContext;

    // Build context sections based on available data
    let contextSections = [];

    // Brand voice and tone
    let brandContext = '';
    if (websiteData.tone_analysis) {
      brandContext = `BRAND VOICE (from website analysis): ${JSON.stringify(websiteData.tone_analysis)}`;
    } else if (manualData.brand_voice) {
      brandContext = `BRAND VOICE (manual input): ${JSON.stringify(manualData.brand_voice)}`;
    } else {
      brandContext = `BRAND VOICE: Professional ${businessInfo.businessType} voice, ${businessInfo.brandVoice}`;
    }
    contextSections.push(brandContext);

    // Internal linking context
    if (websiteData.internal_links && websiteData.internal_links.length > 0) {
      const linkContext = `INTERNAL LINKING OPPORTUNITIES:
${websiteData.internal_links.map(link => 
  `- Link to "${link.target_url}" with anchor text like "${link.anchor_text}" (${link.link_type} content)`
).join('\n')}`;
      contextSections.push(linkContext);
    } else if (manualData.internal_linking) {
      const linkContext = `INTERNAL LINKING STRATEGY: ${JSON.stringify(manualData.internal_linking)}`;
      contextSections.push(linkContext);
    }

    // CTA context
    if (websiteData.ctas && websiteData.ctas.length > 0) {
      const ctaContext = `CALL-TO-ACTION PATTERNS (from website analysis):
${websiteData.ctas.map(cta => 
  `- "${cta.cta_text}" (${cta.cta_type}, ${cta.placement})`
).join('\n')}`;
      contextSections.push(ctaContext);
    } else if (manualData.cta_preferences) {
      const ctaContext = `CTA PREFERENCES: ${JSON.stringify(manualData.cta_preferences)}`;
      contextSections.push(ctaContext);
    }

    // Target audience context
    if (manualData.target_audience) {
      const audienceContext = `TARGET AUDIENCE DETAILS: ${JSON.stringify(manualData.target_audience)}`;
      contextSections.push(audienceContext);
    }

    // SEO optimization instructions
    const seoTarget = settings.target_seo_score || 95;
    const seoInstructions = `
SEO OPTIMIZATION TARGET: ${seoTarget}+ score
CRITICAL SEO REQUIREMENTS:
- Title: 50-60 characters, compelling and keyword-rich
- Meta description: 150-160 characters, action-oriented
- Headings: Use H1, H2, H3 hierarchy with target keywords
- Content: 1200-1800 words for comprehensive coverage
- Include 3-5 internal links naturally within content
- Add 2-3 relevant CTAs based on content flow
- Use semantic keywords and related terms throughout
- Ensure mobile-friendly structure with scannable paragraphs
- Include actionable takeaways and clear value propositions`;

    // Data completeness indicator
    const dataContext = `DATA COMPLETENESS: ${completenessScore}% (${availability.has_blog_content ? '✓' : '✗'} Brand voice, ${availability.has_cta_data ? '✓' : '✗'} CTAs, ${availability.has_internal_links ? '✓' : '✗'} Internal links)`;

    return `Write a high-quality blog post optimized for ${seoTarget}+ SEO score:

TOPIC: ${topic.title}
SUBTITLE: ${topic.subheader}
BUSINESS TYPE: ${businessInfo.businessType}
TARGET AUDIENCE: ${businessInfo.targetAudience}

${contextSections.join('\n\n')}

${dataContext}

${seoInstructions}

CONTENT REQUIREMENTS:
1. STRATEGIC VALUE: Provide actionable insights that demonstrate expertise
2. SEO OPTIMIZATION: Target ${seoTarget}+ score on comprehensive SEO analysis
3. BRAND ALIGNMENT: Match the voice and tone patterns identified
4. INTERNAL LINKING: Include 3-5 natural internal links to relevant content
5. CTA INTEGRATION: Include 2-3 contextual calls-to-action that feel natural
6. MOBILE OPTIMIZATION: Use scannable formatting with clear headings
7. VALUE-FOCUSED: Every paragraph should provide genuine value to readers

ADDITIONAL INSTRUCTIONS: ${additionalInstructions}

Return JSON format:
{
  "title": "SEO-optimized title (50-60 chars)",
  "subtitle": "Compelling subtitle", 
  "metaDescription": "Action-oriented meta description (150-160 chars)",
  "content": "Full blog post content in markdown with proper headings",
  "tags": ["relevant", "tags"],
  "estimatedReadTime": "X min read",
  "seoKeywords": ["primary", "secondary", "semantic", "keywords"],
  "internalLinks": [
    {
      "anchorText": "natural anchor text",
      "suggestedUrl": "/suggested/url",
      "context": "why this link adds value"
    }
  ],
  "ctaSuggestions": [
    {
      "text": "CTA text",
      "placement": "end-of-post",
      "type": "primary",
      "context": "why this CTA fits here"
    }
  ],
  "seoOptimizationScore": "predicted score based on SEO best practices"
}`;
  }

  /**
   * Generate enhanced blog post with website analysis integration
   */
  async generateEnhancedBlogPost(topic, businessInfo, organizationId, additionalInstructions = '') {
    const startTime = Date.now();
    const model = process.env.OPENAI_MODEL || 'gpt-4o';

    try {
      console.log(`🚀 Starting enhanced blog generation for organization: ${organizationId}`);

      // Load organization context
      const organizationContext = await this.getOrganizationContext(organizationId);
      console.log(`📊 Organization context loaded: ${organizationContext.completenessScore}% complete`);

      // Build enhanced prompt with all available data
      const enhancedPrompt = this.buildEnhancedPrompt(topic, businessInfo, organizationContext, additionalInstructions);

      console.log('🧠 Calling OpenAI with enhanced prompt...');
      const completion = await this.openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: 'system',
            content: `You are an expert SEO content strategist who creates blog posts that consistently score 95+ on comprehensive SEO analysis. You understand both technical SEO requirements and user experience needs. You integrate brand voice, internal linking, and CTAs naturally into valuable content.

CRITICAL REQUIREMENTS:
1. SEO EXCELLENCE: Target 95+ SEO score through comprehensive optimization
2. BRAND CONSISTENCY: Match provided brand voice and style patterns exactly  
3. STRATEGIC LINKING: Include internal links that genuinely add value
4. CONVERSION OPTIMIZATION: Place CTAs where they feel natural and helpful
5. MOBILE-FIRST: Structure content for mobile readability and engagement
6. FACTUAL ACCURACY: No fabricated statistics or false claims
7. GENUINE VALUE: Every section must provide actionable insights`
          },
          {
            role: 'user',
            content: enhancedPrompt
          }
        ],
        temperature: 0.3, // Lower temperature for more consistent quality
        max_tokens: 3500
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log('✅ Enhanced blog generation completed:', {
        duration: `${duration}ms`,
        tokensUsed: completion.usage?.total_tokens,
        model: model,
        organizationDataScore: organizationContext.completenessScore
      });

      const response = completion.choices[0].message.content;
      const blogData = this.parseOpenAIResponse(response);

      // Enhance blog data with organization context
      blogData.organizationContext = {
        dataCompleteness: organizationContext.completenessScore,
        hasWebsiteData: organizationContext.hasWebsiteData,
        hasManualInputs: organizationContext.hasManualFallbacks,
        enhancementLevel: organizationContext.completenessScore > 60 ? 'high' : 
                         organizationContext.completenessScore > 30 ? 'medium' : 'basic'
      };

      // Add generation metadata
      blogData.generationMetadata = {
        model: model,
        duration: duration,
        tokensUsed: completion.usage?.total_tokens,
        enhancementLevel: blogData.organizationContext.enhancementLevel,
        generatedAt: new Date().toISOString()
      };

      return blogData;

    } catch (error) {
      console.error('Enhanced blog generation error:', error);
      throw new Error(`Enhanced blog generation failed: ${error.message}`);
    }
  }

  /**
   * Generate visual content suggestions for blog post
   */
  async generateVisualContentSuggestions(blogData, organizationId) {
    try {
      console.log('🎨 Generating visual content suggestions...');

      // Get brand guidelines if available
      const brandResult = await db.query(
        'SELECT input_data FROM user_manual_inputs WHERE organization_id = $1 AND input_type = $2 AND validated = TRUE',
        [organizationId, 'brand_colors']
      );

      let brandGuidelines = {};
      if (brandResult.rows.length > 0) {
        brandGuidelines = JSON.parse(brandResult.rows[0].input_data);
      }

      // Generate suggestions based on content
      const suggestions = await this.visualContentService.suggestVisualContent(
        { title: blogData.title, content: blogData.content },
        brandGuidelines
      );

      return suggestions;

    } catch (error) {
      console.error('Visual content suggestion error:', error);
      return []; // Return empty array on failure, don't break blog generation
    }
  }

  /**
   * Complete enhanced blog generation with visual content
   */
  async generateCompleteEnhancedBlog(topic, businessInfo, organizationId, options = {}) {
    try {
      console.log(`🎯 Starting complete enhanced blog generation for: ${topic.title}`);

      // Load organization context for quality recommendations
      const organizationContext = await this.getOrganizationContext(organizationId);

      // Generate the blog post content
      const blogData = await this.generateEnhancedBlogPost(
        topic, 
        businessInfo, 
        organizationId, 
        options.additionalInstructions || ''
      );

      // Generate visual content suggestions if requested
      let visualSuggestions = [];
      if (options.includeVisuals !== false) {
        visualSuggestions = await this.generateVisualContentSuggestions(blogData, organizationId);
      }

      // Combine everything into complete response
      const completeResponse = {
        ...blogData,
        visualContentSuggestions: visualSuggestions,
        enhancedGeneration: true,
        qualityPrediction: {
          expectedSEOScore: blogData.seoOptimizationScore || 85,
          enhancementLevel: blogData.organizationContext.enhancementLevel,
          dataCompleteness: blogData.organizationContext.dataCompleteness,
          recommendations: this.generateQualityRecommendations(organizationContext)
        }
      };

      console.log(`✅ Complete enhanced blog generation finished`);
      console.log(`📊 Quality prediction: ${completeResponse.qualityPrediction.expectedSEOScore} SEO score`);

      return completeResponse;

    } catch (error) {
      console.error('Complete enhanced blog generation error:', error);
      throw error;
    }
  }

  /**
   * Generate quality improvement recommendations
   */
  generateQualityRecommendations(organizationContext) {
    const recommendations = [];
    const { availability = {}, completenessScore = 0 } = organizationContext || {};

    if (!availability.has_blog_content) {
      recommendations.push({
        category: 'brand_voice',
        priority: 'high',
        message: 'Add brand voice guidelines to improve content consistency and quality scores',
        action: 'Upload existing blog content or provide manual brand voice inputs'
      });
    }

    if (!availability.has_cta_data) {
      recommendations.push({
        category: 'conversion',
        priority: 'medium',
        message: 'Add CTA preferences to improve conversion optimization scores',
        action: 'Provide manual CTA preferences or upload existing website content'
      });
    }

    if (!availability.has_internal_links) {
      recommendations.push({
        category: 'seo',
        priority: 'medium',
        message: 'Add internal linking strategy to boost SEO scores',
        action: 'Provide manual internal linking preferences or analyze existing website structure'
      });
    }

    if (completenessScore < 60) {
      recommendations.push({
        category: 'overall',
        priority: 'high',
        message: `Data completeness at ${completenessScore}% limits content quality potential`,
        action: 'Complete website analysis or provide additional manual inputs to reach 90%+ quality scores'
      });
    }

    return recommendations;
  }

  /**
   * Generate blog with iterative optimization to reach target score
   */
  async generateWithOptimization(topic, businessInfo, organizationId, targetScore = 95, options = {}) {
    console.log(`🎯 Starting iterative optimization targeting ${targetScore}+ SEO score`);
    
    const maxIterations = options.maxIterations || 3;
    let currentIteration = 0;
    let bestResult = null;
    let bestScore = 0;
    const attempts = [];

    while (currentIteration < maxIterations) {
      currentIteration++;
      console.log(`🔄 Optimization attempt ${currentIteration}/${maxIterations}`);

      try {
        // Generate blog post with improved instructions
        const iterationInstructions = currentIteration > 1 ? 
          `${options.additionalInstructions || ''} Previous attempt scored ${bestScore}. Focus on improving SEO optimization, content depth, and keyword integration to reach ${targetScore}+ score.` : 
          `${options.additionalInstructions || ''} Target ${targetScore}+ SEO score with comprehensive optimization.`;

        const blogResult = await this.generateCompleteEnhancedBlog(
          topic,
          businessInfo,
          organizationId,
          {
            ...options,
            additionalInstructions: iterationInstructions
          }
        );

        // Mock SEO score analysis (in real system, would use actual SEO analysis)
        const content = blogResult.content || '';
        const wordCount = content.split(' ').length;
        const hasHeaders = content.includes('#');
        const hasKeywords = blogResult.seoKeywords?.some(keyword => 
          content.toLowerCase().includes(keyword.toLowerCase())
        );
        
        const score = Math.min(95, 
          60 + 
          (wordCount > 1200 ? 20 : wordCount > 800 ? 15 : 10) + 
          (hasHeaders ? 10 : 0) + 
          (hasKeywords ? 15 : 5) +
          (blogResult.internalLinks?.length > 2 ? 10 : 5)
        );

        console.log(`📊 Attempt ${currentIteration} SEO score: ${score}`);

        attempts.push({
          iteration: currentIteration,
          score: score,
          blog: blogResult
        });

        // Update best result if this is better
        if (score > bestScore) {
          bestScore = score;
          bestResult = blogResult;
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

    return {
      bestResult: bestResult,
      finalScore: bestScore,
      targetReached: bestScore >= targetScore,
      attempts: attempts,
      iterations: currentIteration,
      maxIterations
    };
  }

  /**
   * Save enhanced blog post to database with metadata
   */
  async saveEnhancedBlogPost(userId, organizationId, blogData, options = {}) {
    try {
      const { v4: uuidv4 } = await import('uuid');
      const postId = uuidv4();

      // Save main blog post
      const result = await db.query(`
        INSERT INTO blog_posts (
          id, user_id, organization_id, title, content, meta_description,
          topic_data, generation_metadata, status, word_count, seo_score_prediction,
          internal_links_data, cta_suggestions_data, enhancement_level
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *
      `, [
        postId,
        userId,
        organizationId,
        blogData.title,
        blogData.content,
        blogData.metaDescription,
        JSON.stringify({ 
          title: blogData.title,
          subtitle: blogData.subtitle,
          tags: blogData.tags,
          seoKeywords: blogData.seoKeywords
        }),
        JSON.stringify(blogData.generationMetadata),
        options.status || 'draft',
        blogData.content ? blogData.content.split(' ').length : 0,
        blogData.qualityPrediction?.expectedSEOScore || null,
        JSON.stringify(blogData.internalLinks || []),
        JSON.stringify(blogData.ctaSuggestions || []),
        blogData.organizationContext?.enhancementLevel || 'basic'
      ]);

      console.log(`✅ Enhanced blog post saved: ${postId}`);
      return result.rows[0];

    } catch (error) {
      console.error('Error saving enhanced blog post:', error);
      throw error;
    }
  }
}

// Create and export service instance
const enhancedBlogGenerationService = new EnhancedBlogGenerationService();
export default enhancedBlogGenerationService;