/**
 * Pricing Calculator Service
 *
 * Calculates dynamic profit-based pricing for audience strategies
 * using a sliding percentage scale (10% → 8%) based on projected monthly profit.
 *
 * Formula: monthlyPrice = Max($39.99, projectedProfit × dynamicPercentage)
 * Where: dynamicPercentage = 8% + (2% × (1000 / (profit + 1000)))
 *
 * Floor: $39.99/month (ensures 80%+ margins)
 * Ceiling: $150/month (keeps pricing accessible)
 * Post quotas: 8 recommended, 40 maximum
 */

const FLOOR_PRICE = 39.99;
const MAX_PRICE = 150;
const FLOOR_PROFIT = 500;
const ESTIMATED_COST_PER_MONTH = 8;
const POSTS_RECOMMENDED = 8;
const POSTS_MAXIMUM = 40;

/** Extract low/high profit from strategy (DB fields first, then pitch regex). Returns null if none valid. */
function extractProfitRange(strategy) {
  const hasDbFields = strategy.projected_profit_low != null && strategy.projected_profit_high != null;
  if (hasDbFields) {
    const low = parseInt(strategy.projected_profit_low, 10);
    const high = parseInt(strategy.projected_profit_high, 10);
    if (!isNaN(low) && !isNaN(high)) {
      console.log('✅ Using database profit fields:', { lowEndProfit: low, highEndProfit: high });
      return { low, high };
    }
  }

  if (!strategy.pitch) return null;
  const step5Match = strategy.pitch.match(
    /Step 5:[^\$]*(?:Profit|profit)\s+of\s*\$([0-9,]+)-\$([0-9,]+)\s*(?:\/month|\/mo|monthly)/i
  );
  const genericMatch = strategy.pitch.match(/\$([0-9,]+)-\$([0-9,]+)\s*(?:monthly|\/month|\/mo)/i);
  const match = step5Match || genericMatch;
  if (!match) return null;
  const low = parseInt(match[1].replace(/,/g, ''), 10);
  const high = parseInt(match[2].replace(/,/g, ''), 10);
  if (isNaN(low) || isNaN(high)) return null;
  return { low, high };
}

/** Dynamic percentage 8% + (2% × (1000 / (profit + 1000))). Slides from ~10% toward 8% as profit grows. */
function computeDynamicPercentage(lowProfit) {
  return 0.08 + (0.02 * (1000 / (lowProfit + 1000)));
}

/** Raw monthly price from profit and percentage, then apply floor and ceiling. */
function applyFloorAndCeiling(rawMonthly) {
  const withFloor = Math.max(FLOOR_PRICE, rawMonthly);
  const rounded = Math.round(withFloor * 100) / 100;
  return Math.min(rounded, MAX_PRICE);
}

class PricingCalculator {
  /**
   * Calculate profit-based pricing for a strategy
   * @param {Object} strategy - Strategy object with pitch
   * @returns {Object|null} Pricing data or null if extraction fails
   */
  calculateProfitBasedPrice(strategy) {
    try {
      let range = extractProfitRange(strategy);
      const noValidRange = range == null;
      if (noValidRange) {
        range = { low: FLOOR_PROFIT, high: FLOOR_PROFIT * 2 };
      }

      const lowEndProfit = range.low;
      const highEndProfit = range.high;
      const dynamicPercentage = computeDynamicPercentage(lowEndProfit);
      const rawMonthly = lowEndProfit * dynamicPercentage;
      const monthlyPrice = applyFloorAndCeiling(rawMonthly);

      const annualPrice = Math.round(monthlyPrice * 12 * 0.90 * 100) / 100;
      const postsPerMonth = { recommended: POSTS_RECOMMENDED, maximum: POSTS_MAXIMUM };
      const ourProfit = monthlyPrice - ESTIMATED_COST_PER_MONTH;
      const marginPercent = Math.round((ourProfit / monthlyPrice) * 100);

      return {
        monthly: monthlyPrice,
        annual: annualPrice,
        posts: postsPerMonth,
        projectedLow: lowEndProfit,
        projectedHigh: highEndProfit,
        percentage: {
          monthly: Math.round(dynamicPercentage * 100 * 100) / 100
        },
        savings: {
          annualMonthlyEquivalent: Math.round(annualPrice / 12 * 100) / 100,
          annualSavingsPercent: 10,
          annualSavingsDollars: Math.round((monthlyPrice * 12 - annualPrice) * 100) / 100
        },
        _internal: {
          costToDeliver: ESTIMATED_COST_PER_MONTH,
          profitMargin: Math.round(ourProfit * 100) / 100,
          marginPercent
        }
      };
    } catch (error) {
      console.error('Error calculating profit-based price:', error);
      return null;
    }
  }

