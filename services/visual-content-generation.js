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
      hero_image: ['stable_diffusion', 'dalle', 'quickchart'], // Best quality for hero images
      infographic: ['quickchart', 'stable_diffusion'], // Charts work well for infographics
      chart: ['quickchart'],
      graph: ['quickchart'],
      data_visualization: ['quickchart'],
      diagram: ['stable_diffusion', 'quickchart'],
      illustration: ['stable_diffusion', 'dalle', 'quickchart'], // Quality important for illustrations
      social_media: ['stable_diffusion', 'quickchart'], // Quality important for social sharing
      thumbnail: ['stable_diffusion', 'quickchart'],
      banner: ['stable_diffusion', 'dalle', 'quickchart'],
      icon: ['stable_diffusion', 'quickchart']
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
   */
  async generatePlaceholderWithQuickChart(prompt, contentType, options = {}) {
    const startTime = Date.now();

    try {
      console.log(`🎨 Creating placeholder ${contentType} with QuickChart:`, prompt);

      // Create different placeholder designs based on content type
      let chartConfig;
      const title = prompt.substring(0, 50) + (prompt.length > 50 ? '...' : '');

      switch (contentType) {
        case 'hero_image':
          chartConfig = {
            type: 'radialGauge',
            data: {
              datasets: [{
                data: [85],
                backgroundColor: ['#1890ff', '#f0f0f0'],
                borderWidth: 0
              }]
            },
            options: {
              title: {
                display: true,
                text: title,
                fontSize: 24,
                fontColor: '#333'
              },
              responsive: false,
              animation: false
            }
          };
          break;

        case 'social_media':
          chartConfig = {
            type: 'doughnut',
            data: {
              labels: ['Engagement', 'Reach', 'Impact'],
              datasets: [{
                data: [40, 35, 25],
                backgroundColor: ['#1890ff', '#52c41a', '#faad14'],
                borderWidth: 2,
                borderColor: '#fff'
              }]
            },
            options: {
              title: {
                display: true,
                text: title,
                fontSize: 16,
                fontColor: '#333'
              },
              legend: {
                display: true,
                position: 'bottom'
              },
              responsive: false,
              animation: false
            }
          };
          break;

        default:
          // Generic placeholder
          chartConfig = {
            type: 'bar',
            data: {
              labels: ['Content', 'Quality', 'Impact'],
              datasets: [{
                label: contentType.replace('_', ' ').toUpperCase(),
                data: [8, 9, 7],
                backgroundColor: '#1890ff',
                borderColor: '#1890ff',
                borderWidth: 1
              }]
            },
            options: {
              title: {
                display: true,
                text: title,
                fontSize: 18,
                fontColor: '#333'
              },
              scales: {
                y: {
                  beginAtZero: true,
                  max: 10
                }
              },
              responsive: false,
              animation: false
            }
          };
      }

      const width = options.width || 800;
      const height = options.height || 600;
      
      // Generate URL for QuickChart
      const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=${width}&h=${height}&format=png`;

      const generationTime = Date.now() - startTime;

      return {
        imageUrl: chartUrl,
        thumbnailUrl: chartUrl,
        altText: `Generated ${contentType.replace('_', ' ')} placeholder: ${prompt}`,
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
    
    // Extract key themes and topics from content
    const keyPhrases = this.extractKeyPhrases(content, title);
    
    switch (contentType) {
      case 'hero_image':
        return `Professional hero image for blog post "${title}". 
          Key themes: ${keyPhrases.join(', ')}. 
          Style: modern, engaging, high-quality photography or digital art that captures the essence of ${title}. 
          Should be suitable for website header, professional and eye-catching.`;
          
      case 'infographic':
        return `Clean, professional infographic illustrating key concepts from "${title}". 
          Focus on: ${keyPhrases.join(', ')}. 
          Style: modern infographic design with clear typography, icons, and visual hierarchy. 
          Should summarize main points visually with charts, icons, and concise text.`;
          
      case 'social_media':
        return `Engaging social media image for "${title}". 
          Highlight: ${keyPhrases.slice(0, 3).join(', ')}. 
          Style: optimized for social sharing, bold and attention-grabbing, includes visual elements that represent ${title}. 
          Modern design suitable for LinkedIn, Twitter, Facebook posts.`;
          
      default:
        return `Professional visual content for "${title}" focusing on ${keyPhrases.slice(0, 2).join(', ')}`;
    }
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
   * Generate suggested visual content for blog post content
   */
  async suggestVisualContent(blogContent, brandGuidelines = {}) {
    const suggestions = [];

    // Always suggest a hero image with detailed prompt
    const heroPrompt = this.createDetailedPrompt(blogContent, 'hero_image');
    suggestions.push({
      contentType: 'hero_image',
      prompt: heroPrompt,
      priority: 'high',
      reasoning: 'Hero images increase engagement and provide visual appeal'
    });

    // Suggest infographics for list-based or statistical content
    if (blogContent.content && (
      blogContent.content.includes('statistics') ||
      blogContent.content.includes('steps') ||
      blogContent.content.match(/\d+\./g)?.length > 2
    )) {
      const infographicPrompt = this.createDetailedPrompt(blogContent, 'infographic');
      suggestions.push({
        contentType: 'infographic',
        prompt: infographicPrompt,
        priority: 'medium',
        reasoning: 'Content contains lists or statistics that would benefit from visual representation'
      });
    }

    // Suggest charts for data-heavy content
    if (blogContent.content && (
      blogContent.content.includes('percentage') ||
      blogContent.content.includes('data') ||
      blogContent.content.includes('survey') ||
      blogContent.content.includes('research')
    )) {
      suggestions.push({
        contentType: 'chart',
        prompt: 'Data visualization chart',
        priority: 'medium',
        reasoning: 'Content mentions data or statistics that could be visualized',
        chartConfig: {
          type: 'bar',
          data: {
            labels: ['Sample Data'],
            datasets: [{
              label: 'Sample Dataset',
              data: [1],
              backgroundColor: brandGuidelines.primary_color || '#1976d2'
            }]
          }
        }
      });
    }

    // Suggest social media images for shareable content
    const socialPrompt = this.createDetailedPrompt(blogContent, 'social_media');
    suggestions.push({
      contentType: 'social_media',
      prompt: socialPrompt,
      priority: 'low',
      reasoning: 'Social media images improve shareability and engagement'
    });

    // Enrich suggestions with service selection and cost information
    const enrichedSuggestions = suggestions.map((suggestion, index) => {
      const selectedService = this.selectService(suggestion.contentType, 'standard');
      const service = this.services[selectedService];
      
      return {
        ...suggestion,
        id: `visual-${suggestion.contentType}-${index}`, // Add required ID
        title: this.getContentTitle(suggestion.contentType), // Add required title
        recommendedService: selectedService, // Match expected field name
        selectedService: selectedService, // Keep for backward compatibility
        serviceName: service?.name || 'Unknown',
        estimatedCost: service?.costPerImage || 0,
        estimatedTime: selectedService === 'quickchart' ? '5-10s' : '30-60s', // Match expected format based on service
        generationTime: selectedService === 'quickchart' ? '5-10 seconds' : '30-60 seconds', // Keep for backward compatibility
        placement: this.suggestPlacement(suggestion.contentType),
        altText: `${this.getContentTitle(suggestion.contentType)} for blog post`, // Add alt text
        description: this.getContentDescription(suggestion.contentType)
      };
    });

    console.log(`✅ Generated ${enrichedSuggestions.length} visual content suggestions`);
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