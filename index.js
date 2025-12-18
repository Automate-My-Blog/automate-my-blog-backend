import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import openaiService from './services/openai.js';
import webScraperService from './services/webscraper.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Rate limiting with Vercel-compatible configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  // Fix for Vercel serverless environment
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress || 'unknown';
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  }
});

// Middleware
app.use(limiter);
app.use(cors({
  origin: [
    'https://automatemyblog.com',
    'https://www.automatemyblog.com',
    'https://automatemyblog.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  const keyLength = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0;
  
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'AutoBlog API',
    env: {
      nodeEnv: process.env.NODE_ENV,
      hasOpenAIKey,
      openaiKeyLength: keyLength,
      openaiModel: process.env.OPENAI_MODEL || 'gpt-4'
    }
  });
});

// API routes index
app.get('/api', (req, res) => {
  res.json({
    message: 'AutoBlog API v1.0.0',
    description: 'AI-powered blog content generation API',
    version: '1.0.0',
    endpoints: {
      'GET /health': 'Health check endpoint',
      'POST /api/analyze-website': 'Analyze website content and extract business information',
      'POST /api/trending-topics': 'Generate trending blog topics for a business',
      'POST /api/generate-content': 'Generate complete blog post content',
      'POST /api/export': 'Export blog content in different formats (markdown, html, json)'
    },
    documentation: 'https://github.com/james-frankel-123/automatemyblog-backend'
  });
});

// Analyze website endpoint
app.post('/api/analyze-website', async (req, res) => {
  console.log('=== Website Analysis Request ===');
  console.log('Request body:', req.body);
  console.log('Headers:', req.headers);
  console.log('User-Agent:', req.headers['user-agent']);
  
  try {
    const { url } = req.body;

    console.log('Analyzing URL:', url);

    if (!url) {
      console.log('Error: No URL provided');
      return res.status(400).json({
        error: 'URL is required',
        message: 'Please provide a valid website URL'
      });
    }

    if (!webScraperService.isValidUrl(url)) {
      console.log('Error: Invalid URL format:', url);
      return res.status(400).json({
        error: 'Invalid URL format',
        message: 'Please provide a valid HTTP or HTTPS URL'
      });
    }

    console.log('Starting website scraping...');
    // Scrape website content
    const scrapedContent = await webScraperService.scrapeWebsite(url);
    console.log('Scraping completed. Title:', scrapedContent.title);
    console.log('Content length:', scrapedContent.content?.length || 0);
    
    // Combine title, description, content for analysis
    const fullContent = `
      Title: ${scrapedContent.title}
      Meta Description: ${scrapedContent.metaDescription}
      Headings: ${scrapedContent.headings.join(', ')}
      Content: ${scrapedContent.content}
    `.trim();

    console.log('Starting OpenAI analysis...');
    // Analyze with OpenAI
    const analysis = await openaiService.analyzeWebsite(fullContent, url);
    console.log('OpenAI analysis completed:', analysis?.businessType || 'N/A');

    const response = {
      success: true,
      url,
      scrapedAt: scrapedContent.scrapedAt,
      analysis,
      metadata: {
        title: scrapedContent.title,
        headings: scrapedContent.headings
      }
    };

    console.log('Sending successful response');
    res.json(response);

  } catch (error) {
    console.error('=== Website Analysis Error ===');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('================================');
    
    res.status(500).json({
      error: 'Analysis failed',
      message: error.message
    });
  }
});

// Trending topics endpoint
app.post('/api/trending-topics', async (req, res) => {
  try {
    const { businessType, targetAudience, contentFocus } = req.body;

    if (!businessType || !targetAudience || !contentFocus) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'businessType, targetAudience, and contentFocus are required'
      });
    }

    const topics = await openaiService.generateTrendingTopics(
      businessType, 
      targetAudience, 
      contentFocus
    );

    res.json({
      success: true,
      businessType,
      targetAudience,
      contentFocus,
      topics,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Trending topics error:', error);
    res.status(500).json({
      error: 'Failed to generate trending topics',
      message: error.message
    });
  }
});

// Generate content endpoint
app.post('/api/generate-content', async (req, res) => {
  try {
    const { topic, businessInfo, additionalInstructions } = req.body;

    if (!topic || !businessInfo) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'topic and businessInfo are required'
      });
    }

    if (!topic.title || !topic.subheader) {
      return res.status(400).json({
        error: 'Invalid topic format',
        message: 'topic must include title and subheader'
      });
    }

    const blogPost = await openaiService.generateBlogPost(
      topic,
      businessInfo,
      additionalInstructions || ''
    );

    res.json({
      success: true,
      topic,
      businessInfo: {
        businessType: businessInfo.businessType,
        targetAudience: businessInfo.targetAudience,
        brandVoice: businessInfo.brandVoice
      },
      blogPost,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Content generation error:', error);
    res.status(500).json({
      error: 'Failed to generate content',
      message: error.message
    });
  }
});

// Export endpoint
app.post('/api/export', async (req, res) => {
  try {
    const { blogPost, format } = req.body;

    if (!blogPost || !format) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'blogPost and format are required'
      });
    }

    const supportedFormats = ['markdown', 'html', 'json'];
    if (!supportedFormats.includes(format.toLowerCase())) {
      return res.status(400).json({
        error: 'Unsupported format',
        message: `Supported formats: ${supportedFormats.join(', ')}`
      });
    }

    const exportedContent = await openaiService.generateExportContent(blogPost, format);

    // Set appropriate content type and filename
    let contentType = 'text/plain';
    let fileExtension = 'txt';
    
    switch (format.toLowerCase()) {
      case 'markdown':
        contentType = 'text/markdown';
        fileExtension = 'md';
        break;
      case 'html':
        contentType = 'text/html';
        fileExtension = 'html';
        break;
      case 'json':
        contentType = 'application/json';
        fileExtension = 'json';
        break;
    }

    const filename = `${blogPost.title?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'blog-post'}.${fileExtension}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(exportedContent);

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({
      error: 'Export failed',
      message: error.message
    });
  }
});

// Test endpoint for OpenAI without web scraping
app.post('/api/test-openai', async (req, res) => {
  try {
    console.log('Testing OpenAI directly...');
    
    // First test basic OpenAI connectivity
    const OpenAI = (await import('openai')).default;
    const testClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    console.log('Testing basic OpenAI call...');
    const simpleTest = await testClient.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Say hello' }],
      max_tokens: 10
    });
    
    console.log('Basic test successful:', simpleTest.choices[0].message.content);
    
    // Now test our service
    const mockContent = `
      Title: Test Website
      Meta Description: A test website for debugging
      Headings: Welcome, About Us
      Content: This is a test website for debugging the OpenAI integration.
    `;

    const analysis = await openaiService.analyzeWebsite(mockContent, 'https://test.com');
    
    console.log('OpenAI test successful:', analysis);
    
    res.json({
      success: true,
      message: 'OpenAI is working correctly',
      basicTest: simpleTest.choices[0].message.content,
      analysis
    });

  } catch (error) {
    console.error('OpenAI test failed:', error);
    res.status(500).json({
      error: 'OpenAI test failed',
      message: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AutoBlog API server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 API base: http://localhost:${PORT}/api`);
});

export default app;