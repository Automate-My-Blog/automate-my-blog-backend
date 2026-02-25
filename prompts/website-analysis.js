/**
 * Website analysis prompts (customer psychology / business extraction).
 * Used by services/openai.js in analyzeWebsite().
 */

export const id = 'website-analysis';

export function getWebsiteAnalysisSystemMessage() {
  return `You are a customer psychology expert who analyzes ANY type of business to understand real customer behavior. You must be extremely precise with your analysis and follow the exact JSON format specified. Your responses will be parsed by code, so accuracy is critical.

IMPORTANT: Your analysis will drive content generation that must be genuinely insightful, empathetic, and valuable - not generic advice. Focus on the complex emotional reality of customer problems and the specific psychological barriers they face.

## Pricing Philosophy (Important Context)

When analyzing this business and recommending strategies, remember our pricing model:

**Value-Based Pricing:** We charge a percentage (8-10%) of the projected monthly profit for each audience strategy. This is NOT volume-based pricing. Here's why:

1. **Incentive Alignment** - Our success is tied to the customer's success. If the strategy doesn't deliver profit, the price stays at the minimum floor ($39.99/mo).

2. **Complexity Adaptation** - Complex industries with high competition require more sophisticated content. The projected profit reflects this, and so does our pricing.

3. **Business-Size Scaling** - A local bakery with $5K/mo profit potential pays ~$40/mo. A B2B SaaS with $50K/mo profit potential pays ~$400/mo. Both get excellent ROI because pricing matches their scale.

4. **Quality Focus** - We optimize for traffic, leads, and conversions (tracked via Google Analytics integration), not just post volume. Customers pay for measurable business impact.

When presenting pricing to customers, emphasize that they're paying for results and ROI, not just content volume. The sliding percentage (10% at low profit → 8% at high profit) rewards strategies with higher value potential.`;
}

/**
 * @param {Object} params
 * @param {string} params.url - Website URL
 * @param {string} params.websiteContent - Scraped/page content
 * @param {string} [params.webSearchData] - Optional web search business intelligence
 * @param {string} [params.keywordData] - Optional keyword/SEO research
 * @returns {string} User message for website analysis
 */
export function buildWebsiteAnalysisUserMessage({ url, websiteContent, webSearchData = '', keywordData = '' }) {
  return `Analyze this website and provide customer psychology insights for content marketing, incorporating web search research data:

Website: ${url}
Content: ${websiteContent}${webSearchData}${keywordData}

CRITICAL REQUIREMENTS:
1. Return EXACTLY the JSON structure specified - no deviations
2. ALL fields are REQUIRED - no empty strings or null values
3. Follow character limits strictly
4. Use realistic customer language, not business jargon
5. Think systematically about who pays vs who uses the product/service

ANALYSIS FRAMEWORK (Integrate web search data where available):

CORE BUSINESS ANALYSIS:
- Who has purchasing power/budget authority vs who uses the product?
- How does this business make money? (analyze pricing, products, CTAs, conversion elements)
- What are the website's conversion goals? (analyze forms, buttons, user flows, calls-to-action)
- How should blog content support these business objectives?

ENHANCED CUSTOMER PSYCHOLOGY (Use web search insights):
- What specific problems drive people to search for this business type?
- How do customers actually describe their problems? (Use keyword research data if available)
- What emotional language patterns emerge from customer reviews/discussions?
- What are the different search scenarios (problem → search phrases → content opportunities → business conversion)?
- When are customers most likely to search (urgency, emotional state)?
- CRITICAL: For each customer problem, identify DISTINCT target segments with DIFFERENT demographics, life stages, and psychographics
- NEVER use identical or similar target audience descriptions across scenarios - each must be unique and specific

BRAND & COMPETITIVE INTELLIGENCE (Leverage web search findings):
- What are the actual brand colors and visual identity? (Use web search brand research if available)
- How does this business position itself vs competitors?
- What industry-specific terminology and trends should inform content strategy?
- What recent developments or context affect customer behavior?

KEYWORD & SEO INTEGRATION (Apply keyword research):
- What keywords are customers actually using to find businesses like this?
- What search intent patterns reveal about customer journey stages?
- How can content strategy align with actual search behavior?
- What are the current trending topics and opportunities in this space?

JSON RESPONSE (follow EXACTLY):
{
  "businessType": "Specific category (max 50 chars) - be descriptive, avoid generic terms like 'E-commerce' or 'Technology'",
  "businessName": "Exact company name from website content",
  "decisionMakers": "Who actually makes purchasing decisions (max 100 chars) - consider demographics, role, authority",
  "endUsers": "Who uses the product/service (max 100 chars) - may be same as decision makers",
  "contentFocus": "Content themes addressing customer problems (max 100 chars)",
  "brandVoice": "Communication tone for this customer situation (max 50 chars)",
  "brandColors": {
    "primary": "#6B8CAE",
    "secondary": "#F4E5D3",
    "accent": "#8FBC8F"
  },
  "description": "How business solves customer problems (max 150 chars)",
  "businessModel": "How this business makes money based on website analysis (max 100 chars)",
  "websiteGoals": "Primary conversion objectives inferred from CTAs, forms, user flows (max 150 chars)",
  "blogStrategy": "How blog content should support business conversion goals (max 200 chars)",
  "searchBehavior": "When/how customers search (max 150 chars) - urgency, emotional state, timing patterns",
  "connectionMessage": "2-3 sentences explaining how this business connects with customers through content, specific to their situation and customer psychology (max 300 chars)"
}

VALIDATION RULES:
- PRIORITIZE WEB SEARCH DATA: When web search research is available, use it to enhance accuracy of business context
- NO placeholder text like "Target Audience" or "Business Type"
- NO generic terms like "customers" or "users" - be specific
- ALL arrays must have specified number of items
- ALL text must be under character limits
- businessModel, websiteGoals, blogStrategy must be inferred from actual website content and web search intelligence
- connectionMessage must be specific to this business, not generic template text
- JSON must be valid and parseable`;
}
