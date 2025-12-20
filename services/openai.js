import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export class OpenAIService {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required in environment variables');
    }
  }

  /**
   * Clean OpenAI response by removing markdown code blocks and parsing JSON
   */
  parseOpenAIResponse(response) {
    try {
      // Log the raw response for debugging
      console.log('Raw OpenAI response:', response);
      
      // Remove markdown code blocks if present
      let cleanedResponse = response.trim();
      
      // Remove ```json at the beginning and ``` at the end
      if (cleanedResponse.startsWith('```json')) {
        cleanedResponse = cleanedResponse.substring(7);
      } else if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse.substring(3);
      }
      
      if (cleanedResponse.endsWith('```')) {
        cleanedResponse = cleanedResponse.slice(0, -3);
      }
      
      // Trim whitespace
      cleanedResponse = cleanedResponse.trim();
      
      console.log('Cleaned response:', cleanedResponse);
      
      // Parse JSON
      return JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.error('JSON parsing failed:', parseError);
      console.error('Attempted to parse:', response);
      
      // Try parsing the original response as a fallback
      try {
        return JSON.parse(response);
      } catch (fallbackError) {
        throw new Error(`Failed to parse OpenAI response as JSON: ${parseError.message}`);
      }
    }
  }

  /**
   * Analyze website content and extract business information
   */
  async analyzeWebsite(websiteContent, url) {
    try {
      console.log('OpenAI request starting...');
      console.log('Model:', process.env.OPENAI_MODEL || 'gpt-3.5-turbo');
      console.log('Content length:', websiteContent?.length || 0);
      
      // Check for minimal content that might indicate JavaScript-heavy site
      if (websiteContent && websiteContent.length < 500) {
        console.log('Warning: Very limited content detected. Possible JavaScript-heavy site.');
      }
      
      if (websiteContent && websiteContent.toLowerCase().includes('javascript') && websiteContent.length < 1000) {
        console.log('Warning: Site appears to require JavaScript for content rendering.');
      }
      
      const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
      console.log('Using OpenAI model:', model);
      
      const completion = await openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: 'system',
            content: `You are a customer psychology expert who analyzes ANY type of business to understand real customer behavior. You must be extremely precise with your analysis and follow the exact JSON format specified. Your responses will be parsed by code, so accuracy is critical.`
          },
          {
            role: 'user',
            content: `Analyze this website and provide customer psychology insights for content marketing:

Website: ${url}
Content: ${websiteContent}

CRITICAL REQUIREMENTS:
1. Return EXACTLY the JSON structure specified - no deviations
2. ALL fields are REQUIRED - no empty strings or null values
3. Follow character limits strictly
4. Use realistic customer language, not business jargon
5. Think systematically about who pays vs who uses the product/service

ANALYSIS FRAMEWORK:
- Who has purchasing power/budget authority vs who uses the product?
- What real problems drive people to search for this business type?
- How do customers actually describe their problems (emotional language)?
- When are customers most likely to search (urgency, emotional state)?

JSON RESPONSE (follow EXACTLY):
{
  "businessType": "Specific category (max 50 chars) - be descriptive, avoid generic terms like 'E-commerce' or 'Technology'",
  "businessName": "Exact company name from website content",
  "decisionMakers": "Who actually makes purchasing decisions (max 100 chars) - consider demographics, role, authority",
  "endUsers": "Who uses the product/service (max 100 chars) - may be same as decision makers",
  "customerProblems": ["4-5 specific problems that drive search behavior", "use emotional language customers use", "focus on pain points", "be specific not generic"],
  "searchBehavior": "When/how customers search (max 150 chars) - urgency, emotional state, timing patterns",
  "customerLanguage": ["4-6 phrases customers actually type into Google", "use their words not business terms", "include emotional descriptors", "real search phrases"],
  "contentFocus": "Content themes addressing customer problems (max 100 chars)",
  "brandVoice": "Communication tone for this customer situation (max 50 chars)",
  "brandColors": {
    "primary": "Hex code for primary brand color from website",
    "secondary": "Hex code for secondary/background color", 
    "accent": "Hex code for accent/highlight color"
  },
  "description": "How business solves customer problems (max 150 chars)",
  "keywords": ["6-8 realistic search terms customers use", "customer language not SEO jargon", "include problem-focused terms", "use emotional descriptors when relevant"]
}

VALIDATION RULES:
- NO placeholder text like "Target Audience" or "Business Type"
- NO generic terms like "customers" or "users" - be specific
- NO business jargon - use customer language
- ALL arrays must have specified number of items
- ALL text must be under character limits
- JSON must be valid and parseable`
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      });

      console.log('OpenAI request completed successfully');
      console.log('Response choices:', completion.choices?.length || 0);
      
      const response = completion.choices[0].message.content;
      console.log('Response content length:', response?.length || 0);
      
      return this.parseOpenAIResponse(response);
    } catch (error) {
      console.error('OpenAI website analysis error:', error);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        status: error.status,
        code: error.code,
        type: error.type
      });
      throw new Error(`Failed to analyze website with AI: ${error.message}`);
    }
  }

  /**
   * Generate trending topics for a specific industry
   */
  async generateTrendingTopics(businessType, targetAudience, contentFocus) {
    try {
      // First, generate the topic ideas without images
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are a content strategist who creates blog topics that drive qualified traffic. You understand search intent, audience needs, and how to connect content topics to business goals. Your recommendations are factual, specific, and focused on attracting the right audience through valuable content.`
          },
          {
            role: 'user',
            content: `Generate 2 strategic blog post topics for this business that will attract their target audience:

Business Analysis:
- Business Type: ${businessType}
- Target Audience: ${targetAudience}
- Content Focus: ${contentFocus}

Create topics that would genuinely help this target audience and drive qualified traffic. For each topic, provide:
{
  "id": number,
  "trend": "string - content theme/topic area",
  "title": "string - SEO-optimized blog post title that the target audience would search for",
  "subheader": "string - compelling subtitle that explains the value to the reader",
  "seoBenefit": "string - specific benefit like 'Can help drive [specific audience segment] to your website when they search for [specific search terms]' or 'Can help [audience type] find your [service type] when they look for [specific problem/solution]'",
  "category": "string - content category that aligns with business expertise"
}

Focus on:
1. Topics the target audience actively searches for
2. Content that showcases business expertise
3. Realistic SEO opportunities (not overstated claims)
4. Specific audience-keyword connections

Return an array of 2 strategic topics that align with the business goals and audience needs.`
          }
        ],
        temperature: 0.7,
        max_tokens: 1500
      });

      const response = completion.choices[0].message.content;
      const topics = this.parseOpenAIResponse(response);

      // Generate DALL-E images for all topics (now only 2)
      console.log('Generating DALL-E images for all topics');
      const dalleLimit = topics.length;
      
      for (let i = 0; i < dalleLimit; i++) {
        console.log(`Generating DALL-E image ${i + 1}/${dalleLimit} for topic: ${topics[i].title}`);
        topics[i].image = await this.generateTopicImage(topics[i]);
      }
      
      // All topics now have DALL-E images

      return topics;
    } catch (error) {
      console.error('OpenAI trending topics error:', error);
      throw new Error('Failed to generate trending topics with AI');
    }
  }

  /**
   * Generate blog post content
   */
  async generateBlogPost(topic, businessInfo, additionalInstructions = '') {
    try {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are an expert blog content writer who creates engaging, SEO-optimized blog posts tailored to specific audiences and brand voices.`
          },
          {
            role: 'user',
            content: `Write a complete blog post with the following specifications:

Topic: ${topic.title}
Subtitle: ${topic.subheader}
Business Type: ${businessInfo.businessType}
Target Audience: ${businessInfo.targetAudience}
Brand Voice: ${businessInfo.brandVoice}
Content Focus: ${businessInfo.contentFocus}

Additional Instructions: ${additionalInstructions}

Please provide a JSON response with:
{
  "title": "string - SEO-optimized title",
  "subtitle": "string - engaging subtitle",
  "metaDescription": "string - SEO meta description (150-160 chars)",
  "content": "string - full blog post content in markdown format",
  "tags": ["array", "of", "relevant", "tags"],
  "estimatedReadTime": "string - reading time estimate",
  "seoKeywords": ["array", "of", "SEO", "keywords"]
}

The content should be:
- 1000-1500 words
- Engaging and informative
- SEO-optimized
- Tailored to the target audience
- Written in the specified brand voice
- Include relevant headers and subheaders
- Actionable and valuable`
          }
        ],
        temperature: 0.7,
        max_tokens: 2500
      });

      const response = completion.choices[0].message.content;
      return this.parseOpenAIResponse(response);
    } catch (error) {
      console.error('OpenAI blog generation error:', error);
      throw new Error('Failed to generate blog content with AI');
    }
  }

  /**
   * Generate export content in different formats
   */
  async generateExportContent(blogPost, format) {
    try {
      let prompt = '';
      
      switch (format.toLowerCase()) {
        case 'markdown':
          prompt = `Convert this blog post to clean markdown format:
Title: ${blogPost.title}
Content: ${blogPost.content}

Return only the markdown content, properly formatted.`;
          break;
          
        case 'html':
          prompt = `Convert this blog post to clean HTML format:
Title: ${blogPost.title}
Content: ${blogPost.content}

Return a complete HTML document with proper structure, meta tags, and styling.`;
          break;
          
        case 'json':
          return JSON.stringify(blogPost, null, 2);
          
        default:
          throw new Error(`Unsupported export format: ${format}`);
      }

      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a content formatter that converts blog posts to different formats while maintaining quality and structure.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 2000
      });

      return completion.choices[0].message.content;
    } catch (error) {
      console.error('OpenAI export generation error:', error);
      throw new Error('Failed to generate export content with AI');
    }
  }

  /**
   * Generate image using DALL-E for blog topics
   */
  async generateTopicImage(topic) {
    try {
      console.log('Generating DALL-E image for topic:', topic.title);
      
      // Create a descriptive prompt for realistic blog header image
      const prompt = `Create a high-quality, realistic image for the blog post: "${topic.title}". 
      
      Style: Professional photography, sharp focus, excellent lighting
      Quality: Ultra-high resolution, magazine quality, commercial photography
      Composition: Clean, modern, suitable for blog header use
      Colors: Vibrant but professional color palette
      Requirements: No text, no people's faces, realistic style only
      
      The image should look like a professional stock photo that perfectly represents the topic.`;

      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: prompt,
        size: "1024x1024",
        quality: "standard",
        n: 1,
      });

      console.log('DALL-E image generated successfully');
      return response.data[0].url;
      
    } catch (error) {
      console.error('DALL-E image generation error:', error);
      
      // Fallback to a placeholder image if DALL-E fails
      const fallbackUrl = `https://via.placeholder.com/400x250/6B8CAE/FFFFFF?text=${encodeURIComponent(topic.title.substring(0, 30))}`;
      console.log('Using fallback image:', fallbackUrl);
      return fallbackUrl;
    }
  }
}

export default new OpenAIService();