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

class PricingCalculator {
  /**
   * Calculate profit-based pricing for a strategy
   * @param {Object} strategy - Strategy object with pitch
   * @returns {Object|null} Pricing data or null if extraction fails
   */
  calculateProfitBasedPrice(strategy) {
    try {
      let lowEndProfit, highEndProfit;

      // PRIORITY 1: Use database fields if available
      if (strategy.projected_profit_low && strategy.projected_profit_high) {
        lowEndProfit = parseInt(strategy.projected_profit_low, 10);
        highEndProfit = parseInt(strategy.projected_profit_high, 10);
        console.log('✅ Using database profit fields:', { lowEndProfit, highEndProfit });
      } else {
        // FALLBACK: Extract from pitch text
        const { pitch } = strategy;

        if (!pitch) {
          console.warn('No pitch or profit fields provided for pricing calculation');
          return null;
        }

        // Extract projected monthly profit from pitch (Step 5)
        // Expected format: "Step 5: Profit of $X-$Y monthly ($A-$B revenue, Z% margin..."
        const profitMatch = pitch.match(
          /Step 5:[^\$]*(?:Profit|profit)\s+of\s*\$([0-9,]+)-\$([0-9,]+)\s*(?:\/month|\/mo|monthly)/i
        );

        if (!profitMatch) {
          console.warn('Could not extract profit from pitch Step 5:', pitch.substring(0, 200));
          return null;
        }

        lowEndProfit = parseInt(profitMatch[1].replace(/,/g, ''), 10);
        highEndProfit = parseInt(profitMatch[2].replace(/,/g, ''), 10);
        console.log('⚠️ Extracted profit from pitch text (consider running backfill):', { lowEndProfit, highEndProfit });
      }

      if (isNaN(lowEndProfit) || isNaN(highEndProfit)) {
        console.warn('Invalid profit values:', { lowEndProfit, highEndProfit });
        return null;
      }

      // Calculate dynamic percentage that slides from 10% to 8%
      // Formula: 8% + (2% × (1000 / (profit + 1000)))
      // Examples:
      //   $500 profit  → 9.33%
      //   $1,000 profit → 9.0%
      //   $2,000 profit → 8.67%
      //   $5,000 profit → 8.33%
      //   $10,000 profit → 8.18%
      const dynamicPercentage = 0.08 + (0.02 * (1000 / (lowEndProfit + 1000)));

      // Calculate price based on profit with floor and ceiling
      const FLOOR_PRICE = 39.99;  // Minimum to ensure healthy margins (80%+)
      const MAX_PRICE = 150;      // Maximum to keep accessible

      let monthlyPrice = Math.max(
        FLOOR_PRICE,
        lowEndProfit * dynamicPercentage
      );

      // Round to nearest cent
      monthlyPrice = Math.round(monthlyPrice * 100) / 100;

      // Apply ceiling
      monthlyPrice = Math.min(monthlyPrice, MAX_PRICE);

      // Calculate annual price with 10% discount
      const annualPrice = Math.round(monthlyPrice * 12 * 0.90 * 100) / 100;

      // Post limits: 8 recommended (2/week for quality SEO), 40 maximum
      const postsPerMonth = {
        recommended: 8,
        maximum: 40
      };

      // Calculate margin for transparency (based on recommended usage)
      const estimatedCostPerMonth = 8; // ~$1/post for 8 recommended posts
      const ourProfit = monthlyPrice - estimatedCostPerMonth;
      const marginPercent = Math.round((ourProfit / monthlyPrice) * 100);

      return {
        monthly: monthlyPrice,
        annual: annualPrice,
        posts: postsPerMonth,
        projectedLow: lowEndProfit,
        projectedHigh: highEndProfit,
        percentage: {
          monthly: Math.round(dynamicPercentage * 100 * 100) / 100 // e.g., 9.0
        },
        savings: {
          annualMonthlyEquivalent: Math.round(annualPrice / 12 * 100) / 100,
          annualSavingsPercent: 10,
          annualSavingsDollars: Math.round((monthlyPrice * 12 - annualPrice) * 100) / 100
        },
        // Internal margin tracking (not exposed to frontend)
        _internal: {
          costToDeliver: estimatedCostPerMonth,
          profitMargin: Math.round(ourProfit * 100) / 100,
          marginPercent: marginPercent
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
