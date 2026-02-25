import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Generate outcome-focused bundle overview using OpenAI
 */
async function generateBundleOverview(strategies) {
  console.log(`🎯 Generating bundle overview for ${strategies.length} strategies...`);

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

    console.log('📤 Sending request to OpenAI GPT-4o...');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a strategic SEO consultant who writes compelling, outcome-focused marketing copy.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7
    });

    const result = JSON.parse(completion.choices[0].message.content);

    // Add the strategy summaries for display
    result.strategies = strategySummaries;
    result.isAIGenerated = true; // Flag indicating this is AI-generated content

    console.log('✅ Successfully generated AI bundle overview:', {
      hasOverview: !!result.overview,
      totalSearches: result.totalMonthlySearches,
      profitRange: result.projectedMonthlyProfit,
      benefitsCount: result.keyBenefits?.length
    });

    return result;
  } catch (error) {
    console.error('❌ Error generating bundle overview:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });

    // Calculate totals for fallback
    const strategySummaries = strategies.map((strategy) => {
      const targetSegment = typeof strategy.target_segment === 'string'
        ? JSON.parse(strategy.target_segment)
        : strategy.target_segment;

      const keywords = strategy.keywords || [];
      const totalSearchVolume = keywords.reduce((sum, kw) => {
        return sum + (kw.search_volume || 0);
      }, 0);

      const profitMatch = strategy.pitch?.match(/Profit of \$([0-9,]+)-\$([0-9,]+)/);
      const profitLow = profitMatch ? parseInt(profitMatch[1].replace(/,/g, '')) : null;
      const profitHigh = profitMatch ? parseInt(profitMatch[2].replace(/,/g, '')) : null;

      return {
        audience: targetSegment?.demographics || 'Target audience',
        searchVolume: totalSearchVolume,
        profitLow,
        profitHigh,
        customerProblem: strategy.customer_problem
      };
    });

    const totalSearchVolume = strategySummaries.reduce((sum, s) => sum + s.searchVolume, 0);
    const totalProfitLow = strategySummaries.reduce((sum, s) => sum + (s.profitLow || 0), 0);
    const totalProfitHigh = strategySummaries.reduce((sum, s) => sum + (s.profitHigh || 0), 0);

    // Return complete fallback with all required fields
    const fallback = {
      overview: `Reach ${strategies.length} high-value audience segments with one comprehensive SEO strategy. Maximize your market coverage and revenue potential across multiple customer profiles.`,
      totalMonthlySearches: totalSearchVolume,
      projectedMonthlyProfit: {
        low: totalProfitLow,
        high: totalProfitHigh
      },
      audienceCount: strategies.length,
      keyBenefits: [
        `${strategies.length} targeted audience segments`,
        `${totalSearchVolume.toLocaleString()} monthly searches`,
        `Complete market coverage`
      ],
      strategies: strategySummaries,
      isAIGenerated: false // Flag indicating this is fallback content
    };

    console.log('⚠️ Using fallback bundle overview:', fallback);
    return fallback;
  }
}

// Test with sample strategies
const testStrategies = [
  {
    target_segment: {
      demographics: 'Small business owners aged 30-50',
      psychographics: 'Value efficiency and growth',
      searchBehavior: 'Search for automation tools'
    },
    keywords: [
      { keyword: 'business automation software', search_volume: 12000 },
      { keyword: 'workflow automation', search_volume: 8500 }
    ],
    customer_problem: 'Need to automate repetitive tasks to focus on growth',
    pitch: 'Target small business owners seeking efficiency. Profit of $2,500-$5,000 monthly from automation tool sales.'
  },
  {
    target_segment: {
      demographics: 'Marketing managers at mid-size companies',
      psychographics: 'Data-driven, ROI-focused',
      searchBehavior: 'Research marketing analytics tools'
    },
    keywords: [
      { keyword: 'marketing analytics platform', search_volume: 15000 },
      { keyword: 'campaign performance tracking', search_volume: 6500 }
    ],
    customer_problem: 'Struggling to measure and optimize marketing ROI',
    pitch: 'Target marketing managers seeking better analytics. Profit of $3,500-$7,500 monthly from subscription services.'
  },
  {
    target_segment: {
      demographics: 'Enterprise CTOs and technical leaders',
      psychographics: 'Innovation-focused, risk-aware',
      searchBehavior: 'Evaluate enterprise solutions'
    },
    keywords: [
      { keyword: 'enterprise automation platform', search_volume: 8000 },
      { keyword: 'scalable business solutions', search_volume: 5200 }
    ],
    customer_problem: 'Need scalable solutions for complex enterprise workflows',
    pitch: 'Target enterprise leaders seeking scalable platforms. Profit of $8,000-$15,000 monthly from enterprise contracts.'
  }
];

console.log('\n🧪 Testing Bundle Overview Generation\n');
console.log('=' .repeat(60));
console.log(`Testing with ${testStrategies.length} sample strategies`);
console.log('=' .repeat(60) + '\n');

generateBundleOverview(testStrategies)
  .then(result => {
    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL RESULT');
    console.log('='.repeat(60));
    console.log('\n📝 Overview:');
    console.log(result.overview);
    console.log('\n📈 Metrics:');
    console.log(`  - Total Monthly Searches: ${result.totalMonthlySearches?.toLocaleString() || 'N/A'}`);
    console.log(`  - Projected Monthly Profit: $${result.projectedMonthlyProfit?.low?.toLocaleString() || 'N/A'} - $${result.projectedMonthlyProfit?.high?.toLocaleString() || 'N/A'}`);
    console.log(`  - Audience Count: ${result.audienceCount}`);
    console.log(`  - AI Generated: ${result.isAIGenerated ? '✅ Yes' : '⚠️ No (Fallback)'}`);
    console.log('\n🎯 Key Benefits:');
    result.keyBenefits?.forEach((benefit, idx) => {
      console.log(`  ${idx + 1}. ${benefit}`);
    });
    console.log('\n' + '='.repeat(60));
    console.log('✅ Test completed successfully!\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });
