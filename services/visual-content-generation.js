import axios from 'axios';
import db from './database.js';

/**
 * Visual Content Generation Service
 * Handles AI-powered image, infographic, and chart generation for blog posts
 */
export class VisualContentGenerationService {
  constructor() {
    this.services = {
      stable_diffusion: {
        name: 'Stable Diffusion (Replicate)',
        available: !!process.env.REPLICATE_API_TOKEN,
        costPerImage: 0.01, // Your paid account
        endpoint: 'https://api.replicate.com/v1/predictions',
        priority: 1, // Highest priority
        bestFor: ['hero_image', 'illustration', 'artistic', 'abstract']
      },
      quickchart: {
        name: 'QuickChart (Free)',
        available: true, // No account needed!
        costPerImage: 0.00, // Free tier
        endpoint: 'https://quickchart.io/chart',
        priority: 2, // Second priority - free!
        bestFor: ['chart', 'graph', 'infographic', 'data_visualization']
      },
      dalle: {
        name: 'DALL-E (OpenAI)',
        available: !!process.env.OPENAI_API_KEY,
        costPerImage: 0.02,
        endpoint: 'https://api.openai.com/v1/images/generations',
        priority: 3, // Third - costs money
        bestFor: ['realistic', 'professional', 'detailed']
      },
      canva: {
        name: 'Canva API',
        available: false, // Disabled due to $120/year cost
        costPerImage: 0.00,
        endpoint: 'https://api.canva.com/v1/designs',
        priority: 4, // Disabled for now
        bestFor: ['templates', 'branded', 'marketing']
      }
    };

    console.log('🎨 Visual Content Service initialized:', {
      replicate: this.services.stable_diffusion.available ? '✅ Ready' : '❌ No API token',
      quickchart: '✅ Ready (Free)',
      dalle: this.services.dalle.available ? '✅ Ready' : '❌ No OpenAI key',
      canva: '❌ Disabled ($120/year)'
    });
  }

  /**
   * Determine the best service for a given content type based on availability and priority
   */
  selectService(contentType, budget = 'standard', requirements = {}) {
    const servicePreferences = {
      hero_image: ['stable_diffusion', 'dalle'], // Photos need AI generators, remove QuickChart
      infographic: ['quickchart', 'stable_diffusion'], // Test both chart and AI approaches
      chart: ['quickchart'],
      graph: ['quickchart'],
      data_visualization: ['quickchart'],
      diagram: ['stable_diffusion', 'quickchart'],
      illustration: ['stable_diffusion', 'dalle'],
      social_media: ['stable_diffusion', 'dalle'], // Remove QuickChart, focus on engaging visuals
      thumbnail: ['stable_diffusion', 'dalle'],
      banner: ['stable_diffusion', 'dalle'],
      icon: ['stable_diffusion', 'dalle']
    };

    const preferred = servicePreferences[contentType] || ['stable_diffusion', 'dalle'];
    
    // Filter to available services and sort by priority
    const availableServices = preferred
      .filter(service => this.services[service]?.available)
      .sort((a, b) => this.services[a].priority - this.services[b].priority);
    
    // Select based on budget preferences
    for (const service of availableServices) {
      const cost = this.services[service].costPerImage;
      
      if (budget === 'economy' && cost === 0.00) return service; // Free first
      if (budget === 'economy' && cost <= 0.01) return service; // Then cheap
      if (budget === 'standard' && cost <= 0.02) return service;
      if (budget === 'premium') return service; // Any cost OK
    }

    // Fallback: return cheapest available service
    const allAvailable = Object.keys(this.services)
      .filter(s => this.services[s].available)
      .sort((a, b) => this.services[a].costPerImage - this.services[b].costPerImage);
    
    return allAvailable[0] || 'quickchart'; // QuickChart as final fallback
  }

