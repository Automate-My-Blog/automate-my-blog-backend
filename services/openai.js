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
      
      const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
      console.log('Using OpenAI model:', model);
      
      const completion = await openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: 'system',
            content: `You are a business analyst specializing in understanding websites and their target audiences. Analyze the provided website content and extract key business information.`
          },
          {
            role: 'user',
            content: `Please analyze this website (${url}) and extract the following information in JSON format:

Website Content:
${websiteContent}

Please provide a JSON response with these fields:
{
  "businessType": "string - primary industry/category",
  "businessName": "string - company/brand name",
  "targetAudience": "string - primary customer demographic",
  "contentFocus": "string - main content themes/topics",
  "brandVoice": "string - tone and personality",
  "brandColors": {
    "primary": "string - hex color",
    "secondary": "string - hex color", 
    "accent": "string - hex color"
  },
  "description": "string - brief business description",
  "keywords": ["array", "of", "relevant", "keywords"]
}`
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
            content: `You are a content marketing expert who identifies trending topics and creates engaging blog post ideas.`
          },
          {
            role: 'user',
            content: `Generate 5 trending blog post topics for this business:
- Business Type: ${businessType}
- Target Audience: ${targetAudience}
- Content Focus: ${contentFocus}

For each topic, provide a JSON object with:
{
  "id": number,
  "trend": "string - trending keyword/topic",
  "title": "string - engaging blog post title",
  "subheader": "string - compelling subtitle/description",
  "popularity": "string - trending percentage (e.g., 'Trending +250%')",
  "category": "string - content category"
}

Return an array of 5 such objects.`
          }
        ],
        temperature: 0.7,
        max_tokens: 1500
      });

      const response = completion.choices[0].message.content;
      const topics = this.parseOpenAIResponse(response);

      // Generate DALL-E images for first 2 topics only (for speed)
      console.log('Generating DALL-E images for first 2 topics');
      const dalleLimit = Math.min(2, topics.length);
      
      for (let i = 0; i < dalleLimit; i++) {
        console.log(`Generating DALL-E image ${i + 1}/${dalleLimit} for topic: ${topics[i].title}`);
        topics[i].image = await this.generateTopicImage(topics[i]);
      }
      
      // Use placeholder images for remaining topics
      for (let i = dalleLimit; i < topics.length; i++) {
        const placeholderUrl = `https://via.placeholder.com/400x250/6B8CAE/FFFFFF?text=${encodeURIComponent(topics[i].category || 'Topic')}`;
        topics[i].image = placeholderUrl;
        console.log(`Using placeholder for topic ${i + 1}: ${topics[i].title}`);
      }

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
      
      // Create a descriptive prompt for the image
      const prompt = `Create a professional, engaging blog header image for: "${topic.title}". 
      Style: Modern, clean, relevant to the topic. 
      Colors: Professional and appealing. 
      No text overlay needed.`;

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