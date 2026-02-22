import db from '../services/database.js';

async function createSecondStrategy() {
  const userId = '404b404d-de79-4082-a052-7ab51428d50c';

  const pitch = `Step 1: The "Postpartum Depression Support" audience consists of first-time mothers aged 25-35 experiencing postpartum depression. They search for "postpartum depression treatment", "maternal mental health therapist", and "new mom therapy". With 12,000 monthly searches and 85% treatment-seeking intent, this audience represents a critical mental health need.

Step 2: They need professional therapy, support groups, coping strategies, and validation that their feelings are normal and treatable. They seek evidence-based treatment approaches combined with maternal-specific expertise.

Step 3: When they commit to treatment, they typically engage in 12-16 weekly therapy sessions at $150/session, with most insurance covering 80% of costs. Average client completes 14 sessions with high retention due to the urgent nature of symptoms and motivation to recover for their baby.

Step 4: They convert at 40% from consultation to paid therapy because they're in acute distress, have often already tried self-help unsuccessfully, and understand professional support is essential. The timing is critical (within 6 months postpartum) and insurance coverage reduces financial barriers.

Step 5: Profit of $1,200-$3,600 monthly ($1,500-$4,500 revenue, 80% margin at $150/session, accounting for 10-30 new clients per month with 40% conversion from 25-75 consultations)

Step 6: The business model works because postpartum depression is a recognized condition with strong insurance reimbursement, creating reliable revenue. The 80% profit margin reflects the low overhead of therapy practice. Marketing through OB-GYN partnerships, postpartum doula networks, and parenting forums creates steady referral flow.`;

  try {
    const result = await db.query(`
      INSERT INTO audiences (
        user_id,
        pitch,
        target_segment,
        customer_problem,
        customer_language,
        business_value
      ) VALUES (
        $1, $2, $3, $4, $5, $6
      )
      RETURNING id
    `, [
      userId,
      pitch,
      JSON.stringify({
        demographics: "First-time mothers aged 25-35 with postpartum depression",
        psychographics: "Experiencing acute distress, seeking professional support",
        searchBehavior: "Actively searching for specialized maternal mental health treatment"
      }),
      "Struggling with postpartum depression and seeking therapy",
      JSON.stringify(["postpartum depression treatment", "maternal mental health therapist", "new mom therapy"]),
      JSON.stringify({
        searchVolume: 12000,
        conversionPotential: 0.40,
        priority: "high"
      })
    ]);

    console.log('✅ Second strategy created!');
    console.log(`Strategy ID: ${result.rows[0].id}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

createSecondStrategy();
