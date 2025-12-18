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
   * Analyze website content and extract business information
   */
  async analyzeWebsite(websiteContent, url) {
    try {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4',
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

      const response = completion.choices[0].message.content;
      return JSON.parse(response);
    } catch (error) {
      console.error('OpenAI website analysis error:', error);
      throw new Error('Failed to analyze website with AI');
    }
  }

  /**
   * Generate trending topics for a specific industry
   */
  async generateTrendingTopics(businessType, targetAudience, contentFocus) {
    try {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4',
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
  "image": "string - Unsplash image URL (use appropriate search terms)",
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
      return JSON.parse(response);
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
        model: process.env.OPENAI_MODEL || 'gpt-4',
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
      return JSON.parse(response);
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
        model: process.env.OPENAI_MODEL || 'gpt-4',
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
}

export default new OpenAIService();