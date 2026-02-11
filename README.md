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

Copy `.env.example` to `.env` and fill in values. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for JWT signing (use a strong random value in production) |
| `JWT_REFRESH_SECRET` | Yes | Secret for refresh tokens |
| `PORT` | No | Server port (default: 3001) |
| `REDIS_URL` | For jobs | Redis URL for BullMQ (job queue) |
| `STRIPE_SECRET_KEY` | For billing | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | For webhooks | Stripe webhook signing secret |

See `.env.example` for the full list.

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Testing

```bash
# Unit and integration tests
npm test

# Integration tests only
npm run test:integration

# With coverage
npm run test:coverage
```

## Database

- Migrations live in `database/` and `database/migrations/`
- Run migrations via `scripts/run_migrations.sh` or your deployment pipeline
- Setup from scratch: `npm run setup-db`

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

## CI/CD

This project uses GitHub Actions for continuous integration:

- **Security Scanning** - Dependency vulnerability checks
- **Code Quality** - Automated code quality checks
- **Testing** - Automated test suite execution
- **Environment Validation** - Ensures required env vars are documented
- **PR Size Check** - Warns about large pull requests
- **Dependency Updates** - Weekly checks for outdated packages
- **Schema Diff** - Shows database changes in PR comments
- **Migration Validation** - Runs all database migrations on PRs that touch `database/`
- **Smoke Test** - Starts the server and hits `/health` on every push and PR
- **Stale Issues** - Automatic issue management

See [docs/github-actions-quick-wins.md](./docs/github-actions-quick-wins.md) for details on all workflows. **Vercel** builds only **main** and **staging** (PR and other branch builds are disabled); see [docs/vercel-preview-builds.md](./docs/vercel-preview-builds.md). Recent changes are summarized in [docs/RECENT_UPDATES.md](./docs/RECENT_UPDATES.md).

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for guidelines.