/**
 * Create a test strategy with proper profit-based pitch for testing pricing API
 */

import db from '../services/database.js';

async function createTestStrategy() {
  const userId = '404b404d-de79-4082-a052-7ab51428d50c'; // Test user ID

  const pitch = `
Step 1: The "New Mothers Struggling with Postpartum Depression" audience represents first-time mothers aged 25-35 who experienced difficult births and are now dealing with postpartum depression. They search for "postpartum depression treatment," "new mom support groups," and "therapy for new mothers." With 15,000 monthly searches and growing awareness of maternal mental health, this audience has high search intent and emotional urgency.

Step 2: They are searching for professional support, coping strategies, therapy options, and understanding from others who've been through similar experiences. They need validation that what they're feeling is normal and treatable, plus practical tools to manage their symptoms while caring for a newborn.

Step 3: When they find the right therapist or support program, they typically commit to 12-16 weeks of therapy at $150/session, often covered by insurance. The average client completes 12 sessions and may continue with maintenance sessions. This audience has 90% completion rates due to the urgency of their needs and strong motivation to feel better for their baby.

Step 4: They convert at 35% from consultation to paid client because they're actively seeking help and have often tried self-help methods without success. The pain point is acute, timing is critical (within first 6 months postpartum), and professional support is essential for recovery.

Step 5: Profit of $1,200-$3,600 monthly ($1,500-$4,500 revenue, 80% margin at $150/session, accounting for 12-36 new clients per month with 35% conversion from 100-300 consultation requests)

Step 6: The business model works because postpartum depression is a recognized medical condition with strong insurance coverage, high urgency for treatment, and excellent client retention. Marketing through parenting forums, OB-GYN partnerships, and postpartum doula networks creates steady referral flow. The 80% profit margin reflects the low overhead of therapy services and the premium positioning for specialized maternal mental health expertise.
`;

  try {
    const result = await db.query(`
      INSERT INTO audiences (
        id,
        user_id,
        pitch,
        target_segment,
        customer_problem,
        customer_language,
        business_value,
        session_id,
        created_at
      ) VALUES (
        gen_random_uuid(),
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        gen_random_uuid(),
        NOW()
      )
      RETURNING id, pitch
    `, [
      userId,
      pitch,
      JSON.stringify({
        demographics: 'First-time mothers aged 25-35 with postpartum depression',
        location: 'United States',
        searchBehavior: 'Actively seeking therapy and support'
      }),
      'Struggling with postpartum depression and seeking professional support',
      JSON.stringify(['postpartum depression treatment', 'therapy for new mothers', 'maternal mental health']),
      JSON.stringify({
        searchVolume: 15000,
        conversionPotential: 0.35,
        priority: 'high'
      })
    ]);

    console.log('✅ Test strategy created successfully!');
    console.log(`Strategy ID: ${result.rows[0].id}`);
    console.log(`\nTo test pricing API:`);
    console.log(`curl -s "http://localhost:3001/api/v1/strategies/${result.rows[0].id}/pricing" -H "Authorization: Bearer YOUR_TOKEN" | jq '.'`);

    return result.rows[0];
  } catch (error) {
    console.error('❌ Error creating test strategy:', error);
    throw error;
  } finally {
    // Don't close the pool, just exit
    process.exit(0);
  }
}

createTestStrategy().catch(console.error);
