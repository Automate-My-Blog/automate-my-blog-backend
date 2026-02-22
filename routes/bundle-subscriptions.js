import express from 'express';
import db from '../services/database.js';
import pricingCalculator from '../services/pricing-calculator.js';
import Stripe from 'stripe';
import OpenAI from 'openai';
import streamManager from '../services/stream-manager.js';

const router = express.Router();

// Lazy init so server can start when STRIPE_SECRET_KEY or OPENAI_API_KEY is missing.
let _stripe = null;
let _openai = null;
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is required in environment variables');
  }
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required in environment variables');
  }
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

/**
 * Middleware to authenticate requests
 */
const authenticateToken = (req, res, next) => {
  if (!req.user || !req.user.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

/**
 * Generate outcome-focused bundle overview using OpenAI
 */
async function generateBundleOverview(strategies) {
  console.log('🤖 [AI] Starting bundle overview generation:', {
    strategyCount: strategies.length
  });

  try {
    // Extract key information from each strategy
    const strategySummaries = strategies.map((strategy, index) => {
      const targetSegment = typeof strategy.target_segment === 'string'
        ? JSON.parse(strategy.target_segment)
        : strategy.target_segment;

      const demographics = targetSegment?.demographics || 'Unknown audience';

      // Extract search volume from keywords
      const keywords = strategy.keywords || [];
      const totalSearchVolume = keywords.reduce((sum, kw) => {
        return sum + (kw.search_volume || 0);
      }, 0);

      // Extract profit projection from pitch
      const profitMatch = strategy.pitch?.match(/Profit of \$([0-9,]+)-\$([0-9,]+)/);
      const profitLow = profitMatch ? parseInt(profitMatch[1].replace(/,/g, '')) : null;
      const profitHigh = profitMatch ? parseInt(profitMatch[2].replace(/,/g, '')) : null;

      return {
        audience: demographics,
        searchVolume: totalSearchVolume,
        profitLow,
        profitHigh,
        customerProblem: strategy.customer_problem
      };
    });

    console.log('📊 [AI] Strategy summaries prepared:', {
      count: strategySummaries.length,
      samples: strategySummaries.slice(0, 2)
    });

    const prompt = `You are a strategic SEO consultant. Create a compelling, outcome-focused overview for a comprehensive SEO plan that targets multiple audience segments.

Here are the audience strategies included:
${strategySummaries.map((s, i) => `
${i + 1}. ${s.audience}
   - Monthly search volume: ${s.searchVolume.toLocaleString()}
   - Projected monthly profit: $${s.profitLow?.toLocaleString() || 'N/A'}-$${s.profitHigh?.toLocaleString() || 'N/A'}
   - Problem they're solving: ${s.customerProblem}
`).join('\n')}

Write a compelling 2-3 sentence overview that:
1. Describes the comprehensive strategy and how these audiences work together
2. Emphasizes the OUTCOMES (total traffic potential, revenue opportunity, market coverage)
3. Makes it clear this is a complete SEO solution, not just separate strategies

Format your response as JSON with these fields:
{
  "title": "Compelling title for the bundle (4-6 words)",
  "overview": "The compelling 2-3 sentence overview",
  "totalMonthlySearches": <total search volume across all audiences>,
  "projectedMonthlyProfit": {
    "low": <sum of all low profit projections>,
    "high": <sum of all high profit projections>
  },
  "audienceCount": ${strategies.length},
  "keyBenefits": ["benefit 1", "benefit 2", "benefit 3"]
}

Make it outcome-focused, not feature-focused. Focus on business results, not just "N strategies" or "X posts".`;

    console.log('🎯 [AI] Calling OpenAI with gpt-4...');

    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a strategic SEO consultant who writes compelling, outcome-focused marketing copy.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7
    });

    console.log('✅ [AI] OpenAI response received:', {
      hasContent: !!completion.choices[0]?.message?.content
    });

    const result = JSON.parse(completion.choices[0].message.content);

    console.log('✨ [AI] Parsed result:', {
      hasTitle: !!result.title,
      hasOverview: !!result.overview,
      overviewLength: result.overview?.length
    });

    // Add the strategy summaries for display
    result.strategies = strategySummaries;

    return result;
  } catch (error) {
    console.error('❌ [AI] Error generating bundle overview:', {
      message: error.message,
      type: error.type,
      code: error.code
    });

    // Return fallback
    console.log('⚠️ [AI] Returning fallback content');
    return {
      title: `${strategies.length}-Audience SEO Strategy`,
      overview: `Reach ${strategies.length} high-value audience segments with one comprehensive SEO strategy. Maximize your market coverage and revenue potential across multiple customer profiles.`,
      audienceCount: strategies.length,
      strategies: strategies.map(s => {
        const targetSegment = typeof s.target_segment === 'string' ? JSON.parse(s.target_segment) : s.target_segment;
        return {
          audience: targetSegment?.demographics || 'Target audience',
          searchVolume: 0,
          profitLow: null,
          profitHigh: null
        };
      })
    };
  }
}