  /**
   * Generate image using Stable Diffusion via Replicate
   */
  async generateWithStableDiffusion(prompt, options = {}) {
    if (!process.env.REPLICATE_API_TOKEN) {
      throw new Error('Replicate API token not configured');
    }

    const startTime = Date.now();

    try {
      console.log('🎨 Generating image with Stable Diffusion:', prompt);

      const response = await axios.post(
        this.services.stable_diffusion.endpoint,
        {
          version: "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
          input: {
            prompt: prompt,
            negative_prompt: options.negative_prompt || "blurry, low quality, distorted, watermark, text, logo",
            width: options.width || 1024,
            height: options.height || 1024,
            num_inference_steps: options.steps || 20,
            guidance_scale: options.guidance_scale || 7.5,
            scheduler: "K_EULER"
          }
        },
        {
          headers: {
            'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Poll for completion
      let result = response.data;
      while (result.status === 'starting' || result.status === 'processing') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const pollResponse = await axios.get(result.urls.get, {
          headers: { 'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}` }
        });
        result = pollResponse.data;
      }

      if (result.status === 'failed') {
        throw new Error(result.error || 'Stable Diffusion generation failed');
      }

      const generationTime = Date.now() - startTime;

      return {
        imageUrl: result.output[0],
        thumbnailUrl: result.output[0], // Same for now
        altText: prompt,
        width: options.width || 1024,
        height: options.height || 1024,
        generationTime,
        cost: this.services.stable_diffusion.costPerImage,
        serviceResponse: result
      };

    } catch (error) {
      console.error('Stable Diffusion generation error:', error);
      throw new Error(`Stable Diffusion generation failed: ${error.message}`);
    }
  }

  /**
   * Generate image using OpenAI DALL-E
   */
  async generateWithDALLE(prompt, options = {}) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const startTime = Date.now();

    try {
      console.log('🎨 Generating image with DALL-E:', prompt);

      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: prompt,
        size: options.size || "1024x1024",
        quality: options.quality || "standard",
        n: 1
      });

      const generationTime = Date.now() - startTime;

      return {
        imageUrl: response.data[0].url,
        thumbnailUrl: response.data[0].url,
        altText: response.data[0].revised_prompt || prompt,
        width: 1024,
        height: 1024,
        generationTime,
        cost: this.services.dalle.costPerImage,
        serviceResponse: response.data[0]
      };

    } catch (error) {
      console.error('DALL-E generation error:', error);
      throw new Error(`DALL-E generation failed: ${error.message}`);
    }
  }

  /**
   * Generate chart using QuickChart
   */
  async generateWithQuickChart(config, options = {}) {
    const startTime = Date.now();

    try {
      console.log('📊 Generating chart with QuickChart');

      const chartConfig = {
        chart: config,
        width: options.width || 800,
        height: options.height || 600,
        format: options.format || 'png',
        backgroundColor: options.backgroundColor || '#ffffff'
      };

      const response = await axios.post(
        this.services.quickchart.endpoint,
        chartConfig,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      const generationTime = Date.now() - startTime;
      const imageUrl = `${this.services.quickchart.endpoint}?c=${encodeURIComponent(JSON.stringify(config))}`;

      return {
        imageUrl,
        thumbnailUrl: imageUrl,
        altText: options.altText || 'Generated chart',
        width: options.width || 800,
        height: options.height || 600,
        generationTime,
        cost: this.services.quickchart.costPerImage,
        serviceResponse: { config: chartConfig }
      };

    } catch (error) {
      console.error('QuickChart generation error:', error);
      throw new Error(`QuickChart generation failed: ${error.message}`);
    }
  }

  /**
   * Generate a placeholder graphic using QuickChart for non-chart content
   * SIMPLIFIED to avoid extremely long URLs
   */
  async generatePlaceholderWithQuickChart(prompt, contentType, options = {}) {
    const startTime = Date.now();

    try {
      console.log(`🎨 Creating placeholder ${contentType} with QuickChart:`, prompt.substring(0, 100));

      // Create simple placeholder designs to keep URLs short
      let chartConfig;
      const shortTitle = prompt.substring(0, 30); // Keep title very short

      switch (contentType) {
        case 'hero_image':
          chartConfig = {
            type: 'doughnut',
            data: {
              datasets: [{
                data: [85, 15],
                backgroundColor: ['#1890ff', '#f0f0f0']
              }]
            },
            options: {
              title: { display: true, text: shortTitle }
            }
          };
          break;

        case 'social_media':
          chartConfig = {
            type: 'doughnut',
            data: {
              datasets: [{
                data: [40, 35, 25],
                backgroundColor: ['#1890ff', '#52c41a', '#faad14']
              }]
            },
            options: {
              title: { display: true, text: shortTitle }
            }
          };
          break;

        default:
          // Parse the prompt to create appropriate chart type
          chartConfig = this.parsePromptForQuickChart(prompt, contentType);
      }

      const width = options.width || 800;
      const height = options.height || 600;

      // Generate URL for QuickChart
      const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=${width}&h=${height}&format=png`;

      // Check if URL is too long (over 1800 characters to be safe)
      if (chartUrl.length > 1800) {
        console.warn(`⚠️ QuickChart URL length is ${chartUrl.length} characters, using simpler fallback`);
        // Use ultra-simple fallback
        const fallbackConfig = {
          type: 'bar',
          data: {
            labels: ['A', 'B', 'C'],
            datasets: [{ data: [7, 8, 9], backgroundColor: '#1890ff' }]
          }
        };
        const fallbackUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(fallbackConfig))}&w=${width}&h=${height}&format=png`;
        console.log(`✅ Fallback URL length: ${fallbackUrl.length} characters`);

        return {
          imageUrl: fallbackUrl,
          thumbnailUrl: fallbackUrl,
          altText: `Chart for ${contentType.replace('_', ' ')}`,
          width,
          height,
          generationTime: Date.now() - startTime,
          cost: this.services.quickchart.costPerImage,
          serviceResponse: { config: fallbackConfig, type: 'placeholder-fallback' }
        };
      }

      const generationTime = Date.now() - startTime;

      return {
        imageUrl: chartUrl,
        thumbnailUrl: chartUrl,
        altText: `Chart for ${contentType.replace('_', ' ')}`,
        width,
        height,
        generationTime,
        cost: this.services.quickchart.costPerImage,
        serviceResponse: { config: chartConfig, type: 'placeholder' }
      };

    } catch (error) {
      console.error('QuickChart placeholder generation error:', error);
      throw new Error(`QuickChart placeholder generation failed: ${error.message}`);
    }
  }

