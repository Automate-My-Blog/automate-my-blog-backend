import OpenAI from 'openai';
import db from './database.js';
import webscraper from './webscraper.js';
import { normalizeCTA } from '../utils/cta-normalizer.js';

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
      console.log('🔍 About to scrape detailed content for posts:', blogDiscovery.blogPosts.slice(0, 5).map(post => post.url));
      const detailedPosts = await webscraper.scrapeBlogPosts(
        blogDiscovery.blogPosts.slice(0, 5).map(post => post.url)
      );
      
      console.log('📊 Detailed posts scraping results:');
      detailedPosts.forEach((post, index) => {
        console.log(`📄 Post ${index + 1}: ${post?.url}`);
        console.log(`  - Title: ${post?.title?.substring(0, 50)}...`);
        console.log(`  - Content length: ${post?.content?.length || 0}`);
        console.log(`  - Word count: ${post?.wordCount || 0}`);
        console.log(`  - Internal links: ${post?.internalLinks?.length || 0}`);
        console.log(`  - External links: ${post?.externalLinks?.length || 0}`);
        console.log(`  - CTAs: ${post?.ctas?.length || 0}`);
      });

      // Step 3: Extract CTAs from main pages AND blog posts
      const ctaAnalysis = await this.analyzeCTAs(organizationId, websiteUrl, detailedPosts);

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
   * Analyze CTAs across the website including blog posts
   */
  async analyzeCTAs(organizationId, websiteUrl, blogPosts = []) {
    try {
      console.log('🎯 Analyzing CTAs and conversion elements...');
      console.log('🎯 [CTA DEBUG] Starting CTA analysis for:', { organizationId, websiteUrl, blogPostCount: blogPosts.length });

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

      // Analyze static pages
      for (const pageUrl of pagesToAnalyze) {
        try {
          const ctas = await webscraper.extractCTAs(pageUrl);
          console.log('🎯 [CTA DEBUG] Extracted CTAs from page:', {
            pageUrl: pageUrl,
            ctaCount: ctas.length,
            ctas: ctas.map(c => ({ text: c.text, type: c.type, href: c.href }))
          });
          if (ctas.length > 0) {
            allCTAs.push(...ctas.map(cta => ({ ...cta, page_url: pageUrl })));
            pageAnalysis.push({
              url: pageUrl,
              ctaCount: ctas.length,
              ctas: ctas.map(cta => ({ ...cta, page_url: pageUrl }))
            });
          }
        } catch (error) {
          console.error('🚨 [CTA DEBUG] Failed to extract CTAs from page:', {
            pageUrl: pageUrl,
            error: error.message
          });
          console.warn(`Could not analyze CTAs on ${pageUrl}`);
        }
      }

      // Extract CTAs from blog posts (already collected during scraping)
      console.log('🎯 Processing CTAs from blog posts...');
      let blogCtaCount = 0;
      
      for (const post of blogPosts) {
        if (post.ctas && post.ctas.length > 0) {
          console.log(`📝 Found ${post.ctas.length} CTAs in blog post: ${post.title}`);
          allCTAs.push(...post.ctas);
          
          pageAnalysis.push({
            url: post.url,
            title: post.title,
            ctaCount: post.ctas.length,
            ctas: post.ctas,
            pageType: 'blog_post'
          });
          
          blogCtaCount += post.ctas.length;
        }
      }

      console.log('🎯 [CTA DEBUG] Blog post CTA processing complete:', {
        totalBlogCTAs: blogCtaCount,
        blogPostsWithCTAs: blogPosts.filter(p => p.ctas && p.ctas.length > 0).length
      });

      console.log(`🎯 Total CTAs found: ${allCTAs.length} (${blogCtaCount} from blog posts, ${allCTAs.length - blogCtaCount} from static pages)`);

      // Analyze CTA patterns with AI
      const ctaStrategy = await this.analyzeCtaPatterns(allCTAs);

      console.log('🎯 [CTA DEBUG] CTA analysis complete:', {
        totalCTAs: allCTAs.length,
        blogCTAs: blogCtaCount,
        staticPageCTAs: allCTAs.length - blogCtaCount,
        pagesAnalyzed: pageAnalysis.length,
        ctaSummary: allCTAs.map(c => ({ page: c.page_url, text: c.text, href: c.href }))
      });

      return {
        totalCTAs: allCTAs.length,
        blogCTAs: blogCtaCount,
        staticPageCTAs: allCTAs.length - blogCtaCount,
        pagesAnalyzed: pageAnalysis.length,
        ctasByPage: pageAnalysis,
        strategy: ctaStrategy,
        recommendations: this.generateCTARecommendations(allCTAs, ctaStrategy)
      };
    } catch (error) {
      console.error('CTA analysis error:', error);
      console.error('🚨 [CTA DEBUG] CTA analysis failed completely:', {
        organizationId,
        websiteUrl,
        error: error.message,
        stack: error.stack
      });
      return {
        totalCTAs: 0,
        blogCTAs: 0,
        staticPageCTAs: 0,
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
        // Use URL matching that handles www/non-www variations
        const detailedPost = analysisData.detailedPosts.find(dp => 
          webscraper.urlsMatch(dp.url, post.url)
        );
        
        console.log(`🔗 URL matching for: ${post.url}`);
        console.log(`  - Found detailed post: ${!!detailedPost}`);
        if (detailedPost) {
          console.log(`  - Detailed URL: ${detailedPost.url}`);
          console.log(`  - Word count: ${detailedPost.wordCount}`);
          console.log(`  - Content length: ${detailedPost.content?.length}`);
        }
        
        // Enhanced data is successfully mapped and will be stored for matched posts
        
        // Use enhanced schema fields for better classification
        const insertQuery = `
          INSERT INTO website_pages (
            organization_id, url, page_type, title, content, meta_description,
            published_date, author, internal_links, external_links, 
            page_classification, discovered_from, featured_image_url, 
            excerpt, discovery_priority, discovery_confidence, 
            word_count, visual_design, content_structure, ctas_extracted,
            last_modified_date, sitemap_priority, sitemap_changefreq, scraped_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, NOW())
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
            visual_design = COALESCE(EXCLUDED.visual_design, website_pages.visual_design),
            content_structure = COALESCE(EXCLUDED.content_structure, website_pages.content_structure),
            ctas_extracted = COALESCE(EXCLUDED.ctas_extracted, website_pages.ctas_extracted),
            last_modified_date = COALESCE(EXCLUDED.last_modified_date, website_pages.last_modified_date),
            sitemap_priority = COALESCE(EXCLUDED.sitemap_priority, website_pages.sitemap_priority),
            sitemap_changefreq = COALESCE(EXCLUDED.sitemap_changefreq, website_pages.sitemap_changefreq),
            scraped_at = EXCLUDED.scraped_at
        `;

        const values = [
          organizationId,
          post.url,
          'blog_post',
          // Use detailed post data if available, otherwise discovered post data
          detailedPost?.title || post.title,
          detailedPost?.content || post.content || '',
          detailedPost?.metaDescription || post.metaDescription || '',
          // Handle different date formats for published_date
          (() => {
            const dateValue = detailedPost?.publishDate || post.publishedDate;
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
          // Enhanced data fields (from detailed scraping)
          detailedPost?.visualDesign ? JSON.stringify(detailedPost.visualDesign) : null, // visual_design
          detailedPost?.visualDesign?.contentStructure ? JSON.stringify(detailedPost.visualDesign.contentStructure) : null, // content_structure
          detailedPost?.ctas ? JSON.stringify(detailedPost.ctas) : null, // ctas_extracted
          // Sitemap metadata fields (preserve all sitemap data)
          (() => {
            const lastModValue = post.lastModified;
            if (!lastModValue) return null;
            try {
              return new Date(lastModValue);
            } catch (e) {
              return null;
            }
          })(), // last_modified_date
          post.priority || null, // sitemap_priority (preserve original 0.0-1.0 value)
          post.changeFreq || null, // sitemap_changefreq
        ];
        
        await db.query(insertQuery, values);
        storedCount++;
      }

      console.log(`✅ Stored ${storedCount} blog posts in database (${analysisData.detailedPosts.length} with full content, ${allDiscoveredPosts.length - analysisData.detailedPosts.length} with metadata only)`);

      // Store CTAs from analysis
      let ctaStoredCount = 0;
      if (analysisData.ctaAnalysis && analysisData.ctaAnalysis.ctasByPage) {
        console.log('🎯 Storing CTA analysis data...');
        console.log('🎯 [CTA DEBUG] Preparing to store CTAs:', {
          organizationId,
          hasCTAData: analysisData.ctaAnalysis?.totalCTAs > 0,
          ctaCount: analysisData.ctaAnalysis?.totalCTAs || 0,
          ctaPages: analysisData.ctaAnalysis?.ctasByPage?.length || 0
        });
        
        for (const pageAnalysis of analysisData.ctaAnalysis.ctasByPage) {
          for (const cta of pageAnalysis.ctas) {
            try {
              // Normalize CTA using centralized utility
              const normalized = normalizeCTA(cta);
              const pageUrl = cta.page_url || pageAnalysis.url;

              console.log('🎯 [CTA DEBUG] Storing individual CTA (normalized):', {
                pageUrl,
                ctaText: normalized.cta_text,
                ctaType: normalized.cta_type,
                placement: normalized.placement,
                href: normalized.href
              });

              await db.query(`
                INSERT INTO cta_analysis (
                  organization_id, page_url, cta_text, cta_type, placement,
                  href, context, class_name, tag_name, conversion_potential,
                  visibility_score, page_type, analysis_source, data_source, scraped_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
                ON CONFLICT (organization_id, page_url, cta_text, placement) DO UPDATE SET
                  cta_type = EXCLUDED.cta_type,
                  href = EXCLUDED.href,
                  context = EXCLUDED.context,
                  class_name = EXCLUDED.class_name,
                  tag_name = EXCLUDED.tag_name,
                  conversion_potential = EXCLUDED.conversion_potential,
                  visibility_score = EXCLUDED.visibility_score,
                  page_type = EXCLUDED.page_type,
                  analysis_source = EXCLUDED.analysis_source,
                  data_source = EXCLUDED.data_source,
                  scraped_at = EXCLUDED.scraped_at
              `, [
                organizationId,
                pageUrl,
                normalized.cta_text,
                normalized.cta_type,
                normalized.placement,
                normalized.href,
                normalized.context,
                normalized.class_name,
                normalized.tag_name,
                normalized.conversion_potential,
                normalized.visibility_score,
                pageAnalysis.pageType || (pageAnalysis.url?.includes('/blog/') ? 'blog_post' : 'static_page'),
                'blog_scraping',
                'scraped'  // Track that this CTA came from website scraping
              ]);

              ctaStoredCount++;
              console.log('✅ [CTA DEBUG] CTA stored successfully:', {
                ctaText: normalized.cta_text,
                organizationId
              });
            } catch (ctaError) {
              console.error('🚨 [CTA DEBUG] Failed to store individual CTA:', {
                ctaText: cta.text || 'Unknown CTA',
                pageUrl: cta.page_url || pageAnalysis.url,
                error: ctaError.message,
                organizationId
              });
              console.warn(`Failed to store CTA: ${ctaError.message}`);
            }
          }
        }
      }

      console.log(`✅ Stored ${ctaStoredCount} CTAs in database`);
      console.log('✅ [CTA DEBUG] CTA storage complete:', {
        totalStoredCTAs: ctaStoredCount,
        expectedCTAs: analysisData.ctaAnalysis?.ctasByPage?.reduce((sum, page) => sum + page.ctas.length, 0) || 0,
        organizationId,
        success: ctaStoredCount > 0
      });

      // Update organization has_cta_data flag if CTAs were stored
      if (ctaStoredCount > 0) {
        await db.query(`
          UPDATE organizations
          SET data_availability = jsonb_set(
            COALESCE(data_availability, '{}'::jsonb),
            '{has_cta_data}',
            'true'::jsonb
          )
          WHERE id = $1
        `, [organizationId]);

        console.log('🎯 [CTA DEBUG] Updated has_cta_data flag in blog analyzer:', {
          organizationId,
          has_cta_data: true,
          ctasStored: ctaStoredCount
        });
      }
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