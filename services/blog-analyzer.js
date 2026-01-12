import OpenAI from 'openai';
import db from './database.js';
import webscraper from './webscraper.js';

/**
 * Blog Content Analysis Service
 * Analyzes existing blog content for tone, style, CTAs, and linking patterns
 */
class BlogAnalyzerService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Perform comprehensive blog content analysis
   */
  async analyzeBlogContent(organizationId, websiteUrl) {
    try {
      console.log(`🔬 Starting comprehensive blog analysis for: ${websiteUrl}`);

      // Step 1: Discover blog content
      const blogDiscovery = await webscraper.discoverBlogPages(websiteUrl);
      
      if (blogDiscovery.blogPosts.length === 0) {
        console.log('⚠️ No blog content found, providing basic analysis');
        return this.createBasicAnalysis(websiteUrl);
      }

      // Step 2: Scrape detailed content from discovered posts
      const detailedPosts = await webscraper.scrapeBlogPosts(
        blogDiscovery.blogPosts.slice(0, 5).map(post => post.url)
      );

      // Step 3: Extract CTAs from main pages
      const ctaAnalysis = await this.analyzeCTAs(organizationId, websiteUrl);

      // Step 4: Analyze internal linking patterns
      const linkingAnalysis = await this.analyzeInternalLinking(organizationId, websiteUrl);

      // Step 5: Use AI to analyze tone and style patterns
      const contentAnalysis = await this.analyzeContentPatterns(detailedPosts);

      // Step 6: Store results in database
      await this.storeAnalysisResults(organizationId, {
        blogDiscovery,
        detailedPosts,
        ctaAnalysis,
        linkingAnalysis,
        contentAnalysis,
        websiteUrl
      });

      // Step 7: Return comprehensive analysis
      return {
        success: true,
        blogContentFound: detailedPosts.length,
        totalPostsDiscovered: blogDiscovery.totalPostsFound,
        blogSections: blogDiscovery.blogSections,
        contentPatterns: contentAnalysis,
        ctaStrategy: ctaAnalysis,
        linkingStrategy: linkingAnalysis,
        analysisQuality: this.assessAnalysisQuality(detailedPosts, ctaAnalysis, linkingAnalysis)
      };
    } catch (error) {
      console.error('Blog content analysis error:', error);
      throw new Error(`Blog analysis failed: ${error.message}`);
    }
  }

  /**
   * Analyze CTAs across the website
   */
  async analyzeCTAs(organizationId, websiteUrl) {
    try {
      console.log('🎯 Analyzing CTAs and conversion elements...');

      const urlObj = new URL(websiteUrl);
      const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

      // Check key pages for CTAs
      const pagesToAnalyze = [
        websiteUrl, // Homepage
        `${baseUrl}/about`,
        `${baseUrl}/contact`,
        `${baseUrl}/services`,
        `${baseUrl}/products`
      ];

      const allCTAs = [];
      const pageAnalysis = [];

      for (const pageUrl of pagesToAnalyze) {
        try {
          const ctas = await webscraper.extractCTAs(pageUrl);
          if (ctas.length > 0) {
            allCTAs.push(...ctas);
            pageAnalysis.push({
              url: pageUrl,
              ctaCount: ctas.length,
              ctas: ctas
            });
          }
        } catch (error) {
          console.warn(`Could not analyze CTAs on ${pageUrl}`);
        }
      }

      // Analyze CTA patterns with AI
      const ctaStrategy = await this.analyzeCtaPatterns(allCTAs);

      return {
        totalCTAs: allCTAs.length,
        pagesAnalyzed: pageAnalysis.length,
        ctasByPage: pageAnalysis,
        strategy: ctaStrategy,
        recommendations: this.generateCTARecommendations(allCTAs, ctaStrategy)
      };
    } catch (error) {
      console.error('CTA analysis error:', error);
      return {
        totalCTAs: 0,
        pagesAnalyzed: 0,
        ctasByPage: [],
        strategy: {},
        recommendations: [],
        error: error.message
      };
    }
  }

  /**
   * Analyze internal linking patterns
   */
  async analyzeInternalLinking(organizationId, websiteUrl) {
    try {
      console.log('🔗 Analyzing internal linking structure...');

      const linkingData = await webscraper.extractInternalLinks(websiteUrl);
      
      if (linkingData.totalLinksFound === 0) {
        return {
          totalLinks: 0,
          linkingStrategy: 'minimal',
          recommendations: ['Add internal linking to improve SEO and user navigation'],
          error: linkingData.error
        };
      }

      // Categorize links by type and context
      const linkCategories = this.categorizeLinks(linkingData.internalLinks);
      
      // Analyze linking patterns
      const linkingStrategy = await this.analyzeLinkingPatterns(linkingData.internalLinks);

      return {
        totalLinks: linkingData.totalLinksFound,
        linkCategories,
        linkingStrategy,
        recommendations: this.generateLinkingRecommendations(linkCategories, linkingStrategy)
      };
    } catch (error) {
      console.error('Internal linking analysis error:', error);
      return {
        totalLinks: 0,
        linkingStrategy: 'unknown',
        recommendations: [],
        error: error.message
      };
    }
  }

  /**
   * Analyze content patterns using AI
   */
  async analyzeContentPatterns(blogPosts) {
    if (!blogPosts || blogPosts.length === 0) {
      return {
        toneAnalysis: { tone: 'unknown', confidence: 0 },
        stylePatterns: {},
        contentThemes: [],
        writingStyle: 'unknown'
      };
    }

    try {
      // Combine content from all posts for analysis
      const combinedContent = blogPosts.map(post => ({
        title: post.title,
        content: post.content.slice(0, 1000), // Limit to avoid token limits
        headings: post.headings?.map(h => h.text).join(' | ') || ''
      }));

      const prompt = `Analyze these blog posts to identify content patterns and style:

${combinedContent.map(post => `
TITLE: ${post.title}
HEADINGS: ${post.headings}  
CONTENT: ${post.content.slice(0, 500)}...
`).join('\n---\n')}

Provide analysis in this exact JSON format:
{
  "toneAnalysis": {
    "primaryTone": "professional|casual|friendly|authoritative|conversational",
    "confidence": 0.85,
    "toneCharacteristics": ["specific traits observed"]
  },
  "stylePatterns": {
    "averageWordCount": 800,
    "sentenceLength": "short|medium|long",
    "paragraphStyle": "brief|moderate|detailed",
    "useOfQuestions": "frequent|occasional|rare",
    "personalPronouns": "first_person|third_person|mixed",
    "technicalLanguage": "high|medium|low"
  },
  "contentThemes": [
    {"theme": "theme name", "frequency": 3, "examples": ["example titles"]},
  ],
  "writingStyle": {
    "voiceDescription": "brief description of voice",
    "targetAudience": "inferred audience level",
    "contentPurpose": "educate|persuade|inform|entertain"
  },
  "brandVoiceKeywords": ["keyword1", "keyword2", "keyword3"],
  "contentGaps": ["suggested content areas not covered"]
}`;

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a content strategist analyzing blog content to identify patterns, tone, and style. Provide specific, actionable insights based on the actual content provided.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1500
      });

      const response = completion.choices[0].message.content;
      return this.parseAIResponse(response);
    } catch (error) {
      console.error('Content pattern analysis error:', error);
      return {
        toneAnalysis: { tone: 'analysis_failed', confidence: 0 },
        stylePatterns: {},
        contentThemes: [],
        writingStyle: 'unknown',
        error: error.message
      };
    }
  }

  /**
   * Analyze CTA patterns with AI
   */
  async analyzeCtaPatterns(ctas) {
    if (!ctas || ctas.length === 0) {
      return {
        strategy: 'minimal',
        primaryCTAType: 'unknown',
        effectiveness: 'low'
      };
    }

    try {
      const ctaSummary = ctas.map(cta => ({
        type: cta.type,
        text: cta.text,
        placement: cta.placement
      }));

      const prompt = `Analyze these CTAs to identify conversion strategy:

${JSON.stringify(ctaSummary, null, 2)}

Provide analysis in JSON format:
{
  "strategy": "aggressive|moderate|minimal",
  "primaryCTAType": "most common CTA type",
  "effectiveness": "high|medium|low",
  "conversionFocus": "what the business prioritizes",
  "recommendations": ["specific improvements"]
}`;

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a conversion optimization expert analyzing CTA strategy.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 800
      });

      const response = completion.choices[0].message.content;
      return this.parseAIResponse(response);
    } catch (error) {
      console.error('CTA pattern analysis error:', error);
      return {
        strategy: 'unknown',
        primaryCTAType: 'unknown',
        effectiveness: 'unknown',
        error: error.message
      };
    }
  }

  /**
   * Analyze linking patterns
   */
  async analyzeLinkingPatterns(links) {
    const linksByContext = {};
    const linksByType = {};

    links.forEach(link => {
      linksByContext[link.context] = (linksByContext[link.context] || 0) + 1;
      linksByType[link.linkType] = (linksByType[link.linkType] || 0) + 1;
    });

    return {
      contextDistribution: linksByContext,
      typeDistribution: linksByType,
      totalInternalLinks: links.length,
      linkingDensity: links.length > 20 ? 'high' : links.length > 10 ? 'medium' : 'low'
    };
  }

  /**
   * Categorize links by type and context
   */
  categorizeLinks(links) {
    const categories = {
      navigation: [],
      content: [],
      footer: [],
      sidebar: [],
      blog: [],
      product: [],
      about: [],
      contact: []
    };

    links.forEach(link => {
      // Categorize by context
      if (categories[link.context]) {
        categories[link.context].push(link);
      }
      
      // Also categorize by link type
      if (categories[link.linkType]) {
        categories[link.linkType].push(link);
      }
    });

    return categories;
  }

  /**
   * Generate CTA recommendations
   */
  generateCTARecommendations(ctas, strategy) {
    const recommendations = [];

    if (ctas.length === 0) {
      recommendations.push('Add clear call-to-action buttons to improve conversions');
      recommendations.push('Consider adding email capture forms');
      recommendations.push('Include contact information prominently');
      return recommendations;
    }

    // Check for CTA diversity
    const ctaTypes = new Set(ctas.map(cta => cta.type));
    if (ctaTypes.size < 3) {
      recommendations.push('Diversify CTA types (contact, demo, trial, email capture)');
    }

    // Check for placement variety
    const placements = new Set(ctas.map(cta => cta.placement));
    if (!placements.has('header')) {
      recommendations.push('Add prominent CTA in header for immediate visibility');
    }

    if (strategy.effectiveness === 'low') {
      recommendations.push('Improve CTA text to be more action-oriented and specific');
      recommendations.push('Test CTA placement and design for better visibility');
    }

    return recommendations;
  }

  /**
   * Generate linking recommendations
   */
  generateLinkingRecommendations(linkCategories, linkingStrategy) {
    const recommendations = [];

    if (linkingStrategy.totalInternalLinks < 10) {
      recommendations.push('Increase internal linking to improve SEO and user navigation');
      recommendations.push('Link to related blog posts from within content');
    }

    if (linkingStrategy.linkingDensity === 'low') {
      recommendations.push('Add contextual links within blog content to related pages');
    }

    if (linkCategories.blog.length < 3) {
      recommendations.push('Create more cross-links between blog posts on related topics');
    }

    return recommendations;
  }

  /**
   * Assess overall analysis quality
   */
  assessAnalysisQuality(posts, ctas, linking) {
    let score = 0;
    const factors = [];

    // Blog content quality
    if (posts.length >= 3) {
      score += 40;
      factors.push('Sufficient blog content for analysis');
    } else if (posts.length > 0) {
      score += 20;
      factors.push('Limited blog content found');
    } else {
      factors.push('No blog content found - analysis incomplete');
    }

    // CTA analysis quality  
    if (ctas.totalCTAs >= 5) {
      score += 30;
      factors.push('Comprehensive CTA analysis possible');
    } else if (ctas.totalCTAs > 0) {
      score += 15;
      factors.push('Basic CTA analysis completed');
    } else {
      factors.push('No CTAs found - conversion analysis incomplete');
    }

    // Linking analysis quality
    if (linking.totalLinks >= 10) {
      score += 30;
      factors.push('Good internal linking structure found');
    } else if (linking.totalLinks > 0) {
      score += 15;
      factors.push('Basic linking structure identified');
    } else {
      factors.push('Limited linking structure - SEO analysis incomplete');
    }

    return {
      score: Math.min(score, 100),
      quality: score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'limited',
      factors
    };
  }

  /**
   * Create basic analysis for sites with no blog content
   */
  createBasicAnalysis(websiteUrl) {
    return {
      success: true,
      blogContentFound: 0,
      totalPostsDiscovered: 0,
      blogSections: [],
      contentPatterns: {
        toneAnalysis: { tone: 'unknown', confidence: 0 },
        stylePatterns: {},
        contentThemes: [],
        writingStyle: 'unknown'
      },
      ctaStrategy: {
        totalCTAs: 0,
        strategy: 'unknown',
        recommendations: ['Add blog section to website', 'Create content strategy']
      },
      linkingStrategy: {
        totalLinks: 0,
        recommendations: ['Establish internal linking strategy', 'Create content interconnections']
      },
      analysisQuality: {
        score: 10,
        quality: 'limited',
        factors: ['No blog content found', 'Manual content upload recommended']
      },
      recommendations: {
        immediate: [
          'Add blog section to website',
          'Create initial blog posts for content analysis',
          'Consider manual content upload for analysis'
        ],
        strategic: [
          'Develop content strategy based on target audience',
          'Plan internal linking structure',
          'Design conversion-focused CTAs'
        ]
      }
    };
  }

  /**
   * Store analysis results in database
   */
  async storeAnalysisResults(organizationId, analysisData) {
    try {
      let storedCount = 0;
      
      // First, store ALL discovered posts (including sitemap-discovered ones)
      const allDiscoveredPosts = analysisData.blogDiscovery.blogPosts || [];
      
      for (const post of allDiscoveredPosts) {
        // Check if this post has detailed content (was fully scraped)
        const detailedPost = analysisData.detailedPosts.find(dp => dp.url === post.url);
        
        // Use enhanced schema fields for better classification
        const insertQuery = `
          INSERT INTO website_pages (
            organization_id, url, page_type, title, content, meta_description,
            published_date, author, internal_links, external_links, 
            page_classification, discovered_from, featured_image_url, 
            excerpt, discovery_priority, discovery_confidence, 
            word_count, scraped_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
          ON CONFLICT (organization_id, url) DO UPDATE SET
            title = COALESCE(EXCLUDED.title, website_pages.title),
            content = COALESCE(EXCLUDED.content, website_pages.content),
            meta_description = COALESCE(EXCLUDED.meta_description, website_pages.meta_description),
            published_date = COALESCE(EXCLUDED.published_date, website_pages.published_date),
            author = COALESCE(EXCLUDED.author, website_pages.author),
            internal_links = COALESCE(EXCLUDED.internal_links, website_pages.internal_links),
            external_links = COALESCE(EXCLUDED.external_links, website_pages.external_links),
            page_classification = COALESCE(EXCLUDED.page_classification, website_pages.page_classification),
            discovered_from = COALESCE(EXCLUDED.discovered_from, website_pages.discovered_from),
            featured_image_url = COALESCE(EXCLUDED.featured_image_url, website_pages.featured_image_url),
            excerpt = COALESCE(EXCLUDED.excerpt, website_pages.excerpt),
            discovery_priority = COALESCE(EXCLUDED.discovery_priority, website_pages.discovery_priority),
            discovery_confidence = COALESCE(EXCLUDED.discovery_confidence, website_pages.discovery_confidence),
            word_count = COALESCE(EXCLUDED.word_count, website_pages.word_count),
            scraped_at = EXCLUDED.scraped_at
        `;

        const values = [
          organizationId,
          post.url,
          'blog_post',
          // Use detailed post data if available, otherwise discovered post data
          detailedPost?.title || post.title,
          detailedPost?.content?.slice(0, 10000) || post.content || '',
          detailedPost?.metaDescription || post.metaDescription || '',
          // Handle different date formats
          (() => {
            const dateValue = detailedPost?.publishDate || post.publishedDate || post.lastModified;
            if (!dateValue) return null;
            try {
              return new Date(dateValue);
            } catch (e) {
              return null;
            }
          })(),
          detailedPost?.author || post.author || null,
          JSON.stringify(detailedPost?.internalLinks || post.internalLinks || []),
          JSON.stringify(detailedPost?.externalLinks || post.externalLinks || []),
          // Enhanced schema fields
          'blog_post', // page_classification
          post.discoveredFrom || 'unknown', // discovered_from
          post.featuredImageUrl || null, // featured_image_url
          post.excerpt || detailedPost?.metaDescription || '', // excerpt
          Math.round((post.priority || 0.5) * 3) || 2, // discovery_priority: Convert 0.0-1.0 to 1-3 scale (1=high, 2=medium, 3=low)
          post.confidence || 0.8, // discovery_confidence
          detailedPost?.wordCount || post.wordCount || null, // word_count
        ];
        
        await db.query(insertQuery, values);
        storedCount++;
      }

      console.log(`✅ Stored ${storedCount} blog posts in database (${analysisData.detailedPosts.length} with full content, ${allDiscoveredPosts.length - analysisData.detailedPosts.length} with metadata only)`);
    } catch (error) {
      console.error('Failed to store analysis results:', error.message);
      console.error('Error details:', error);
    }
  }

  /**
   * Parse AI response with error handling
   */
  parseAIResponse(response) {
    try {
      // Clean the response
      let cleaned = response.trim();
      
      // Remove markdown code blocks if present
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.substring(7);
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.substring(3);
      }
      
      if (cleaned.endsWith('```')) {
        cleaned = cleaned.slice(0, -3);
      }
      
      return JSON.parse(cleaned);
    } catch (error) {
      console.error('Failed to parse AI response:', error);
      return { error: 'Failed to parse AI analysis' };
    }
  }
}

export default new BlogAnalyzerService();