import db from '../services/database.js';

/**
 * Backfill profit metrics from pitch text to database fields
 * Extracts revenue, profit, margin, and price from Step 5 of existing pitches
 */
async function backfillProfitMetrics() {
  try {
    // Get all strategies with pitches but no profit metrics
    const result = await db.query(`
      SELECT id, pitch
      FROM audiences
      WHERE pitch IS NOT NULL
        AND projected_profit_low IS NULL
      ORDER BY created_at DESC
    `);

    const strategies = result.rows;
    console.log(`\n📊 Found ${strategies.length} strategies to backfill\n`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const strategy of strategies) {
      const { id, pitch } = strategy;

      console.log(`\n🔍 Processing strategy ${id}...`);

      // Extract profit from Step 5
      const profitMatch = pitch.match(
        /Step 5:[^\$]*(?:Profit|profit)\s+of\s*\$([0-9,]+)-\$([0-9,]+)\s*(?:\/month|\/mo|monthly)/i
      );

      if (!profitMatch) {
        console.log(`  ⚠️  No profit found, checking for revenue format...`);

        // Try to extract revenue instead
        const revenueMatch = pitch.match(
          /Step 5:[^\$]*\$([0-9,]+)-\$([0-9,]+)\s*(?:\/month|\/mo|monthly)?/i
        );

        if (!revenueMatch) {
          console.log(`  ❌ Could not extract revenue or profit, skipping`);
          skippedCount++;
          continue;
        }

        // Parse revenue values
        const lowRevenue = parseInt(revenueMatch[1].replace(/,/g, ''), 10);
        const highRevenue = parseInt(revenueMatch[2].replace(/,/g, ''), 10);

        // Determine margin based on business type
        let margin = 75; // default
        if (pitch.toLowerCase().includes('therapy') ||
            pitch.toLowerCase().includes('coaching') ||
            pitch.toLowerCase().includes('consulting')) {
          margin = 80;
        } else if (pitch.toLowerCase().includes('course') ||
                   pitch.toLowerCase().includes('digital')) {
          margin = 90;
        } else if (pitch.toLowerCase().includes('product') ||
                   pitch.toLowerCase().includes('ecommerce')) {
          margin = 40;
        }

        const lowProfit = Math.round(lowRevenue * (margin / 100));
        const highProfit = Math.round(highRevenue * (margin / 100));

        console.log(`  💰 Calculated from revenue: $${lowRevenue}-$${highRevenue} → $${lowProfit}-$${highProfit} (${margin}% margin)`);

        // Extract price per unit
        const priceMatch = pitch.match(/\$([0-9,]+)\/(?:consultation|session|product|unit)/i);
        const pricePerUnit = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;

        // Update database
        await db.query(`
          UPDATE audiences
          SET projected_revenue_low = $1,
              projected_revenue_high = $2,
              projected_profit_low = $3,
              projected_profit_high = $4,
              profit_margin_percent = $5,
              price_per_unit = $6,
              unit_type = 'consultation',
              updated_at = NOW()
          WHERE id = $7
        `, [lowRevenue, highRevenue, lowProfit, highProfit, margin, pricePerUnit, id]);

        console.log(`  ✅ Updated with calculated metrics`);
        updatedCount++;
        continue;
      }

      // Parse profit values
      const lowProfit = parseInt(profitMatch[1].replace(/,/g, ''), 10);
      const highProfit = parseInt(profitMatch[2].replace(/,/g, ''), 10);

      console.log(`  💰 Profit: $${lowProfit.toLocaleString()}-$${highProfit.toLocaleString()}`);

      // Extract revenue from the same Step 5 line
      const revenueMatch = pitch.match(
        /\$([0-9,]+)-\$([0-9,]+)\s+revenue/i
      );

      let lowRevenue = null;
      let highRevenue = null;

      if (revenueMatch) {
        lowRevenue = parseInt(revenueMatch[1].replace(/,/g, ''), 10);
        highRevenue = parseInt(revenueMatch[2].replace(/,/g, ''), 10);
        console.log(`  📊 Revenue: $${lowRevenue.toLocaleString()}-$${highRevenue.toLocaleString()}`);
      }

      // Extract margin
      const marginMatch = pitch.match(/(\d+)%\s+margin/i);
      const margin = marginMatch ? parseFloat(marginMatch[1]) : null;

      if (margin) {
        console.log(`  📈 Margin: ${margin}%`);
      }

      // Extract price per unit
      const priceMatch = pitch.match(/\$([0-9,]+)\/(?:consultation|session|product|unit)/i);
      const pricePerUnit = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;

      if (pricePerUnit) {
        console.log(`  💵 Price per unit: $${pricePerUnit}`);
      }

      // Determine unit type
      let unitType = 'consultation';
      if (pitch.toLowerCase().includes('session')) {
        unitType = 'session';
      } else if (pitch.toLowerCase().includes('product')) {
        unitType = 'product';
      }

      // Update database
      await db.query(`
        UPDATE audiences
        SET projected_revenue_low = $1,
            projected_revenue_high = $2,
            projected_profit_low = $3,
            projected_profit_high = $4,
            profit_margin_percent = $5,
            price_per_unit = $6,
            unit_type = $7,
            updated_at = NOW()
        WHERE id = $8
      `, [lowRevenue, highRevenue, lowProfit, highProfit, margin, pricePerUnit, unitType, id]);

      console.log(`  ✅ Updated database fields`);
      updatedCount++;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Backfill complete!`);
    console.log(`   Updated: ${updatedCount} strategies`);
    console.log(`   Skipped: ${skippedCount} strategies`);
    console.log(`${'='.repeat(60)}\n`);

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error during backfill:', error);
    process.exit(1);
  }
}

backfillProfitMetrics();
