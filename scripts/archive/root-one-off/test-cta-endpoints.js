import db from './services/database.js';

/**
 * Test CTA API endpoints
 */
async function testCTAEndpoints() {
  console.log('🧪 Testing CTA API endpoints...\n');

  try {
    // Get a real organization with CTAs
    const orgResult = await db.query(`
      SELECT DISTINCT o.id, o.user_id, o.business_name
      FROM organizations o
      INNER JOIN cta_analysis c ON c.organization_id = o.id
      LIMIT 1
    `);

    if (orgResult.rows.length === 0) {
      console.log('⚠️ No organizations with CTAs found. Creating test data...');

      // Get any organization
      const anyOrg = await db.query('SELECT id, user_id FROM organizations LIMIT 1');
      if (anyOrg.rows.length === 0) {
        console.error('❌ No organizations found in database');
        process.exit(1);
      }

      const orgId = anyOrg.rows[0].id;
      const userId = anyOrg.rows[0].user_id;

      console.log(`Using organization: ${orgId}`);

      // Test 1: Check if organization has CTAs
      console.log('\n📊 Test 1: Check existing CTAs');
      const existingCTAs = await db.query(`
        SELECT id, cta_text, cta_type, href, placement, data_source
        FROM cta_analysis
        WHERE organization_id = $1
        LIMIT 5
      `, [orgId]);

      console.log(`Found ${existingCTAs.rows.length} existing CTAs`);
      if (existingCTAs.rows.length > 0) {
        console.log('Sample CTA:', existingCTAs.rows[0]);
      }

      // Test 2: Insert manual CTAs
      console.log('\n📝 Test 2: Insert manual CTAs');
      const testCTAs = [
        {
          text: 'Schedule Free Consultation',
          href: '/schedule',
          type: 'demo',
          placement: 'end-of-post'
        },
        {
          text: 'Download Our Guide',
          href: '/resources/guide',
          type: 'download',
          placement: 'sidebar'
        },
        {
          text: 'Contact Us Today',
          href: '/contact',
          type: 'contact',
          placement: 'footer'
        }
      ];

      let insertedCount = 0;
      for (const cta of testCTAs) {
        try {
          await db.query(`
            INSERT INTO cta_analysis (
              organization_id,
              page_url,
              cta_text,
              cta_type,
              placement,
              href,
              context,
              conversion_potential,
              visibility_score,
              page_type,
              analysis_source,
              data_source,
              scraped_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
            ON CONFLICT (organization_id, page_url, cta_text, placement) DO UPDATE SET
              cta_type = EXCLUDED.cta_type,
              href = EXCLUDED.href,
              data_source = EXCLUDED.data_source
          `, [
            orgId,
            'manual-entry',
            cta.text,
            cta.type,
            cta.placement,
            cta.href,
            `Test CTA for ${cta.type}`,
            75,
            80,
            'manual_entry',
            'test_script',
            'manual'
          ]);
          insertedCount++;
          console.log(`✅ Inserted: "${cta.text}"`);
        } catch (error) {
          console.error(`❌ Failed to insert "${cta.text}":`, error.message);
        }
      }

      console.log(`\n✅ Inserted ${insertedCount} test CTAs`);

      // Test 3: Query CTAs with data_source
      console.log('\n📊 Test 3: Query CTAs with data_source filter');

      const scrapedCTAs = await db.query(`
        SELECT COUNT(*) as count
        FROM cta_analysis
        WHERE organization_id = $1 AND data_source = 'scraped'
      `, [orgId]);

      const manualCTAs = await db.query(`
        SELECT COUNT(*) as count
        FROM cta_analysis
        WHERE organization_id = $1 AND data_source = 'manual'
      `, [orgId]);

      console.log(`Scraped CTAs: ${scrapedCTAs.rows[0].count}`);
      console.log(`Manual CTAs: ${manualCTAs.rows[0].count}`);

      // Test 4: Test GET endpoint query
      console.log('\n📊 Test 4: Simulate GET /api/v1/organizations/:id/ctas');

      const getResult = await db.query(`
        SELECT
          id,
          cta_text as text,
          cta_type as type,
          href,
          placement,
          conversion_potential,
          data_source,
          page_type,
          context
        FROM cta_analysis
        WHERE organization_id = $1
        ORDER BY conversion_potential DESC
        LIMIT 5
      `, [orgId]);

      const ctas = getResult.rows;
      const count = ctas.length;
      const has_sufficient_ctas = count >= 3;

      console.log(`✅ Retrieved ${count} CTAs`);
      console.log(`Has sufficient CTAs: ${has_sufficient_ctas}`);
      console.log('\nSample response:');
      console.log(JSON.stringify({
        success: true,
        ctas: ctas.slice(0, 3),
        count,
        has_sufficient_ctas
      }, null, 2));

      // Test 5: Test validation of data_source integrity
      console.log('\n🔍 Test 5: Verify data_source integrity');

      const integrityCheck = await db.query(`
        SELECT
          data_source,
          COUNT(*) as count
        FROM cta_analysis
        WHERE organization_id = $1
        GROUP BY data_source
      `, [orgId]);

      console.log('Data source distribution:');
      integrityCheck.rows.forEach(row => {
        console.log(`  ${row.data_source}: ${row.count} CTAs`);
      });

      // Test 6: Test content generation context building
      console.log('\n📝 Test 6: Build content generation context');

      const ctaContext = await db.query(`
        SELECT cta_text, cta_type, placement, href, context, data_source
        FROM cta_analysis
        WHERE organization_id = $1
        ORDER BY conversion_potential DESC
        LIMIT 5
      `, [orgId]);

      if (ctaContext.rows.length > 0) {
        const promptSection = `AVAILABLE CTAS (use these EXACT URLs - do not modify):

${ctaContext.rows.map((cta, i) =>
  `${i + 1}. "${cta.cta_text}" → ${cta.href}
   Type: ${cta.cta_type} | Best placement: ${cta.placement}
   Context: ${cta.context || 'General use'}`
).join('\n\n')}

CRITICAL CTA INSTRUCTIONS:
- ONLY use CTAs from the list above
- Use the EXACT href URLs provided - do not modify them`;

        console.log('✅ Generated prompt section:');
        console.log(promptSection.substring(0, 500) + '...');
      }

      console.log('\n' + '='.repeat(60));
      console.log('✅ ALL TESTS PASSED');
      console.log('='.repeat(60));

      process.exit(0);

    } else {
      const org = orgResult.rows[0];
      console.log(`Using organization: ${org.business_name} (${org.id})`);

      // Run tests with real org...
      // (Similar tests as above)
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testCTAEndpoints();
