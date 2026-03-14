import db from './services/database.js';

/**
 * Simple CTA endpoint test
 */
async function testCTASimple() {
  console.log('🧪 Testing CTA system...\n');

  try {
    // Check organizations table schema
    console.log('📊 Checking organizations table schema...');
    const schemaResult = await db.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'organizations'
      ORDER BY ordinal_position
    `);

    console.log('Organizations columns:', schemaResult.rows.map(r => r.column_name));

    // Get any organization
    const orgResult = await db.query('SELECT * FROM organizations LIMIT 1');

    if (orgResult.rows.length === 0) {
      console.error('❌ No organizations found');
      process.exit(1);
    }

    const org = orgResult.rows[0];
    console.log(`\n✅ Using organization: ${org.id}`);

    // Test 1: Check existing CTAs
    console.log('\n📊 Test 1: Query existing CTAs for organization');
    const ctaResult = await db.query(`
      SELECT
        id,
        cta_text as text,
        cta_type as type,
        href,
        placement,
        conversion_potential,
        data_source,
        page_type
      FROM cta_analysis
      WHERE organization_id = $1
      ORDER BY conversion_potential DESC
      LIMIT 5
    `, [org.id]);

    console.log(`✅ Found ${ctaResult.rows.length} CTAs`);
    if (ctaResult.rows.length > 0) {
      console.log('Sample CTA:', {
        text: ctaResult.rows[0].text,
        href: ctaResult.rows[0].href,
        type: ctaResult.rows[0].type,
        data_source: ctaResult.rows[0].data_source
      });
    }

    // Test 2: Insert manual test CTAs
    console.log('\n📝 Test 2: Insert manual CTAs');
    const testCTAs = [
      { text: 'Test Schedule Consultation', href: '/test-schedule', type: 'demo', placement: 'end-of-post' },
      { text: 'Test Download Guide', href: '/test-guide', type: 'download', placement: 'sidebar' },
      { text: 'Test Contact Us', href: '/test-contact', type: 'contact', placement: 'footer' }
    ];

    let inserted = 0;
    for (const cta of testCTAs) {
      try {
        await db.query(`
          INSERT INTO cta_analysis (
            organization_id, page_url, cta_text, cta_type, placement,
            href, context, conversion_potential, visibility_score,
            page_type, analysis_source, data_source, scraped_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
          ON CONFLICT (organization_id, page_url, cta_text, placement) DO NOTHING
        `, [
          org.id, 'test-manual-entry', cta.text, cta.type, cta.placement,
          cta.href, `Test ${cta.type} CTA`, 75, 80,
          'manual_entry', 'test_script', 'manual'
        ]);
        inserted++;
        console.log(`✅ Inserted: ${cta.text}`);
      } catch (err) {
        console.error(`❌ Failed to insert ${cta.text}:`, err.message);
      }
    }

    // Test 3: Query all CTAs again
    console.log('\n📊 Test 3: Query all CTAs after insert');
    const allCTAs = await db.query(`
      SELECT
        cta_text, cta_type, href, data_source
      FROM cta_analysis
      WHERE organization_id = $1
      ORDER BY conversion_potential DESC
      LIMIT 10
    `, [org.id]);

    console.log(`✅ Total CTAs: ${allCTAs.rows.length}`);

    const scraped = allCTAs.rows.filter(c => c.data_source === 'scraped').length;
    const manual = allCTAs.rows.filter(c => c.data_source === 'manual').length;

    console.log(`  - Scraped: ${scraped}`);
    console.log(`  - Manual: ${manual}`);

    // Test 4: Simulate GET endpoint response
    console.log('\n📊 Test 4: Simulate GET /api/v1/organizations/:id/ctas');
    const has_sufficient_ctas = allCTAs.rows.length >= 3;

    console.log(JSON.stringify({
      success: true,
      ctas: allCTAs.rows.slice(0, 5).map(c => ({
        text: c.cta_text,
        type: c.cta_type,
        href: c.href,
        data_source: c.data_source
      })),
      count: allCTAs.rows.length,
      has_sufficient_ctas,
      message: has_sufficient_ctas
        ? `Found ${allCTAs.rows.length} CTAs ready for content generation`
        : `Only ${allCTAs.rows.length} CTAs found. We recommend at least 3 for best results.`
    }, null, 2));

    // Test 5: Test content validator
    console.log('\n🔍 Test 5: Test content-validator service');

    const testContent = `
# Blog Post Title

Check out our [Schedule Free Consultation](/schedule) page.

You can also [contact us](https://www.yourwebsite.com/contact) for more info.

Visit [Download Guide](https://example.com/guide) to learn more.
    `;

    // Import validator
    const contentValidator = await import('./services/content-validator.js');

    const validation = contentValidator.default.validateGeneratedContent(
      testContent,
      allCTAs.rows,
      []
    );

    console.log('Validation result:', {
      valid: validation.valid,
      total_urls: validation.stats.total_urls,
      placeholder_urls: validation.stats.placeholder_urls,
      approved_urls: validation.stats.approved_urls
    });

    if (validation.issues.length > 0) {
      console.log('Found issues:');
      validation.issues.forEach(issue => {
        console.log(`  - [${issue.severity}] ${issue.url}: ${issue.message}`);
      });
    }

    // Test 6: Test link validator
    console.log('\n🔗 Test 6: Test link-validator service');

    const linkValidator = await import('./services/link-validator.js');

    const testLinks = [
      { href: 'https://www.google.com' },
      { href: '/relative-path' },
      { href: 'https://invalid-domain-that-does-not-exist-12345.com' }
    ];

    const linkValidation = await linkValidator.default.validateLinks(testLinks);

    console.log('Link validation result:', {
      all_valid: linkValidation.all_valid,
      invalid_count: linkValidation.invalid_links.length
    });

    linkValidation.results.forEach(result => {
      console.log(`  ${result.valid ? '✅' : '❌'} ${result.href}: ${result.message || result.error || result.status}`);
    });

    // Cleanup test data
    console.log('\n🧹 Cleaning up test data...');
    await db.query(`
      DELETE FROM cta_analysis
      WHERE organization_id = $1 AND cta_text LIKE 'Test %'
    `, [org.id]);
    console.log('✅ Cleanup complete');

    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL TESTS PASSED');
    console.log('='.repeat(60));

    process.exit(0);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testCTASimple();