  /**
   * Generate enhanced prompt for better image quality
   */
  enhancePrompt(basePrompt, contentType, brandGuidelines = {}) {
    const styleMap = {
      hero_image: 'professional, high-quality, hero banner style',
      infographic: 'clean, informative, infographic style with clear typography',
      chart: 'clean data visualization',
      diagram: 'technical diagram, clear and educational',
      illustration: 'professional illustration style',
      social_media: 'social media optimized, engaging visual',
      thumbnail: 'thumbnail style, clear and recognizable',
      banner: 'banner style, professional layout',
      icon: 'simple icon style, clean and minimal'
    };

    let enhancedPrompt = basePrompt;

    // Add style guidance
    if (styleMap[contentType]) {
      enhancedPrompt += `, ${styleMap[contentType]}`;
    }

    // Add brand guidelines
    if (brandGuidelines.style_preference) {
      enhancedPrompt += `, ${brandGuidelines.style_preference} style`;
    }

    if (brandGuidelines.primary_color) {
      enhancedPrompt += `, incorporating ${brandGuidelines.primary_color} color scheme`;
    }

    // Add quality modifiers
    enhancedPrompt += ', high quality, professional, clean, modern';

    return enhancedPrompt;
  }

  /**
   * Generate visual content for a blog post
   */
  async generateVisualContent({
    organizationId,
    postId = null,
    contentType,
    prompt,
    brandGuidelines = {},
    options = {},
    servicePreference = null
  }) {
    const startTime = Date.now();

    try {
      console.log(`🎨 Starting visual content generation for ${contentType}`);

      // Select appropriate service (use preference if provided, validate it's available)
      let service;
      if (servicePreference) {
        // Validate that the preferred service is available
        if (this.services[servicePreference] && this.services[servicePreference].available) {
          service = servicePreference;
          console.log(`📡 Using requested service: ${service} (forced preference)`);
        } else {
          console.warn(`⚠️ Requested service ${servicePreference} is not available, falling back to auto-selection`);
          service = this.selectService(contentType, options.budget, options.requirements);
          console.log(`📡 Selected service: ${service} (auto-selected fallback)`);
        }
      } else {
        service = this.selectService(contentType, options.budget, options.requirements);
        console.log(`📡 Selected service: ${service} (auto-selected)`);
      }

      // Enhance prompt with style and brand guidelines
      const enhancedPrompt = this.enhancePrompt(prompt, contentType, brandGuidelines);
      console.log(`✨ Enhanced prompt: ${enhancedPrompt}`);

      // Generate content based on selected service with fallback logic
      let result;
      let actualService = service;
      
      try {
        switch (service) {
          case 'stable_diffusion':
            result = await this.generateWithStableDiffusion(enhancedPrompt, options);
            break;
          case 'dalle':
            result = await this.generateWithDALLE(enhancedPrompt, options);
            break;
          case 'quickchart':
            if (options.chartConfig) {
              result = await this.generateWithQuickChart(options.chartConfig, options);
            } else {
              // For non-chart content, create a simple placeholder graphic
              result = await this.generatePlaceholderWithQuickChart(enhancedPrompt, contentType, options);
            }
            break;
          default:
            throw new Error(`Unsupported service: ${service}`);
        }
      } catch (primaryError) {
        console.warn(`⚠️ Primary service ${service} failed:`, primaryError.message);
        
        // Try fallback to free services if primary service fails with payment/quota issues
        if (primaryError.message.includes('402') || primaryError.message.includes('quota') || 
            primaryError.message.includes('payment') || primaryError.message.includes('credits')) {
          
          console.log('💡 Attempting fallback to free service...');
          
          // Always try QuickChart as fallback for any content type
          try {
            result = await this.generatePlaceholderWithQuickChart(enhancedPrompt, contentType, options);
            actualService = 'quickchart';
            console.log('✅ Fallback to QuickChart successful');
          } catch (fallbackError) {
            console.error('❌ Fallback service also failed:', fallbackError.message);
            throw new Error(`Primary service failed (${primaryError.message}) and fallback failed (${fallbackError.message})`);
          }
        } else {
          // Re-throw non-payment related errors
          throw primaryError;
        }
      }

      // Save to database
      const savedContent = await this.saveVisualContent({
        organizationId,
        postId,
        contentType,
        serviceUsed: actualService,
        generationPrompt: enhancedPrompt,
        ...result
      });

      console.log(`✅ Visual content generated successfully: ${savedContent.id}`);

      return {
        success: true,
        data: savedContent
      };

    } catch (error) {
      console.error('Visual content generation error:', error);
      
      // Save failed attempt to database for tracking
      try {
        await this.saveVisualContent({
          organizationId,
          postId,
          contentType,
          serviceUsed: 'failed',
          generationPrompt: prompt,
          imageUrl: null,
          generationStatus: 'failed',
          errorMessage: error.message,
          generationTime: Date.now() - startTime,
          cost: 0
        });
      } catch (dbError) {
        console.error('Failed to save error record:', dbError);
      }

      throw error;
    }
  }

