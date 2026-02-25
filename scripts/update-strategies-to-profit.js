import db from '../services/database.js';

/**
 * Updates existing audience strategies from revenue-based to profit-based format
 * Converts "Step 5: Revenue of $X-$Y" to "Step 5: Profit of $X-$Y (revenue, margin)"
 */
async function updateStrategiesToProfit() {
  const userId = '404b404d-de79-4082-a052-7ab51428d50c';

  try {
    // Get all strategies for this user
    const result = await db.query(
      'SELECT id, pitch FROM audiences WHERE user_id = $1 AND pitch IS NOT NULL',
      [userId]
    );

    const strategies = result.rows;
    console.log(`Found ${strategies.length} strategies to update`);

    let updatedCount = 0;

    for (const strategy of strategies) {
      const { id, pitch } = strategy;

      // Check if already has profit format
      if (pitch.includes('Profit of $')) {
        console.log(`Strategy ${id}: Already has profit format, skipping`);
        continue;
      }

      // Extract revenue from Step 5
      const revenueMatch = pitch.match(/Step 5:[^\$]*\$([0-9,]+)-\$([0-9,]+)(?:\/month|\/mo| monthly)?/i);

      if (!revenueMatch) {
        console.log(`Strategy ${id}: No revenue found in Step 5, skipping`);
        continue;
      }

      const lowRevenue = parseInt(revenueMatch[1].replace(/,/g, ''));
      const highRevenue = parseInt(revenueMatch[2].replace(/,/g, ''));

      // Determine business type from pitch content
      let profitMargin = 0.75; // Default to 75%
      let businessType = 'professional services';

      if (pitch.toLowerCase().includes('therapy') || pitch.toLowerCase().includes('coaching') || pitch.toLowerCase().includes('consulting')) {
        profitMargin = 0.80;
        businessType = 'therapy/consulting';
      } else if (pitch.toLowerCase().includes('course') || pitch.toLowerCase().includes('digital')) {
        profitMargin = 0.90;
        businessType = 'digital products';
      } else if (pitch.toLowerCase().includes('product') || pitch.toLowerCase().includes('ecommerce')) {
        profitMargin = 0.40;
        businessType = 'physical products';
      }

      // Calculate profit
      const lowProfit = Math.round(lowRevenue * profitMargin);
      const highProfit = Math.round(highRevenue * profitMargin);
      const marginPercent = Math.round(profitMargin * 100);

      // Extract price per consultation if available
      const priceMatch = pitch.match(/\$([0-9,]+)\/consultation|at \$([0-9,]+)/);
      const pricePerUnit = priceMatch ? priceMatch[1] || priceMatch[2] : '500';

      // Create new Step 5 text
      const oldStep5Pattern = /Step 5:[^\n]*/;
      const newStep5 = `Step 5: Profit of $${lowProfit.toLocaleString()}-$${highProfit.toLocaleString()} monthly ($${lowRevenue.toLocaleString()}-$${highRevenue.toLocaleString()} revenue, ${marginPercent}% margin at $${pricePerUnit}/consultation)`;

      // Replace Step 5 in pitch
      const updatedPitch = pitch.replace(oldStep5Pattern, newStep5);

      // Update in database
      await db.query(
        'UPDATE audiences SET pitch = $1, updated_at = NOW() WHERE id = $2',
        [updatedPitch, id]
      );

      console.log(`Strategy ${id}: Updated to profit format`);
      console.log(`  Business type: ${businessType} (${marginPercent}% margin)`);
      console.log(`  Revenue: $${lowRevenue.toLocaleString()}-$${highRevenue.toLocaleString()}`);
      console.log(`  Profit: $${lowProfit.toLocaleString()}-$${highProfit.toLocaleString()}`);
      updatedCount++;
    }

    console.log(`\n✅ Updated ${updatedCount} strategies to profit format`);
    process.exit(0);

  } catch (error) {
    console.error('❌ Error updating strategies:', error);
    process.exit(1);
  }
}

updateStrategiesToProfit();
