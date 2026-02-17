import OpenAI from 'openai';
import dotenv from 'dotenv';
import db from './database.js';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Integration Pitch Generator Service
 * Generates personalized, business-specific pitches for Google integrations
 * Focus: specific outcomes, automation, and value for THIS user's business
 */
export class IntegrationPitchGenerator {
  /**
   * Generate streaming pitch for Google Trends integration
   */
  async *generateTrendsPitch(userId) {
    const strategiesQuery = `
      SELECT
        a.customer_problem,
        a.projected_profit_low,
        a.projected_profit_high,
        a.conversion_score,
        a.pricing_monthly
      FROM audiences a
      INNER JOIN strategy_purchases sp ON a.id = sp.strategy_id
      WHERE sp.user_id = $1 AND sp.status = 'active'
      LIMIT 1
    `;

    const result = await db.query(strategiesQuery, [userId]);
    const strategy = result.rows[0] || {};

    const businessContext = strategy.customer_problem || 'your business';
    const profitGoal = strategy.projected_profit_high || 0;

    const prompt = `Write a concise pitch for Google Trends integration.

**USER'S BUSINESS:** ${businessContext}

**INSTRUCTIONS:**
Write exactly 4-5 sentences. Be direct and conversational.

1. Start with their challenge (can't track trending topics manually)
2. Explain what we'll do automatically (monitor trends daily, generate content on rising topics)
3. Give ONE specific example in their niche
4. End with: "You don't lift a finger—it's fully automated."

**RULES:**
- NO metaphors or flowery language
- NO outcome claims or projections
- NO dramatic language
- Just explain the process simply`;

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      temperature: 0.7,
      max_tokens: 250
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }

  /**
   * Generate streaming pitch for Google Search Console
   */
  async *generateSearchConsolePitch(userId) {
    const strategiesQuery = `
      SELECT customer_problem, conversion_score, pricing_monthly, projected_profit_high
      FROM audiences a
      INNER JOIN strategy_purchases sp ON a.id = sp.strategy_id
      WHERE sp.user_id = $1 AND sp.status = 'active'
      LIMIT 1
    `;

    const result = await db.query(strategiesQuery, [userId]);
    const strategy = result.rows[0] || {};

    const businessContext = strategy.customer_problem || 'your business';
    const investment = strategy.pricing_monthly || 39.99;

    const prompt = `Write a concise pitch for Google Search Console integration.

**USER'S BUSINESS:** ${businessContext}
**MONTHLY INVESTMENT:** $${investment}

**INSTRUCTIONS:**
Write exactly 4-5 sentences. Be direct and conversational.

1. Start with the challenge (investing $${investment}/month but can't see what's working in search)
2. Explain what Search Console shows (keyword rankings, which posts get clicks)
3. Explain what we'll do automatically (track rankings, optimize near-page-1 content, create supporting content)
4. Give ONE specific example in their niche
5. End with: "You don't lift a finger—it's fully automated."

**RULES:**
- NO metaphors or flowery language
- NO outcome claims
- Just explain the process simply`;

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      temperature: 0.7,
      max_tokens: 250
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }

  /**
   * Generate streaming pitch for Google Analytics
   */
  async *generateAnalyticsPitch(userId) {
    const strategiesQuery = `
      SELECT customer_problem, projected_profit_low, projected_profit_high, pricing_monthly
      FROM audiences a
      INNER JOIN strategy_purchases sp ON a.id = sp.strategy_id
      WHERE sp.user_id = $1 AND sp.status = 'active'
      LIMIT 1
    `;

    const result = await db.query(strategiesQuery, [userId]);
    const strategy = result.rows[0] || {};

    const businessContext = strategy.customer_problem || 'your business';
    const monthlyInvestment = strategy.pricing_monthly || 39.99;
    const profitGoal = strategy.projected_profit_high || 0;

    const prompt = `Write a concise pitch for Google Analytics integration.

**USER'S BUSINESS:** ${businessContext}
**MONTHLY INVESTMENT:** $${monthlyInvestment}

**INSTRUCTIONS:**
Write exactly 4-5 sentences. Be direct and conversational.

1. Start with the challenge (investing $${monthlyInvestment}/month but don't know what converts visitors to customers)
2. Explain what Analytics shows (which content drives conversions, not just traffic)
3. Explain what we'll do automatically (identify high-converting topics, create more of what works, avoid low-converting topics)
4. Give ONE specific example in their niche
5. End with: "You don't lift a finger—it's fully automated."

**RULES:**
- NO metaphors or flowery language
- NO outcome claims or profit projections
- Just explain the process simply`;

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      temperature: 0.7,
      max_tokens: 250
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }
}

const integrationPitchGenerator = new IntegrationPitchGenerator();
export default integrationPitchGenerator;
