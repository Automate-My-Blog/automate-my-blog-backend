import db from '../services/database.js';

async function updateStrategyPitch() {
  const pitch = `Step 1: The "Tech Startup CEOs and CFOs" audience represents founders and financial leaders of high-growth tech companies aged 30-50. They search for "operational consulting for startups", "CFO advisory services", and "scaling best practices". With 8,000 monthly searches and a niche high-value market, this audience shows strong commercial intent.

Step 2: They are searching for operational guidance, financial planning strategies, systems to scale efficiently, and expert mentorship from those who've successfully scaled tech companies before.

Step 3: When they find the right consultant, they typically engage for 6-12 month retainers at $8,000-$15,000/month. The average engagement lasts 9 months with high retention due to the critical nature of scaling operations correctly.

Step 4: They convert at 25% from initial consultation to paid engagement because they're actively seeking expert guidance, have budget allocated for consulting, and understand the ROI of getting operations right during high-growth phases.

Step 5: Profit of $20,000-$45,000 monthly ($25,000-$56,250 revenue, 80% margin at $12,500/month average, accounting for 2-4.5 new clients monthly with 25% conversion from 8-18 consultations)

Step 6: The business model works because tech startups in growth mode have significant funding and understand that operational excellence drives valuation. The 80% profit margin reflects the expertise-based consulting model with minimal overhead. Positioning as a former successful tech executive creates strong credibility and premium pricing power.`;

  const result = await db.query(
    'UPDATE audiences SET pitch = $1 WHERE id = $2 RETURNING id',
    [pitch, 'a94f299b-d166-4481-8a7d-730d6cafb22d']
  );

  console.log('✅ Strategy updated with profit-based pitch!');
  console.log('Strategy ID:', result.rows[0].id);
  console.log('\nTest pricing API:');
  console.log(`curl -s "http://localhost:3001/api/v1/strategies/${result.rows[0].id}/pricing" -H "Authorization: Bearer YOUR_TOKEN" | jq '.'`);

  process.exit(0);
}

updateStrategyPitch().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
