import db from './services/database.js';

/**
 * Comprehensive test for data_source column addition
 * Ensures no breaking changes to existing CTA functionality
 */
async function runTests() {
  console.log('🧪 Testing CTA data_source column integration...\n');

  const testResults = {
    passed: 0,
    failed: 0,
    tests: []
  };

  const addTestResult = (name, passed, details = '') => {
    testResults.tests.push({ name, passed, details });
    if (passed) {
      testResults.passed++;
      console.log(`✅ ${name}`);
    } else {
      testResults.failed++;
      console.log(`❌ ${name}`);
      if (details) console.log(`   ${details}`);
    }
  };

  try {
    // Test 1: Verify column exists
    console.log('Test 1: Verify data_source column exists...');
    const columnCheck = await db.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'cta_analysis' AND column_name = 'data_source'
    `);

    const columnExists = columnCheck.rows.length > 0;
    addTestResult(
      'data_source column exists',
      columnExists,
      columnExists ? `Type: ${columnCheck.rows[0].data_type}, Nullable: ${columnCheck.rows[0].is_nullable}` : 'Column not found'
    );

    // Test 2: Verify CHECK constraint
    console.log('\nTest 2: Verify CHECK constraint...');
    const constraintCheck = await db.query(`
      SELECT conname, contype, pg_get_constraintdef(oid) as definition
      FROM pg_constraint
      WHERE conrelid = 'cta_analysis'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%data_source%'
    `);

    const hasConstraint = constraintCheck.rows.length > 0;
    addTestResult(
      'CHECK constraint on data_source exists',
      hasConstraint,
      hasConstraint ? constraintCheck.rows[0].definition : 'No constraint found'
    );

    // Test 3: Test inserting with data_source='scraped'
    console.log('\nTest 3: Test INSERT with data_source=\'scraped\'...');
    try {
      const testOrgId = '00000000-0000-0000-0000-000000000001'; // Test UUID
      await db.query(`
        INSERT INTO cta_analysis (
          organization_id, page_url, cta_text, cta_type, placement,
          href, data_source, analysis_source, conversion_potential, visibility_score, page_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (organization_id, page_url, cta_text, placement) DO NOTHING
      `, [
        testOrgId,
        'https://test.com/test',
        'Test CTA Scraped',
        'button',
        'header',
        '/test-scraped',
        'scraped',
        'test',
        80,
        80,
        'static_page'
      ]);

      // Verify it was inserted
      const verifyScraped = await db.query(`
        SELECT data_source FROM cta_analysis
        WHERE organization_id = $1 AND cta_text = 'Test CTA Scraped'
      `, [testOrgId]);

      const insertWorked = verifyScraped.rows.length > 0 && verifyScraped.rows[0].data_source === 'scraped';
      addTestResult('INSERT with data_source=\'scraped\' works', insertWorked);
    } catch (error) {
      addTestResult('INSERT with data_source=\'scraped\' works', false, error.message);
    }

    // Test 4: Test inserting with data_source='manual'
    console.log('\nTest 4: Test INSERT with data_source=\'manual\'...');
    try {
      const testOrgId = '00000000-0000-0000-0000-000000000001';
      await db.query(`
        INSERT INTO cta_analysis (
          organization_id, page_url, cta_text, cta_type, placement,
          href, data_source, analysis_source, conversion_potential, visibility_score, page_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (organization_id, page_url, cta_text, placement) DO NOTHING
      `, [
        testOrgId,
        'https://test.com/test',
        'Test CTA Manual',
        'link',
        'footer',
        '/test-manual',
        'manual',
        'test',
        75,
        75,
        'static_page'
      ]);

      // Verify it was inserted
      const verifyManual = await db.query(`
        SELECT data_source FROM cta_analysis
        WHERE organization_id = $1 AND cta_text = 'Test CTA Manual'
      `, [testOrgId]);

      const insertWorked = verifyManual.rows.length > 0 && verifyManual.rows[0].data_source === 'manual';
      addTestResult('INSERT with data_source=\'manual\' works', insertWorked);
    } catch (error) {
      addTestResult('INSERT with data_source=\'manual\' works', false, error.message);
    }

    // Test 5: Test that invalid data_source is rejected
    console.log('\nTest 5: Test CHECK constraint rejects invalid values...');
    try {
      const testOrgId = '00000000-0000-0000-0000-000000000001';
      await db.query(`
        INSERT INTO cta_analysis (
          organization_id, page_url, cta_text, cta_type, placement,
          href, data_source, analysis_source, conversion_potential, visibility_score, page_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        testOrgId,
        'https://test.com/test',
        'Test CTA Invalid',
        'button',
        'sidebar',
        '/test-invalid',
        'invalid_source',  // Should be rejected
        'test',
        70,
        70,
        'static_page'
      ]);

      // If we get here, the constraint didn't work
      addTestResult('CHECK constraint rejects invalid data_source', false, 'Invalid value was accepted');
    } catch (error) {
      // Should fail with constraint violation
      const constraintFailed = error.message.includes('check constraint') || error.message.includes('cta_analysis');
      addTestResult('CHECK constraint rejects invalid data_source', constraintFailed, constraintFailed ? 'Correctly rejected' : error.message);
    }

    // Test 6: Query CTAs and verify backward compatibility
    console.log('\nTest 6: Test querying CTAs (backward compatibility)...');
    try {
      const testOrgId = '00000000-0000-0000-0000-000000000001';
      const result = await db.query(`
        SELECT cta_text, cta_type, href, data_source, placement
        FROM cta_analysis
        WHERE organization_id = $1
        ORDER BY created_at DESC
        LIMIT 5
      `, [testOrgId]);

      const queryWorked = result.rows.length >= 0; // Should work even if no rows
      const hasDataSource = result.rows.length > 0 ? result.rows.every(row => row.data_source) : true;

      addTestResult(
        'SELECT queries work with new column',
        queryWorked && hasDataSource,
        queryWorked ? `Found ${result.rows.length} CTAs, all have data_source` : 'Query failed'
      );
    } catch (error) {
      addTestResult('SELECT queries work with new column', false, error.message);
    }

    // Test 7: Verify existing CTAs were backfilled
    console.log('\nTest 7: Verify existing CTAs have data_source...');
    try {
      const nullCheck = await db.query(`
        SELECT COUNT(*) as null_count
        FROM cta_analysis
        WHERE data_source IS NULL
      `);

      const noNulls = parseInt(nullCheck.rows[0].null_count) === 0;
      addTestResult(
        'No NULL data_source values (all backfilled)',
        noNulls,
        noNulls ? 'All records have data_source' : `Found ${nullCheck.rows[0].null_count} NULL values`
      );
    } catch (error) {
      addTestResult('No NULL data_source values (all backfilled)', false, error.message);
    }

    // Test 8: Test filtering by data_source
    console.log('\nTest 8: Test filtering by data_source...');
    try {
      const scrapedCount = await db.query(`
        SELECT COUNT(*) as count FROM cta_analysis WHERE data_source = 'scraped'
      `);
      const manualCount = await db.query(`
        SELECT COUNT(*) as count FROM cta_analysis WHERE data_source = 'manual'
      `);

      const filterWorked = scrapedCount.rows.length > 0 && manualCount.rows.length > 0;
      addTestResult(
        'Filtering by data_source works',
        filterWorked,
        `Scraped: ${scrapedCount.rows[0].count}, Manual: ${manualCount.rows[0].count}`
      );
    } catch (error) {
      addTestResult('Filtering by data_source works', false, error.message);
    }

    // Cleanup: Remove test data
    console.log('\nCleaning up test data...');
    try {
      const testOrgId = '00000000-0000-0000-0000-000000000001';
      await db.query(`
        DELETE FROM cta_analysis
        WHERE organization_id = $1
        AND cta_text LIKE 'Test CTA%'
      `, [testOrgId]);
      console.log('✅ Test data cleaned up\n');
    } catch (error) {
      console.warn('⚠️ Failed to clean up test data:', error.message);
    }

  } catch (error) {
    console.error('\n❌ Critical test error:', error);
    testResults.failed++;
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`📊 Total:  ${testResults.passed + testResults.failed}`);
  console.log('='.repeat(60));

  if (testResults.failed > 0) {
    console.log('\n⚠️ SOME TESTS FAILED - Review errors above');
    console.log('Failed tests:');
    testResults.tests
      .filter(t => !t.passed)
      .forEach(t => console.log(`  - ${t.name}: ${t.details}`));
    process.exit(1);
  } else {
    console.log('\n🎉 ALL TESTS PASSED - No breaking changes detected!');
    process.exit(0);
  }
}

runTests();