  /**
   * Save visual content to database
   */
  async saveVisualContent({
    organizationId,
    postId,
    contentType,
    serviceUsed,
    generationPrompt,
    imageUrl,
    thumbnailUrl,
    altText,
    width,
    height,
    generationTime,
    cost,
    serviceResponse,
    generationStatus = 'completed',
    errorMessage = null
  }) {
    const { v4: uuidv4 } = await import('uuid');
    const contentId = uuidv4();

    const result = await db.query(`
      INSERT INTO generated_visual_content (
        id, organization_id, post_id, content_type, service_used,
        generation_prompt, service_response, image_url, thumbnail_url,
        alt_text, image_width, image_height, generation_cost,
        generation_time_ms, generation_status, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `, [
      contentId, organizationId, postId, contentType, serviceUsed,
      generationPrompt, JSON.stringify(serviceResponse || {}), imageUrl,
      thumbnailUrl, altText, width, height, cost, generationTime,
      generationStatus, errorMessage
    ]);

    return {
      id: result.rows[0].id,
      contentType: result.rows[0].content_type,
      serviceUsed: result.rows[0].service_used,
      imageUrl: result.rows[0].image_url,
      thumbnailUrl: result.rows[0].thumbnail_url,
      altText: result.rows[0].alt_text,
      width: result.rows[0].image_width,
      height: result.rows[0].image_height,
      cost: parseFloat(result.rows[0].generation_cost),
      generationTime: result.rows[0].generation_time_ms,
      status: result.rows[0].generation_status,
      createdAt: result.rows[0].created_at
    };
  }

  /**
   * Get visual content for an organization or post
   */
  async getVisualContent(organizationId, postId = null) {
    let query = `
      SELECT * FROM generated_visual_content 
      WHERE organization_id = $1
    `;
    const params = [organizationId];

    if (postId) {
      query += ' AND post_id = $2';
      params.push(postId);
    }

    query += ' ORDER BY created_at DESC';

    const result = await db.query(query, params);

    return result.rows.map(row => ({
      id: row.id,
      contentType: row.content_type,
      serviceUsed: row.service_used,
      imageUrl: row.image_url,
      thumbnailUrl: row.thumbnail_url,
      altText: row.alt_text,
      width: row.image_width,
      height: row.image_height,
      cost: parseFloat(row.generation_cost || 0),
      generationTime: row.generation_time_ms,
      status: row.generation_status,
      qualityScore: row.quality_score,
      usageCount: row.usage_count,
      createdAt: row.created_at
    }));
  }

  /**
   * Create detailed, context-aware prompts for visual content generation
   */
  createDetailedPrompt(blogContent, contentType) {
    const title = blogContent.title || 'Blog Post';
    const content = blogContent.content || '';
    
    switch (contentType) {
      case 'hero_image':
        // Hero images should be photos/realistic
        return `Professional photograph for "${title}" blog post. Realistic, high-quality stock photo style showing people or scenes related to ${title.toLowerCase()}. Modern, clean composition suitable for website header. Professional lighting and composition.`;
          
      case 'infographic':
        // Use detailed test prompts to evaluate chart quality
        return this.getTestInfographicPrompt();
          
      case 'social_media':
        // Social media optimized visuals
        return `Engaging social media graphic for "${title}". Bold, modern design with text overlay and visual elements. Optimized for platforms like LinkedIn, Instagram, Twitter. Professional yet eye-catching style.`;
          
      default:
        return `Professional visual content for "${title}"`;
    }
  }