/**
 * Generate bundle overview with streaming (Phase 4). Emits overview-chunk then complete or error.
 */
async function generateBundleOverviewStream(strategies, connectionId) {
  const strategySummaries = strategies.map((strategy) => {
    const targetSegment = typeof strategy.target_segment === 'string'
      ? JSON.parse(strategy.target_segment)
      : strategy.target_segment;
    const demographics = targetSegment?.demographics || 'Unknown audience';
    const keywords = strategy.keywords || [];
    const totalSearchVolume = keywords.reduce((sum, kw) => sum + (kw.search_volume || 0), 0);
    const profitMatch = strategy.pitch?.match(/Profit of \$([0-9,]+)-\$([0-9,]+)/);
    const profitLow = profitMatch ? parseInt(profitMatch[1].replace(/,/g, ''), 10) : null;
    const profitHigh = profitMatch ? parseInt(profitMatch[2].replace(/,/g, ''), 10) : null;
    return {
      audience: demographics,
      searchVolume: totalSearchVolume,
      profitLow,
      profitHigh,
      customerProblem: strategy.customer_problem
    };
  });

  const prompt = `You are a strategic SEO consultant. Create a compelling, outcome-focused overview for a comprehensive SEO plan that targets multiple audience segments.

Here are the audience strategies included:
${strategySummaries.map((s, i) => `
${i + 1}. ${s.audience}
   - Monthly search volume: ${s.searchVolume.toLocaleString()}
   - Projected monthly profit: $${s.profitLow?.toLocaleString() || 'N/A'}-$${s.profitHigh?.toLocaleString() || 'N/A'}
   - Problem they're solving: ${s.customerProblem}
`).join('\n')}

Write a compelling 2-3 sentence overview that:
1. Describes the comprehensive strategy and how these audiences work together
2. Emphasizes the OUTCOMES (total traffic potential, revenue opportunity, market coverage)
3. Makes it clear this is a complete SEO solution, not just separate strategies

Format your response as JSON with these fields:
{
  "title": "Compelling title for the bundle (4-6 words)",
  "overview": "The compelling 2-3 sentence overview",
  "totalMonthlySearches": <total search volume across all audiences>,
  "projectedMonthlyProfit": { "low": <sum of all low profit projections>, "high": <sum of all high profit projections> },
  "audienceCount": ${strategies.length},
  "keyBenefits": ["benefit 1", "benefit 2", "benefit 3"]
}
Make it outcome-focused. Return only valid JSON.`;

  try {
    const stream = await getOpenAI().chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a strategic SEO consultant who writes compelling, outcome-focused marketing copy. Respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      stream: true
    });

    let fullContent = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        fullContent += delta;
        streamManager.publish(connectionId, 'overview-chunk', { content: delta });
      }
    }

    const result = JSON.parse(fullContent);
    result.strategies = strategySummaries;
    streamManager.publish(connectionId, 'complete', { result });
  } catch (error) {
    console.error('Bundle overview stream error:', error);
    streamManager.publish(connectionId, 'error', { error: error.message, errorCode: error.code ?? null });
  }
}

/**
 * GET /api/v1/strategies/bundle/calculate
 * Calculate bundle pricing for all user's strategies.
 * ?stream=true — returns 200 { connectionId, bundlePricing, bundleOverview? } and streams overview chunks via GET /api/v1/stream/:connectionId.
 */