  /**
   * Calculate bundle pricing for all strategies
   * @param {Array} userStrategies - Array of user's strategies
   * @returns {Object|null} Bundle pricing data or null if insufficient strategies
   */
  calculateAllStrategiesBundle(userStrategies) {
    try {
      if (!userStrategies || userStrategies.length < 2) {
        console.warn('Bundle requires at least 2 strategies');
        return null;
      }

      // Step 1: Calculate individual pricing for each strategy
      const strategyPrices = userStrategies
        .map(strategy => {
          const pricing = this.calculateProfitBasedPrice(strategy);
          if (!pricing) return null;

          return {
            strategyId: strategy.id,
            monthly: pricing.monthly,
            annual: pricing.annual,
            posts: pricing.posts,
            projectedLow: pricing.projectedLow,
            projectedHigh: pricing.projectedHigh
          };
        })
        .filter(p => p !== null); // Remove strategies without valid pricing

      if (strategyPrices.length < 2) {
        console.warn('Not enough strategies with valid pricing for bundle');
        return null;
      }

      // Step 2: Sum all individual monthly prices
      const totalMonthly = strategyPrices.reduce((sum, s) => sum + s.monthly, 0);

      // Step 3: Apply 10% bundle discount
      const bundleMonthly = Math.round(totalMonthly * 0.90 * 100) / 100;

      // Step 4: Annual bundle with stacking discounts (10% bundle + 10% annual = 19% total)
      const bundleAnnual = Math.round(bundleMonthly * 12 * 0.90 * 100) / 100;

      // Step 5: Total compound discount calculation
      const totalDiscount = 1 - (bundleAnnual / (totalMonthly * 12));
      const totalDiscountPercent = Math.round(totalDiscount * 100);

      return {
        strategyCount: strategyPrices.length,
        strategies: strategyPrices,
        individualMonthlyTotal: Math.round(totalMonthly * 100) / 100,
        bundleMonthly: bundleMonthly,
        bundleAnnual: bundleAnnual,
        savings: {
          monthlyDiscount: Math.round((totalMonthly - bundleMonthly) * 100) / 100,
          monthlyDiscountPercent: 10,
          annualDiscount: Math.round((bundleMonthly * 12 - bundleAnnual) * 100) / 100,
          annualDiscountPercent: 10,
          totalAnnualSavings: Math.round((totalMonthly * 12 - bundleAnnual) * 100) / 100,
          totalDiscountPercent: totalDiscountPercent, // ~19%
          effectiveMonthlyRate: Math.round(bundleAnnual / 12 * 100) / 100
        },
        postsPerStrategy: {
          recommended: 8,
          maximum: 40
        }
      };
    } catch (error) {
      console.error('Error calculating bundle pricing:', error);
      return null;
    }
  }

  /**
   * Format pricing for display
   * @param {Object} pricing - Pricing data
   * @returns {string} Formatted pricing message
   */
  formatPricingMessage(pricing) {
    if (!pricing) return '';

    return `Projected Profit: $${pricing.projectedLow.toLocaleString()}-$${pricing.projectedHigh.toLocaleString()}/month. ` +
           `Subscribe for $${pricing.monthly}/month (${pricing.percentage.monthly}% of your projected profit). ` +
           `Get ${pricing.posts.recommended} posts/month recommended (up to ${pricing.posts.maximum} available). ` +
           `Pay annually and save $${pricing.savings.annualSavingsDollars}.`;
  }

  /**
   * Format bundle pricing for display
   * @param {Object} bundlePricing - Bundle pricing data
   * @returns {string} Formatted bundle pricing message
   */
  formatBundlePricingMessage(bundlePricing) {
    if (!bundlePricing) return '';

    return `Access ALL ${bundlePricing.strategyCount} strategies for $${bundlePricing.bundleMonthly}/month (10% off individual prices). ` +
           `Pay annually for $${bundlePricing.bundleAnnual}/year and save ${bundlePricing.savings.totalDiscountPercent}% ` +
           `($${bundlePricing.savings.totalAnnualSavings} total savings).`;
  }
}

// Export singleton instance
export default new PricingCalculator();