  /**
   * Get a random detailed test prompt for infographic testing
   */
  getTestInfographicPrompt() {
    const testPrompts = [
      // 1. Pie Chart
      "Pie chart showing email marketing platform market share: Mailchimp 35%, Constant Contact 22%, Campaign Monitor 18%, GetResponse 12%, AWeber 8%, Other 5%. Include title 'Email Marketing Platform Market Share 2024', proper percentage labels on each slice, legend with company names, and data source footer 'Based on 10,000 business survey'.",
      
      // 2. Bar Chart  
      "Horizontal bar chart comparing software implementation phases: Discovery (2 weeks), Planning (4 weeks), Development (12 weeks), Testing (3 weeks), Deployment (1 week), Training (2 weeks). X-axis labeled 'Duration (Weeks)', Y-axis showing phase names, title 'Software Implementation Timeline', bars in blue gradient, values displayed at end of each bar.",
      
      // 3. Process Journey
      "Process flow infographic for SaaS customer onboarding: Step 1 'Sign Up' (30% conversion) → Step 2 'Email Verification' (85% completion) → Step 3 'Profile Setup' (70% completion) → Step 4 'First Login' (60% completion) → Step 5 'Feature Tour' (40% completion). Include conversion rates, progress arrows, step icons, and title 'Customer Onboarding Journey'.",
      
      // 4. Problem/Solution
      "Before/After comparison infographic for marketing automation: BEFORE side showing 'Manual Email Sending: 2 hours daily, 15% open rate, 3% click rate, $50 cost per customer'. AFTER side showing 'Automated Campaigns: 10 minutes daily, 28% open rate, 12% click rate, $12 cost per customer'. Include improvement arrows, percentage gains, and title 'Marketing Automation Impact'.",
      
      // 5. Timeline
      "Timeline infographic showing product development milestones: Q1 2024 'MVP Launch' (completed), Q2 2024 'User Analytics' (in progress), Q3 2024 'Mobile App' (planned), Q4 2024 'API Integration' (planned), Q1 2025 'Enterprise Features' (future). Include quarter labels, status indicators, milestone descriptions, and title 'Product Roadmap 2024-2025'.",
      
      // 6. Funnel
      "Sales funnel diagram showing lead conversion: 10,000 Website Visitors → 2,500 Email Signups (25%) → 500 Demo Requests (20%) → 150 Proposals Sent (30%) → 45 Customers Acquired (30%). Include exact numbers, conversion percentages between stages, funnel shape visualization, and title 'B2B Sales Conversion Funnel'.",
      
      // 7. Comparison Matrix
      "Feature comparison matrix for project management tools: Rows: Task Management, Time Tracking, Reporting, Team Chat, File Storage, Mobile App. Columns: Asana, Trello, Monday.com. Use checkmarks (✓) for included features, X for missing features. Include pricing row: Asana $10.99, Trello $5.00, Monday.com $8.00. Title 'Project Management Tool Comparison 2024'.",
      
      // 8. Flow Diagram
      "Content marketing workflow flowchart: Start 'Content Idea' → Decision 'Audience Research?' (Yes/No) → 'Keyword Research' → 'Content Creation' → Decision 'SEO Optimized?' (Yes/No) → 'Publish Content' → 'Social Media Promotion' → 'Track Performance' → End. Include decision diamonds, process rectangles, arrows with labels, and title 'Content Marketing Process Flow'.",
      
      // 9. Before/After Performance
      "Website optimization before/after infographic: BEFORE metrics: Page Load Speed 4.2 seconds, Bounce Rate 65%, Conversion Rate 2.1%, Mobile Score 45/100. AFTER metrics: Page Load Speed 1.8 seconds (57% improvement), Bounce Rate 38% (42% improvement), Conversion Rate 4.7% (124% improvement), Mobile Score 92/100 (104% improvement). Include improvement percentages and visual gauges.",
      
      // 10. Statistical Dashboard
      "Email marketing dashboard showing campaign metrics: Total Emails Sent 50,000, Delivery Rate 97.5% (48,750), Open Rate 24.3% (11,846), Click Rate 6.8% (3,400), Unsubscribe Rate 0.5% (250). Include KPI boxes with large numbers, percentage indicators, color coding (green for good metrics, red for concerning), trend arrows, and title 'Email Campaign Performance Dashboard'."
    ];
    
    // Return a random test prompt for variety
    return testPrompts[Math.floor(Math.random() * testPrompts.length)];
  }

  /**
   * Extract key phrases and themes from blog content
   */
  extractKeyPhrases(content, title) {
    const phrases = [];
    
    // Add title words as key phrases
    if (title) {
      const titleWords = title.toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 3 && !['the', 'and', 'for', 'with', 'your', 'this', 'that'].includes(word));
      phrases.push(...titleWords);
    }
    
    // Extract important terms from content
    if (content && content.length > 100) {
      // Look for capitalized terms (likely important concepts)
      const capitalizedTerms = content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
      
      // Look for terms that appear multiple times
      const words = content.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
      const wordCount = {};
      words.forEach(word => {
        if (!['this', 'that', 'with', 'have', 'will', 'from', 'they', 'been', 'more', 'like', 'time', 'very', 'when', 'much', 'some', 'what', 'even', 'most'].includes(word)) {
          wordCount[word] = (wordCount[word] || 0) + 1;
        }
      });
      
      const frequentWords = Object.entries(wordCount)
        .filter(([word, count]) => count > 1)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([word]) => word);
      