router.get('/calculate',  async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    }

    // Get all user's strategies
    const result = await db.query(
      'SELECT * FROM audiences WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    const strategies = result.rows;

    if (strategies.length < 2) {
      return res.status(400).json({
        error: 'Insufficient strategies',
        message: 'Bundle requires at least 2 strategies. You currently have ' + strategies.length
      });
    }

    // Calculate bundle pricing (may use fallback for strategies without profit data)
    const bundlePricing = pricingCalculator.calculateAllStrategiesBundle(strategies);

    if (!bundlePricing) {
      return res.status(400).json({
        error: 'Could not calculate bundle pricing',
        message: 'Not enough strategies with valid profit data. Ensure audiences have pitch/profit fields from website analysis.'
      });
    }

    const streamRequested = req.query.stream === 'true';
    let connectionId = req.query.connectionId;

    if (streamRequested) {
      if (!connectionId || typeof connectionId !== 'string') {
        const { v4: uuidv4 } = await import('uuid');
        connectionId = uuidv4();
      }
      const baseUrl = req.protocol + '://' + (req.get('host') || '');
      const token = req.query?.token || req.headers?.authorization?.replace(/^Bearer\s+/i, '') || '';
      const streamUrl = token
        ? `${baseUrl}/api/v1/stream/${connectionId}?token=${encodeURIComponent(token)}`
        : `${baseUrl}/api/v1/stream/${connectionId}`;

      setImmediate(() => {
        generateBundleOverviewStream(strategies, connectionId).catch((err) =>
          console.error('bundle overview stream error:', err)
        );
      });

      return res.status(200).json({
        connectionId,
        streamUrl,
        bundlePricing,
        message: pricingCalculator.formatBundlePricingMessage(bundlePricing)
      });
    }

    // Non-streaming path (default)
    const bundleOverview = await generateBundleOverview(strategies);

    res.json({
      bundlePricing,
      bundleOverview,
      message: pricingCalculator.formatBundlePricingMessage(bundlePricing)
    });

  } catch (error) {
    console.error('Error calculating bundle pricing:', error);
    res.status(500).json({ error: 'Failed to calculate bundle pricing' });
  }
});

/**
 * POST /api/v1/strategies/bundle/subscribe
 * Create Stripe checkout session for bundle subscription
 */
