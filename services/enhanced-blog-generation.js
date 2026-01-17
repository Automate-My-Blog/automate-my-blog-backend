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
      console.log('📊 [CTA DEBUG] Content Gen: Loading organization context:', { organizationId });

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

      console.log('📊 [CTA DEBUG] Content Gen: Data availability check:', {
        organizationId,
        availability: {
          has_blog_content: availability.has_blog_content,
          has_cta_data: availability.has_cta_data,
          has_internal_links: availability.has_internal_links,
          completeness_score: availability.completeness_score
        }
      });

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

      console.log('🎯 [CTA DEBUG] Content Gen: Checking if has_cta_data flag is true:', {
        organizationId,
        has_cta_data: availability.has_cta_data
      });

      if (availability.has_cta_data) {
        const ctaResult = await db.query(
          'SELECT cta_text, cta_type, placement, href, context, data_source FROM cta_analysis WHERE organization_id = $1 ORDER BY conversion_potential DESC LIMIT 10',
          [organizationId]
        );
        websiteData.ctas = ctaResult.rows;

        console.log('📊 [CTA DEBUG] Content Gen: CTA query result:', {
          organizationId,
          ctaCount: ctaResult.rows.length,
          ctas: ctaResult.rows.map(cta => ({
            cta_text: cta.cta_text,
            cta_type: cta.cta_type,
            href: cta.href,
            placement: cta.placement,
            data_source: cta.data_source
          }))
        });
      } else {
        console.warn('⚠️ [CTA DEBUG] Content Gen: has_cta_data is FALSE - skipping CTA query:', {
          organizationId,
          availability
        });
      }

      if (availability.has_internal_links) {
        const linkResult = await db.query(
          'SELECT target_url, anchor_text, link_type FROM internal_linking_analysis WHERE organization_id = $1 ORDER BY seo_value DESC LIMIT 15',
          [organizationId]
        );
        websiteData.internal_links = linkResult.rows;
      }

      console.log('✅ [CTA DEBUG] Content Gen: Organization context loaded:', {
        organizationId,
        hasWebsiteData: Object.keys(websiteData).length > 0,
        websiteDataCTACount: websiteData?.ctas?.length || 0,
        websiteDataCTAs: websiteData?.ctas || [],
        completenessScore: availability.completeness_score || 0
      });

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
   * Get highlight box types used in previous post to avoid repetition
   */
  async getPreviousPostHighlightBoxTypes(organizationId) {
    try {
      console.log(`📊 Retrieving previous post highlight box types for organization: ${organizationId}`);

      // Query database for most recent blog post by this organization
      // blog_posts doesn't have organization_id, so we JOIN with projects
      const query = `
        SELECT bp.content
        FROM blog_posts bp
        INNER JOIN projects p ON bp.project_id = p.id
        WHERE p.organization_id = $1
        ORDER BY bp.created_at DESC
        LIMIT 1
      `;

      const result = await db.query(query, [organizationId]);

      if (!result.rows || result.rows.length === 0) {
        console.log('📊 No previous posts found - this is the first post');
        return []; // No previous posts
      }

      const previousContent = result.rows[0].content;

      // Extract all highlight box types from content using regex
      const highlightBoxRegex = /data-highlight-type="(\w+)"/g;
      const boxTypes = new Set();
      let match;

      while ((match = highlightBoxRegex.exec(previousContent)) !== null) {
        boxTypes.add(match[1]);
      }

      const typesArray = Array.from(boxTypes);
      console.log(`✅ Found ${typesArray.length} highlight box types in previous post:`, typesArray);

      return typesArray;
    } catch (error) {
      console.error('Error retrieving previous highlight box types:', error);
      return []; // Fail gracefully
    }
  }

  /**
   * Process image placeholders and replace with generated images
   */
  async processImagePlaceholders(content, topic, organizationId) {
    try {
      console.log('🎨 Processing image placeholders in content...');

      // Extract all image placeholders using regex
      const imageRegex = /!\[IMAGE:(\w+):(.*?)\]/g;
      const placeholders = [];
      let match;

      while ((match = imageRegex.exec(content)) !== null) {
        placeholders.push({
          fullMatch: match[0],
          type: match[1],
          description: match[2]
        });
      }

      if (placeholders.length === 0) {
        console.log('📊 No image placeholders found in content');
        return content;
      }

      console.log(`📊 Found ${placeholders.length} image placeholders to process`);

      // Get brand guidelines if available
      const brandResult = await db.query(
        'SELECT input_data FROM user_manual_inputs WHERE organization_id = $1 AND input_type = $2 AND validated = TRUE',
        [organizationId, 'brand_colors']
      );

      let brandGuidelines = {};
      if (brandResult.rows.length > 0) {
        brandGuidelines = JSON.parse(brandResult.rows[0].input_data);
      }

      // Generate images for each placeholder in parallel
      const imagePromises = placeholders.map(async (placeholder, index) => {
        try {
          console.log(`🎨 Generating image ${index + 1}/${placeholders.length}: ${placeholder.type}`);

          const imageResult = await this.visualContentService.generateVisualContent({
            organizationId: organizationId,
            prompt: placeholder.description,
            contentType: placeholder.type,
            brandGuidelines: brandGuidelines
          });

          return {
            placeholder: placeholder.fullMatch,
            imageUrl: imageResult.imageUrl,
            altText: placeholder.description.substring(0, 100)
          };
        } catch (error) {
          console.error(`❌ Failed to generate image for placeholder:`, error.message);
          return null;
        }
      });

      const generatedImages = await Promise.all(imagePromises);

      // Replace placeholders with markdown image syntax
      let processedContent = content;
      let replacedCount = 0;

      generatedImages.forEach(image => {
        if (image && image.imageUrl) {
          const markdownImage = `![${image.altText}](${image.imageUrl})`;
          processedContent = processedContent.replace(image.placeholder, markdownImage);
          replacedCount++;
          console.log(`✅ Replaced image placeholder with: ${image.imageUrl.substring(0, 50)}...`);
        }
      });

      console.log(`✅ Image processing complete: ${replacedCount}/${placeholders.length} images generated`);
      return processedContent;

    } catch (error) {
      console.error('❌ Error processing image placeholders:', error);
      // Return original content if image processing fails
      return content;
    }
  }

  /**
   * Build enhanced generation prompt with all available data
   */
  buildEnhancedPrompt(topic, businessInfo, organizationContext, additionalInstructions = '', previousBoxTypes = []) {
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

    // Internal linking context with real pages
    if (websiteData.internal_links && websiteData.internal_links.length > 0) {
      const linkContext = `INTERNAL LINKS (real pages from your website):

${websiteData.internal_links.map((link, i) =>
  `${i + 1}. ${link.anchor_text} → ${link.target_url}
   Content type: ${link.link_type}`
).join('\n')}

INTERNAL LINKING INSTRUCTIONS:
- Use these links when referencing your own services, content, or company information
- ONLY link to pages from the list above - do not create placeholder internal links
- Link naturally within the content flow - don't force links
- Use descriptive anchor text that matches the context
- Aim for 3-5 internal links if they fit naturally`;
      contextSections.push(linkContext);
    } else if (manualData.internal_linking) {
      const linkContext = `INTERNAL LINKING STRATEGY: ${JSON.stringify(manualData.internal_linking)}`;
      contextSections.push(linkContext);
    }

    // External references instructions
    const externalRefInstructions = `EXTERNAL REFERENCES (for citations and credibility):
When citing medical information, research, statistics, or expert opinions:
- You may reference well-known, authoritative sources (e.g., NIH, CDC, Mayo Clinic, academic institutions)
- Use general knowledge about these sources - do NOT fabricate specific studies or statistics
- Reference the type of information available from these sources (e.g., "According to medical research..." rather than "A 2024 study found...")
- Prefer .gov sites, .edu sites, established medical institutions, and professional organizations
- Only reference information that is widely known and established in the field
- DO NOT create fake URLs or specific article titles
- If you're not certain about a source or statistic, omit it rather than fabricate it`;
    contextSections.push(externalRefInstructions);

    // CTA context with real URLs
    console.log('🎯 [CTA DEBUG] Prompt Building: Checking CTA availability:', {
      hasWebsiteDataCTAs: websiteData?.ctas && websiteData.ctas.length > 0,
      ctaCount: websiteData?.ctas?.length || 0,
      hasManualCTAPreferences: !!manualData?.cta_preferences
    });

    if (websiteData.ctas && websiteData.ctas.length > 0) {
      console.log('✅ [CTA DEBUG] Prompt Building: Adding REAL CTAs to prompt:', {
        ctaCount: websiteData.ctas.length,
        ctas: websiteData.ctas.map(cta => ({
          text: cta.cta_text,
          href: cta.href,
          type: cta.cta_type,
          placement: cta.placement
        }))
      });

      const ctaContext = `AVAILABLE CTAS (use these EXACT URLs - do not modify):

${websiteData.ctas.map((cta, i) =>
  `${i + 1}. "${cta.cta_text}" → ${cta.href}
   Type: ${cta.cta_type} | Best placement: ${cta.placement}
   Context: ${cta.context || 'General use'}`
).join('\n\n')}

CRITICAL CTA INSTRUCTIONS:
- ONLY use CTAs from the list above
- Use the EXACT href URLs provided - do not modify them
- Integrate CTAs naturally where they fit the content flow
- If a CTA doesn't fit naturally, skip it (don't force it)
- NEVER create placeholder URLs like "https://www.yourwebsite.com/..."
- If no CTAs fit, it's okay to have none`;
      contextSections.push(ctaContext);
    } else if (manualData.cta_preferences) {
      console.log('⚠️ [CTA DEBUG] Prompt Building: Using manual CTA preferences (no real CTAs):', {
        cta_preferences: manualData.cta_preferences
      });
      const ctaContext = `CTA PREFERENCES: ${JSON.stringify(manualData.cta_preferences)}`;
      contextSections.push(ctaContext);
    } else {
      console.warn('🚨 [CTA DEBUG] Prompt Building: NO CTAs AVAILABLE - instructing OpenAI to skip CTAs:', {
        hasWebsiteDataCTAs: false,
        hasManualCTAPreferences: false
      });
      // No CTAs available - inform OpenAI
      const noCTAContext = `NO CTAS AVAILABLE: This organization has not configured CTAs yet. Do not include any calls-to-action or generate placeholder URLs. Create informational content only.`;
      contextSections.push(noCTAContext);
    }

    // Target audience context
    if (manualData.target_audience) {
      const audienceContext = `TARGET AUDIENCE DETAILS: ${JSON.stringify(manualData.target_audience)}`;
      contextSections.push(audienceContext);
    }

    // SEO optimization instructions (conditional based on available data)
    const seoTarget = settings.target_seo_score || 95;
    const hasInternalLinks = websiteData.internal_links && websiteData.internal_links.length > 0;
    const hasCTAs = websiteData.ctas && websiteData.ctas.length > 0;

    console.log('🎯 [CTA DEBUG] Prompt Building: CTA flag for SEO instructions:', {
      hasCTAs,
      willIncludeCTAInstruction: hasCTAs ? 'Yes - use provided CTAs' : 'No - skip CTAs'
    });

    const seoInstructions = `
SEO OPTIMIZATION TARGET: ${seoTarget}+ score
CRITICAL SEO REQUIREMENTS:
- Title: 50-60 characters, compelling and keyword-rich
- Meta description: 150-160 characters, action-oriented
- Headings: Use H1, H2, H3 hierarchy with target keywords
- Content: 1200-1800 words for comprehensive coverage
${hasInternalLinks ? '- Include 3-5 internal links naturally within content (ONLY from the provided INTERNAL LINKS list)' : '- Do NOT include internal links to other pages (no internal links available)'}
${hasCTAs ? '- Add 2-3 relevant CTAs based on content flow (ONLY from the provided AVAILABLE CTAS list)' : '- Do NOT include CTAs (no CTAs configured)'}
- Use semantic keywords and related terms throughout
- Ensure mobile-friendly structure with scannable paragraphs
- Include actionable takeaways and clear value propositions`;

    // Data completeness indicator
    const dataContext = `DATA COMPLETENESS: ${completenessScore}% (${availability.has_blog_content ? '✓' : '✗'} Brand voice, ${availability.has_cta_data ? '✓' : '✗'} CTAs, ${availability.has_internal_links ? '✓' : '✗'} Internal links)`;

    // Build highlight box instructions with exclusions
    const allBoxTypes = ['statistic', 'pullquote', 'takeaway', 'warning', 'tip', 'definition', 'process', 'comparison'];
    const availableBoxTypes = allBoxTypes.filter(type => !previousBoxTypes.includes(type));

    let highlightBoxInstructions = `
## HIGHLIGHT BOX INSTRUCTIONS

You MUST automatically wrap qualifying content in highlight boxes using this HTML format:

<blockquote data-highlight-box="" data-highlight-type="TYPE" data-width="WIDTH" data-font-size="SIZE" data-layout="LAYOUT" data-align="ALIGN" data-custom-bg="BG_COLOR" data-custom-border="BORDER_COLOR">CONTENT</blockquote>

**8 Highlight Box Types:**

1. **statistic** - For numbers, percentages, data points
   - Example: <blockquote data-highlight-box="" data-highlight-type="statistic" data-width="100%" data-font-size="xxlarge" data-layout="block" data-align="center" data-custom-bg="#e6f7ff" data-custom-border="#1890ff">73% increase in engagement</blockquote>

2. **pullquote** - For expert quotes, testimonials, insights
   - Example: <blockquote data-highlight-box="" data-highlight-type="pullquote" data-width="50%" data-font-size="large" data-layout="float-right" data-align="left" data-custom-bg="#f6ffed" data-custom-border="#52c41a">"Content marketing generates 3x more leads"</blockquote>

3. **takeaway** - For main points, conclusions
   - Example: <blockquote data-highlight-box="" data-highlight-type="takeaway" data-width="100%" data-font-size="medium" data-layout="block" data-align="left" data-custom-bg="#fff7e6" data-custom-border="#fa8c16">The bottom line: Email marketing remains the highest ROI channel</blockquote>

4. **warning** - For critical info, alerts
   - Example: <blockquote data-highlight-box="" data-highlight-type="warning" data-width="100%" data-font-size="medium" data-layout="block" data-align="left" data-custom-bg="#fff1f0" data-custom-border="#ff4d4f">Critical: Never buy email lists!</blockquote>

5. **tip** - For pro tips, best practices
   - Example: <blockquote data-highlight-box="" data-highlight-type="tip" data-width="50%" data-font-size="small" data-layout="float-left" data-align="left" data-custom-bg="#e6f7ff" data-custom-border="#1890ff">Pro tip: Test subject lines with A/B testing</blockquote>

6. **definition** - For glossary terms, acronyms
   - Example: <blockquote data-highlight-box="" data-highlight-type="definition" data-width="100%" data-font-size="small" data-layout="block" data-align="left" data-custom-bg="#f0f5ff" data-custom-border="#2f54eb"><strong>SEO:</strong> Increasing website visibility in search results</blockquote>

7. **process** - For step-by-step instructions
   - Example: <blockquote data-highlight-box="" data-highlight-type="process" data-width="100%" data-font-size="medium" data-layout="block" data-align="left" data-custom-bg="#f9f0ff" data-custom-border="#722ed1"><strong>Step 3:</strong> Set up automated sequences</blockquote>

8. **comparison** - For versus, plan differences
   - Example: <blockquote data-highlight-box="" data-highlight-type="comparison" data-width="100%" data-font-size="medium" data-layout="block" data-align="left" data-custom-bg="#e6fffb" data-custom-border="#13c2c2"><strong>Free vs Pro:</strong> Free includes 1,000 contacts</blockquote>

**Highlight Box Rules:**
- Use MAXIMUM 3 highlight boxes per post (regardless of length)
`;

    if (previousBoxTypes.length > 0) {
      highlightBoxInstructions += `- DO NOT use these box types (used in previous post): ${previousBoxTypes.join(', ')}\n`;
      highlightBoxInstructions += `- Choose from remaining types: ${availableBoxTypes.join(', ')}\n`;
    }

    highlightBoxInstructions += `- Float layouts (float-left, float-right) for tips and pull quotes (50% width)
- Block layouts for statistics, takeaways, warnings, definitions, processes, comparisons (100% width)
- Vary box types for visual diversity
- Place boxes strategically to break up content`;

    const imageInstructions = `
## IMAGE PLACEMENT INSTRUCTIONS

You MUST insert image placeholders throughout the blog post. Use this exact format:

![IMAGE:type:description]

Where:
- type = hero_image | infographic | chart | illustration | diagram
- description = detailed image generation prompt (50-100 words)

**Required Image Placements:**
1. Hero image after introduction (before first H2)
2. Supporting image every 300-400 words
3. Infographic for complex data or processes
4. Chart/graph when presenting statistics
5. Illustration for examples or case studies

**Example:**
![IMAGE:infographic:Create an infographic showing the 5-step email marketing funnel. Include icons for: awareness (magnifying glass), interest (lightbulb), consideration (scales), intent (shopping cart), and conversion (checkmark). Use blue and green color scheme with arrows connecting each stage.]`;

    console.log('✅ [CTA DEBUG] Prompt Building: Complete prompt built:', {
      promptLength: contextSections.length,
      hasCTASection: contextSections.some(section => section.includes('AVAILABLE CTAS') || section.includes('NO CTAS AVAILABLE')),
      ctaSectionPreview: contextSections.find(s => s.includes('CTA')) || 'No CTA section found',
      previousBoxTypes: previousBoxTypes.join(', ') || 'none',
      availableBoxTypes: availableBoxTypes.join(', ')
    });

    return `Write a high-quality blog post optimized for ${seoTarget}+ SEO score:

TOPIC: ${topic.title}
SUBTITLE: ${topic.subheader}
BUSINESS TYPE: ${businessInfo.businessType}
TARGET AUDIENCE: ${businessInfo.targetAudience}

${contextSections.join('\n\n')}

${dataContext}

${seoInstructions}

${imageInstructions}

${highlightBoxInstructions}

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

      console.log('🚩 [CHECKPOINT 3] Content Generation Starting:', {
        organizationId,
        topicTitle: topic.title,
        willLoadCTAs: 'Checking availability flags...',
        nextStep: 'Load organization context with CTAs'
      });

      // Load organization context
      const organizationContext = await this.getOrganizationContext(organizationId);
      console.log(`📊 Organization context loaded: ${organizationContext.completenessScore}% complete`);

      console.log('📊 [CTA DEBUG] Generation: Organization context retrieved:', {
        organizationId,
        completenessScore: organizationContext.completenessScore,
        hasWebsiteDataCTAs: organizationContext.websiteData?.ctas?.length > 0,
        ctaCount: organizationContext.websiteData?.ctas?.length || 0
      });

      console.log('🚩 [CHECKPOINT 4] Organization Context Loaded:', {
        organizationId,
        has_cta_data_flag: organizationContext.availability?.has_cta_data,
        ctaCount: organizationContext.websiteData?.ctas?.length || 0,
        hasCTAs: organizationContext.websiteData?.ctas?.length > 0,
        nextStep: organizationContext.websiteData?.ctas?.length > 0 ? 'Build prompt with CTAs' : 'ERROR: No CTAs found'
      });

      // Get previous post's highlight box types to avoid repetition
      const previousBoxTypes = await this.getPreviousPostHighlightBoxTypes(organizationId);
      console.log(`📊 Previous post used ${previousBoxTypes.length} highlight box types:`, previousBoxTypes);

      // Build enhanced prompt with all available data
      const enhancedPrompt = this.buildEnhancedPrompt(topic, businessInfo, organizationContext, additionalInstructions, previousBoxTypes);

      console.log('🧠 Calling OpenAI with enhanced prompt...');
      console.log('🧠 [CTA DEBUG] Generation: Sending prompt to OpenAI:', {
        organizationId,
        topicTitle: topic.title,
        hasCTAsInPrompt: enhancedPrompt.includes('AVAILABLE CTAS'),
        promptIncludesNoCTAWarning: enhancedPrompt.includes('NO CTAS AVAILABLE')
      });
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
        max_tokens: 5000 // Increased to accommodate images and highlight boxes
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

      console.log('✅ [CTA DEBUG] Generation: OpenAI response received:', {
        organizationId,
        contentLength: blogData.content?.length || 0,
        hasContent: !!blogData.content,
        contentPreview: blogData.content?.substring(0, 200) + '...'
      });

      // Check if CTAs appear in generated content
      const ctaLinkMatches = blogData.content?.match(/\[.*?\]\(.*?\)/g) || [];
      console.log('🔍 [CTA DEBUG] Generation: CTA links in generated content:', {
        ctaLinkCount: ctaLinkMatches.length,
        ctaLinks: ctaLinkMatches.slice(0, 5) // Show first 5
      });

      // Process image placeholders and replace with generated images
      if (blogData.content && blogData.content.includes('![IMAGE:')) {
        console.log('🎨 Detected image placeholders in content - processing...');
        blogData.content = await this.processImagePlaceholders(blogData.content, topic, organizationId);
      } else {
        console.log('📊 No image placeholders detected in generated content');
      }

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