      phrases.push(...capitalizedTerms.slice(0, 3));
      phrases.push(...frequentWords);
    }
    
    // Remove duplicates and return top phrases
    return [...new Set(phrases)].slice(0, 6);
  }

  /**
   * Parse prompt to create appropriate QuickChart configuration
   * SIMPLIFIED to avoid extremely long URLs that exceed browser limits
   */
  parsePromptForQuickChart(prompt, contentType) {
    const lowerPrompt = prompt.toLowerCase();

    // Extract title from prompt - keep it short to reduce URL length
    const titleMatch = prompt.match(/title ['"]([^'"]+)['"]/i);
    const title = titleMatch ? titleMatch[1].substring(0, 40) : 'Chart';

    // Pie Chart Detection
    if (lowerPrompt.includes('pie chart') || lowerPrompt.includes('market share')) {
      return {
        type: 'pie',
        data: {
          labels: ['A', 'B', 'C', 'D', 'E'],
          datasets: [{
            data: [35, 25, 20, 12, 8],
            backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF']
          }]
        },
        options: {
          title: { display: true, text: title },
          legend: { display: true, position: 'right' },
          plugins: { datalabels: { formatter: (val) => val + '%' } }
        }
      };
    }

    // Bar Chart Detection
    if (lowerPrompt.includes('bar chart') || lowerPrompt.includes('horizontal bar') ||
        (lowerPrompt.includes('weeks') && lowerPrompt.includes('phases'))) {
      return {
        type: 'horizontalBar',
        data: {
          labels: ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4'],
          datasets: [{
            data: [2, 4, 12, 3],
            backgroundColor: '#36A2EB'
          }]
        },
        options: {
          title: { display: true, text: title },
          legend: { display: false }
        }
      };
    }

    // Funnel Chart Detection
    if (lowerPrompt.includes('funnel') || lowerPrompt.includes('conversion')) {
      return {
        type: 'bar',
        data: {
          labels: ['Visitors', 'Signups', 'Demos', 'Proposals', 'Customers'],
          datasets: [{
            data: [10000, 2500, 500, 150, 45],
            backgroundColor: '#4285F4'
          }]
        },
        options: {
          title: { display: true, text: title },
          legend: { display: false }
        }
      };
    }

    // Comparison Detection
    if (lowerPrompt.includes('comparison') || lowerPrompt.includes('vs')) {
      return {
        type: 'bar',
        data: {
          labels: ['Option A', 'Option B', 'Option C'],
          datasets: [{
            data: [85, 72, 90],
            backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56']
          }]
        },
        options: {
          title: { display: true, text: title },
          legend: { display: false }
        }
      };
    }

    // Performance/Dashboard Detection
    if (lowerPrompt.includes('dashboard') || lowerPrompt.includes('performance') ||
        lowerPrompt.includes('before') || lowerPrompt.includes('improvement')) {
      return {
        type: 'bar',
        data: {
          labels: ['Before', 'After'],
          datasets: [{
            data: [45, 92],
            backgroundColor: ['#FF6384', '#4BC0C0']
          }]
        },
        options: {
          title: { display: true, text: title }
        }
      };
    }

    // Timeline Detection
    if (lowerPrompt.includes('timeline') || lowerPrompt.includes('roadmap')) {
      return {
        type: 'line',
        data: {
          labels: ['Q1', 'Q2', 'Q3', 'Q4'],
          datasets: [{
            data: [100, 60, 30, 10],
            borderColor: '#36A2EB',
            fill: false
          }]
        },
        options: {
          title: { display: true, text: title }
        }
      };
    }

    // Flow/Process Detection
    if (lowerPrompt.includes('process') || lowerPrompt.includes('flow') ||
        lowerPrompt.includes('step') || lowerPrompt.includes('journey')) {
      return {
        type: 'line',
        data: {
          labels: ['Step 1', 'Step 2', 'Step 3', 'Step 4'],
          datasets: [{
            data: [100, 85, 70, 60],
            borderColor: '#FFCE56',
            fill: true
          }]
        },
        options: {
          title: { display: true, text: title }
        }
      };
    }

    // Default fallback - minimal bar chart
    return {
      type: 'bar',
      data: {
        labels: ['A', 'B', 'C'],
        datasets: [{
          data: [8, 9, 7],
          backgroundColor: '#1890ff'
        }]
      },
      options: {
        title: { display: true, text: title }
      }
    };
  }

  /**
   * Generate all 10 detailed test cases for comprehensive evaluation
   */
  getAllTestPrompts() {
    return [
      {
        id: 'test-pie-chart',
        title: 'Pie Chart Test',
        contentType: 'infographic',
        prompt: "Pie chart showing email marketing platform market share: Mailchimp 35%, Constant Contact 22%, Campaign Monitor 18%, GetResponse 12%, AWeber 8%, Other 5%. Include title 'Email Marketing Platform Market Share 2024', proper percentage labels on each slice, legend with company names, and data source footer 'Based on 10,000 business survey'.",
        testType: 'Pie Chart - Market Share',
        expectedFeatures: ['Percentage labels', 'Legend', 'Title', 'Data source']
      },
      {
        id: 'test-bar-chart',
        title: 'Bar Chart Test', 
        contentType: 'infographic',
        prompt: "Horizontal bar chart comparing software implementation phases: Discovery (2 weeks), Planning (4 weeks), Development (12 weeks), Testing (3 weeks), Deployment (1 week), Training (2 weeks). X-axis labeled 'Duration (Weeks)', Y-axis showing phase names, title 'Software Implementation Timeline', bars in blue gradient, values displayed at end of each bar.",
        testType: 'Bar Chart - Timeline',
        expectedFeatures: ['Axis labels', 'Value display', 'Color gradient', 'Proper scaling']
      },
      {
        id: 'test-process-journey',
        title: 'Process Journey Test',
        contentType: 'infographic', 
        prompt: "Process flow infographic for SaaS customer onboarding: Step 1 'Sign Up' (30% conversion) → Step 2 'Email Verification' (85% completion) → Step 3 'Profile Setup' (70% completion) → Step 4 'First Login' (60% completion) → Step 5 'Feature Tour' (40% completion). Include conversion rates, progress arrows, step icons, and title 'Customer Onboarding Journey'.",
        testType: 'Process Flow - Customer Journey',
        expectedFeatures: ['Flow arrows', 'Step icons', 'Conversion rates', 'Sequential layout']
      },
      {
        id: 'test-before-after',
        title: 'Before/After Test',
        contentType: 'infographic',
        prompt: "Before/After comparison infographic for marketing automation: BEFORE side showing 'Manual Email Sending: 2 hours daily, 15% open rate, 3% click rate, $50 cost per customer'. AFTER side showing 'Automated Campaigns: 10 minutes daily, 28% open rate, 12% click rate, $12 cost per customer'. Include improvement arrows, percentage gains, and title 'Marketing Automation Impact'.",
        testType: 'Before/After - Comparison',
        expectedFeatures: ['Side-by-side layout', 'Improvement arrows', 'Metric comparison', 'Clear sections']
      },
      {
        id: 'test-timeline',
        title: 'Timeline Test',
        contentType: 'infographic',
        prompt: "Timeline infographic showing product development milestones: Q1 2024 'MVP Launch' (completed), Q2 2024 'User Analytics' (in progress), Q3 2024 'Mobile App' (planned), Q4 2024 'API Integration' (planned), Q1 2025 'Enterprise Features' (future). Include quarter labels, status indicators, milestone descriptions, and title 'Product Roadmap 2024-2025'.",
        testType: 'Timeline - Product Roadmap',
        expectedFeatures: ['Chronological order', 'Status indicators', 'Quarter labels', 'Milestone descriptions']
      },
      {
        id: 'test-funnel',
        title: 'Funnel Test',
        contentType: 'infographic',
        prompt: "Sales funnel diagram showing lead conversion: 10,000 Website Visitors → 2,500 Email Signups (25%) → 500 Demo Requests (20%) → 150 Proposals Sent (30%) → 45 Customers Acquired (30%). Include exact numbers, conversion percentages between stages, funnel shape visualization, and title 'B2B Sales Conversion Funnel'.",
        testType: 'Funnel - Sales Conversion',
        expectedFeatures: ['Funnel shape', 'Exact numbers', 'Conversion percentages', 'Stage progression']
      },
      {
        id: 'test-comparison-matrix',
        title: 'Comparison Matrix Test',
        contentType: 'infographic',
        prompt: "Feature comparison matrix for project management tools: Rows: Task Management, Time Tracking, Reporting, Team Chat, File Storage, Mobile App. Columns: Asana, Trello, Monday.com. Use checkmarks (✓) for included features, X for missing features. Include pricing row: Asana $10.99, Trello $5.00, Monday.com $8.00. Title 'Project Management Tool Comparison 2024'.",
        testType: 'Comparison Matrix - Features',
        expectedFeatures: ['Grid layout', 'Checkmarks/X symbols', 'Pricing row', 'Clear headers']
      },
      {
        id: 'test-flow-diagram',
        title: 'Flow Diagram Test',
        contentType: 'infographic',
        prompt: "Content marketing workflow flowchart: Start 'Content Idea' → Decision 'Audience Research?' (Yes/No) → 'Keyword Research' → 'Content Creation' → Decision 'SEO Optimized?' (Yes/No) → 'Publish Content' → 'Social Media Promotion' → 'Track Performance' → End. Include decision diamonds, process rectangles, arrows with labels, and title 'Content Marketing Process Flow'.",
        testType: 'Flow Diagram - Workflow',
        expectedFeatures: ['Decision diamonds', 'Process rectangles', 'Labeled arrows', 'Yes/No paths']
      },
      {
        id: 'test-performance-metrics',
        title: 'Performance Metrics Test',
        contentType: 'infographic',
        prompt: "Website optimization before/after infographic: BEFORE metrics: Page Load Speed 4.2 seconds, Bounce Rate 65%, Conversion Rate 2.1%, Mobile Score 45/100. AFTER metrics: Page Load Speed 1.8 seconds (57% improvement), Bounce Rate 38% (42% improvement), Conversion Rate 4.7% (124% improvement), Mobile Score 92/100 (104% improvement). Include improvement percentages and visual gauges.",
        testType: 'Performance Metrics - Improvements',
        expectedFeatures: ['Gauge visualizations', 'Improvement percentages', 'Before/after sections', 'Multiple metrics']
      },
      {
        id: 'test-dashboard',
        title: 'Dashboard Test',
        contentType: 'infographic',
        prompt: "Email marketing dashboard showing campaign metrics: Total Emails Sent 50,000, Delivery Rate 97.5% (48,750), Open Rate 24.3% (11,846), Click Rate 6.8% (3,400), Unsubscribe Rate 0.5% (250). Include KPI boxes with large numbers, percentage indicators, color coding (green for good metrics, red for concerning), trend arrows, and title 'Email Campaign Performance Dashboard'.",
        testType: 'Statistical Dashboard - KPIs',
        expectedFeatures: ['KPI boxes', 'Color coding', 'Large numbers', 'Trend indicators']
      }
    ];
  }

  /**
   * Generate suggested visual content for blog post content
   */
  async suggestVisualContent(blogContent, brandGuidelines = {}) {
    // Return all test cases for comprehensive evaluation
    const testPrompts = this.getAllTestPrompts();
    
    // Enrich with service information
    const enrichedSuggestions = testPrompts.map((testCase) => {
      const selectedService = this.selectService(testCase.contentType, 'standard');
      const service = this.services[selectedService];
      
      return {
        ...testCase,
        recommendedService: selectedService,
        selectedService: selectedService,
        serviceName: service?.name || 'Unknown',
        estimatedCost: service?.costPerImage || 0,
        estimatedTime: selectedService === 'quickchart' ? '5-10s' : '30-60s',
        generationTime: selectedService === 'quickchart' ? '5-10 seconds' : '30-60 seconds',
        placement: this.suggestPlacement(testCase.contentType),
        altText: `${testCase.title} for testing`,
        description: `Test case: ${testCase.testType}`,
        priority: 'high',
        reasoning: `Testing ${testCase.testType} generation capabilities`
      };
    });

    console.log(`✅ Generated ${enrichedSuggestions.length} test cases for evaluation`);
    return enrichedSuggestions;
  }

  /**
   * Suggest placement for different content types
   */
  suggestPlacement(contentType) {
    const placements = {
      hero_image: 'Top of post (after title)',
      infographic: 'Middle of post (between sections)',
      chart: 'Near relevant data discussion',
      graph: 'Within data section',
      data_visualization: 'Supporting statistics section',
      illustration: 'Where examples are discussed',
      social_media: 'End of post for sharing'
    };
    return placements[contentType] || 'Where contextually relevant';
  }

  /**
   * Get title for different content types
   */
  getContentTitle(contentType) {
    const titles = {
      hero_image: 'Hero Image',
      infographic: 'Process Infographic',
      chart: 'Data Chart',
      graph: 'Statistical Graph',
      data_visualization: 'Data Visualization',
      illustration: 'Custom Illustration',
      social_media: 'Social Media Card'
    };
    return titles[contentType] || 'Visual Content';
  }

  /**
   * Get description for different content types
   */
  getContentDescription(contentType) {
    const descriptions = {
      hero_image: 'Main visual that captures the post\'s essence',
      infographic: 'Visual summary of key points or process',
      chart: 'Data visualization chart or graph',
      graph: 'Statistical representation of data',
      data_visualization: 'Interactive or static data display',
      illustration: 'Custom artwork supporting the content',
      social_media: 'Optimized image for social sharing'
    };
    return descriptions[contentType] || 'Visual content piece';
  }

  /**
   * Batch generate multiple visual content pieces
   */
  async batchGenerate(requests) {
    const results = [];
    const errors = [];

    for (const request of requests) {
      try {
        const result = await this.generateVisualContent(request);
        results.push(result);
      } catch (error) {
        console.error(`Batch generation error for ${request.contentType}:`, error);
        errors.push({
          request,
          error: error.message
        });
      }
    }

    return {
      successful: results,
      failed: errors,
      totalCost: results.reduce((sum, r) => sum + (r.data?.cost || 0), 0)
    };
  }
}

// Create and export service instance
const visualContentService = new VisualContentGenerationService();
export default visualContentService;