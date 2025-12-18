# AutoBlog Backend API

AI-powered blog content generation API for the AutoBlog platform.

## Features

- **Website Analysis**: Scrape and analyze websites to understand business type, audience, and brand voice
- **Trending Topics**: Generate relevant trending blog topics based on industry and audience
- **Content Generation**: Create complete blog posts with AI
- **Export Functionality**: Export content in multiple formats (Markdown, HTML, JSON)

## API Endpoints

### Health Check
- `GET /health` - API health status

### Website Analysis
- `POST /api/analyze-website` - Analyze website content
```json
{
  "url": "https://example.com"
}
```

### Trending Topics
- `POST /api/trending-topics` - Generate trending topics
```json
{
  "businessType": "Child Wellness & Parenting",
  "targetAudience": "Parents of children aged 2-12",
  "contentFocus": "Emotional wellness, child development"
}
```

### Content Generation
- `POST /api/generate-content` - Generate blog post
```json
{
  "topic": {
    "title": "Blog post title",
    "subheader": "Blog post subtitle"
  },
  "businessInfo": {
    "businessType": "...",
    "targetAudience": "...",
    "brandVoice": "..."
  },
  "additionalInstructions": "Optional additional guidance"
}
```

### Export
- `POST /api/export` - Export content in various formats
```json
{
  "blogPost": { ... },
  "format": "markdown" // or "html" or "json"
}
```

## Environment Variables

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4
PORT=3001
NODE_ENV=production
USER_AGENT="AutoBlog Bot 1.0"
ANALYSIS_TIMEOUT=10000
```

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Deployment

Deploy to Vercel:
```bash
vercel
```

## Technology Stack

- Node.js + Express
- OpenAI GPT-4 API
- Puppeteer for web scraping
- Cheerio for HTML parsing
- CORS and rate limiting