router.post('/subscribe',  async (req, res) => {
  console.log('🎫 [BUNDLE] Subscribe request:', {
    userId: req.user?.userId,
    email: req.user?.email,
    billingInterval: req.body.billingInterval,
    hasAuth: !!req.user
  });

  try {
    const { billingInterval } = req.body; // 'monthly' or 'annual'
    const userId = req.user.userId;

    // Validate billing interval
    if (!['monthly', 'annual'].includes(billingInterval)) {
      return res.status(400).json({ error: 'Invalid billing interval. Must be "monthly" or "annual"' });
    }

    // Get all user's strategies
    const strategiesResult = await db.query(
      'SELECT * FROM audiences WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    const strategies = strategiesResult.rows;

    if (strategies.length < 2) {
      return res.status(400).json({
        error: 'Bundle requires at least 2 strategies',
        message: `You currently have ${strategies.length} strategy. Create at least one more to access bundle pricing.`
      });
    }

    // Calculate bundle pricing
    const bundlePricing = pricingCalculator.calculateAllStrategiesBundle(strategies);

    if (!bundlePricing) {
      return res.status(400).json({
        error: 'Could not calculate bundle pricing',
        message: 'Not enough strategies with valid profit data for bundle'
      });
    }

    // Check if user already has an active bundle subscription
    const existingBundle = await db.query(
      `SELECT * FROM bundle_subscriptions
       WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );

    if (existingBundle.rows.length > 0) {
      return res.status(400).json({
        error: 'Bundle subscription already exists',
        message: 'You already have an active bundle subscription. Cancel it first to create a new one.',
        existingBundle: existingBundle.rows[0]
      });
    }

    // Create dynamic Stripe price for bundle (on-the-fly)
    const amount = billingInterval === 'annual'
      ? bundlePricing.bundleAnnual
      : bundlePricing.bundleMonthly;

    console.log('💰 Creating bundle Stripe price:', {
      amount,
      billingInterval,
      strategyCount: bundlePricing.strategyCount,
      bundleMonthly: bundlePricing.bundleMonthly,
      bundleAnnual: bundlePricing.bundleAnnual
    });

    const bundlePrice = await getStripe().prices.create({
      unit_amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      recurring: {
        interval: billingInterval === 'annual' ? 'year' : 'month'
      },
      product_data: {
        name: `All Strategies Bundle (${bundlePricing.strategyCount} strategies)`,
        description: `Access to all ${bundlePricing.strategyCount} strategies with ${bundlePricing.postsPerStrategy.recommended}-${bundlePricing.postsPerStrategy.maximum} posts/month each`
      },
      metadata: {
        user_id: userId.toString(),
        bundle_type: 'all_strategies',
        strategy_count: bundlePricing.strategyCount.toString(),
        billing_interval: billingInterval,
        monthly_discount: bundlePricing.savings.monthlyDiscountPercent.toString(),
        annual_discount: bundlePricing.savings.annualDiscountPercent?.toString() || '0',
        total_discount: bundlePricing.savings.totalDiscountPercent.toString()
      }
    });

    console.log('✅ Bundle Stripe price created:', bundlePrice.id);

    // Create Checkout Session
    console.log('🛒 Creating Stripe checkout session...');
    const session = await getStripe().checkout.sessions.create({
      customer_email: req.user.email,
      line_items: [{
        price: bundlePrice.id,
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard?bundle_subscribed=true`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard?tab=audience`,
      metadata: {
        user_id: userId.toString(),
        is_bundle: 'true',
        strategy_count: bundlePricing.strategyCount.toString(),
        billing_interval: billingInterval,
        bundle_monthly_price: bundlePricing.bundleMonthly.toString(),
        bundle_annual_price: bundlePricing.bundleAnnual.toString(),
        individual_monthly_total: bundlePricing.individualMonthlyTotal.toString(),
        total_discount_percent: bundlePricing.savings.totalDiscountPercent.toString()
      }
    });

    console.log('✅ [BUNDLE] Checkout session created:', {
      sessionId: session.id,
      url: session.url
    });

    res.json({
      sessionId: session.id,
      url: session.url,
      bundlePricing
    });

  } catch (error) {
    console.error('❌ Error creating bundle subscription:', {
      message: error.message,
      type: error.type,
      code: error.code,
      statusCode: error.statusCode,
      stack: error.stack
    });

    // Return detailed error for debugging
    res.status(500).json({
      error: 'Failed to create bundle subscription',
      message: error.message,
      details: error.type || error.code || 'Unknown error'
    });
  }
});

/**
 * GET /api/v1/strategies/bundle
 * Get user's active bundle subscription
 */
router.get('/',  async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await db.query(
      `SELECT * FROM bundle_subscriptions
       WHERE user_id = $1 AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.json({ bundleSubscription: null });
    }

    const bundle = result.rows[0];

    // Get all strategy purchases linked to this bundle
    const strategiesResult = await db.query(
      `SELECT
        sp.*,
        a.id as strategy_id,
        a.pitch,
        a.target_segment,
        a.image_url,
        (SELECT json_agg(json_build_object('keyword', sk.keyword, 'searchVolume', sk.search_volume, 'competition', sk.competition, 'relevanceScore', sk.relevance_score))
         FROM seo_keywords sk WHERE sk.audience_id = a.id) as seo_keywords
      FROM strategy_purchases sp
      INNER JOIN audiences a ON sp.strategy_id = a.id
      WHERE sp.bundle_subscription_id = $1 AND sp.status = 'active'`,
      [bundle.id]
    );

    res.json({
      bundleSubscription: {
        id: bundle.id,
        strategyCount: bundle.strategy_count,
        billingInterval: bundle.billing_interval,
        bundleMonthlyPrice: parseFloat(bundle.bundle_monthly_price),
        bundleAnnualPrice: bundle.bundle_annual_price ? parseFloat(bundle.bundle_annual_price) : null,
        amountPaid: parseFloat(bundle.amount_paid),
        totalDiscountPercent: bundle.total_discount_percent ? parseFloat(bundle.total_discount_percent) : null,
        nextBillingDate: bundle.next_billing_date,
        createdAt: bundle.created_at,
        strategies: strategiesResult.rows.map(row => ({
          strategyId: row.strategy_id,
          postsRecommended: row.posts_recommended,
          postsMaximum: row.posts_maximum,
          postsUsed: row.posts_used,
          postsRemaining: row.posts_remaining,
          targetSegment: typeof row.target_segment === 'string' ? JSON.parse(row.target_segment) : row.target_segment,
          seoKeywords: row.seo_keywords,
          imageUrl: row.image_url
        }))
      }
    });

  } catch (error) {
    console.error('Error fetching bundle subscription:', error);
    res.status(500).json({ error: 'Failed to fetch bundle subscription' });
  }
});

/**
 * DELETE /api/v1/strategies/bundle
 * Cancel bundle subscription (via Stripe)
 */
router.delete('/',  async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get active bundle subscription
    const result = await db.query(
      `SELECT * FROM bundle_subscriptions
       WHERE user_id = $1 AND status = 'active'
       LIMIT 1`,
      [userId]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'No active bundle subscription found' });
    }

    const bundle = result.rows[0];

    // Cancel subscription in Stripe
    if (bundle.stripe_subscription_id) {
      await getStripe().subscriptions.cancel(bundle.stripe_subscription_id);
    }

    // Mark as cancelled in database (webhook will handle the actual update)
    await db.query(
      `UPDATE bundle_subscriptions
       SET status = 'cancelled', cancelled_at = NOW()
       WHERE id = $1`,
      [bundle.id]
    );

    // Also mark all linked strategy purchases as cancelled
    await db.query(
      `UPDATE strategy_purchases
       SET status = 'cancelled', cancelled_at = NOW()
       WHERE bundle_subscription_id = $1`,
      [bundle.id]
    );

    res.json({
      success: true,
      message: 'Bundle subscription cancelled successfully'
    });

  } catch (error) {
    console.error('Error cancelling bundle subscription:', error);
    res.status(500).json({ error: 'Failed to cancel bundle subscription' });
  }
});

export default router;
