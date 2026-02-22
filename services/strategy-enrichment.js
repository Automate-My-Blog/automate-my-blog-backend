import db from './database.js';

/**
 * Enrich strategy data by aggregating keyword metrics and calculating ROI
 * @param {Object} strategyData - Raw strategy data from audiences table
 * @returns {Object} Enriched strategy with aggregated metrics
 */
export async function enrichStrategyData(strategyData) {
  // Parse business_value JSONB (now contains structured numeric data!)
  let businessValue = {};
  try {
    businessValue = typeof strategyData.business_value === 'string'
      ? JSON.parse(strategyData.business_value)
      : (strategyData.business_value || {});
  } catch (e) {
    console.warn('Failed to parse business_value:', e);
  }

  // Extract structured numeric fields (handles both new numeric format and old text format)
  const searchVolume = businessValue.searchVolumeNumeric || 0;
  const searchVolumeLabel = businessValue.searchVolumeLabel || 'Unknown';
  const competitionLevel = businessValue.competitionLevel || businessValue.competition || 'unknown';
  const conversionPotential = businessValue.conversionPotential || 0.18; // Default 18%
  const dataConfidence = businessValue.dataConfidence || 'unknown';

  // Aggregate keywords from seo_keywords table
  const keywordStats = await aggregateKeywordStats(strategyData.id);

  // Use aggregated data if available, otherwise fall back to business_value
  const finalSearchVolume = keywordStats.totalSearchVolume > 0
    ? keywordStats.totalSearchVolume
    : searchVolume;

  // Parse profit ranges
  const profitLow = strategyData.projected_profit_low || 500;
  const profitHigh = strategyData.projected_profit_high || 2000;

  // Calculate derived metrics
  const estimatedCTR = 0.025; // 2.5% industry average
  const conversionRate = typeof conversionPotential === 'number' && conversionPotential <= 1
    ? conversionPotential
    : 0.18; // Use LLM estimate or 18% default
  const estimatedLeadsPerMonth = Math.round(finalSearchVolume * estimatedCTR * conversionRate);
  const projectedCAC = profitLow > 0 ? Math.round(profitLow / 10) : 50;

  // Parse target segment for demographics
  let targetSegment = {};
  try {
    targetSegment = typeof strategyData.target_segment === 'string'
      ? JSON.parse(strategyData.target_segment)
      : (strategyData.target_segment || {});
  } catch (e) {
    console.warn('Failed to parse target_segment:', e);
  }

  const demographics = targetSegment.demographics || 'Unknown audience';
  const customerProblem = strategyData.customer_problem || 'Unknown problem';

  // Build unique positioning angle
  const uniqueAngle = `Content strategy for ${demographics} addressing ${customerProblem}`;

  return {
    ...strategyData,
    enrichedData: {
      // Search metrics (numeric, no parsing!)
      searchVolume: finalSearchVolume,
      searchVolumeLabel: searchVolumeLabel,
      dataConfidence: dataConfidence,

      // Competition data (normalized)
      competitionLevel: competitionLevel.toLowerCase(),
      competitionLabel: formatCompetitionLabel(competitionLevel),

      // Keyword insights
      keywordCount: keywordStats.count,
      topKeywords: keywordStats.topKeywords.slice(0, 5).map(k => k.keyword),
      hasVerifiedKeywords: keywordStats.count > 0,
      lowCompetitionCount: keywordStats.lowCompCount,
      mediumCompetitionCount: keywordStats.mediumCompCount,
      highCompetitionCount: keywordStats.highCompCount,

      // Strategic positioning
      demographics: demographics,
      customerProblem: customerProblem,
      uniqueAngle: uniqueAngle,

      // ROI calculations
      estimatedCTR: estimatedCTR,
      conversionPotential: conversionRate,
      estimatedLeadsPerMonth: estimatedLeadsPerMonth,
      projectedCAC: projectedCAC,
      profitRangeLow: profitLow,
      profitRangeHigh: profitHigh,
      roiMultipleLow: Math.round(profitLow / (strategyData.pricing_monthly || 39.99)),
      roiMultipleHigh: Math.round(profitHigh / (strategyData.pricing_monthly || 39.99)),
    }
  };
}

/**
 * Aggregate keyword statistics from seo_keywords table
 */
async function aggregateKeywordStats(audienceId) {
  const result = await db.query(`
    SELECT
      SUM(search_volume) as total_search_volume,
      COUNT(*) as keyword_count,
      COUNT(CASE WHEN competition = 'low' THEN 1 END) as low_comp_count,
      COUNT(CASE WHEN competition = 'medium' THEN 1 END) as medium_comp_count,
      COUNT(CASE WHEN competition = 'high' THEN 1 END) as high_comp_count,
      json_agg(
        json_build_object(
          'keyword', keyword,
          'volume', search_volume,
          'competition', competition,
          'relevanceScore', relevance_score
        )
        ORDER BY search_volume DESC NULLS LAST
      ) FILTER (WHERE keyword IS NOT NULL) as keywords_data
    FROM seo_keywords
    WHERE audience_id = $1
  `, [audienceId]);

  const stats = result.rows[0];

  return {
    totalSearchVolume: parseInt(stats?.total_search_volume) || 0,
    count: parseInt(stats?.keyword_count) || 0,
    lowCompCount: parseInt(stats?.low_comp_count) || 0,
    mediumCompCount: parseInt(stats?.medium_comp_count) || 0,
    highCompCount: parseInt(stats?.high_comp_count) || 0,
    topKeywords: stats?.keywords_data || []
  };
}

/**
 * Format competition level for display
 */
function formatCompetitionLabel(level) {
  const normalized = String(level).toLowerCase();
  const labels = {
    low: 'Low competition',
    medium: 'Medium competition',
    high: 'High competition'
  };
  return labels[normalized] || 'Unknown competition';
}

export default {
  enrichStrategyData
};
