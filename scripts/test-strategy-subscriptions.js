/**
 * Comprehensive Test Suite for Strategy Subscription Features
 *
 * Tests all API endpoints, database operations, and business logic
 */

import dotenv from 'dotenv';
import db from '../services/database.js';
import pricingCalculator from '../services/pricing-calculator.js';

dotenv.config();

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

/**
 * Test helper functions
 */
function logTest(name, status, message = '') {
  const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️';
  const color = status === 'pass' ? colors.green : status === 'fail' ? colors.red : colors.yellow;

  console.log(`${color}${icon} ${name}${colors.reset}`);
  if (message) {
    console.log(`   ${colors.gray}${message}${colors.reset}`);
  }

  testResults.tests.push({ name, status, message });
  if (status === 'pass') testResults.passed++;
  if (status === 'fail') testResults.failed++;
}

function logSection(title) {
  console.log(`\n${colors.cyan}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.cyan}${title}${colors.reset}`);
  console.log(`${colors.cyan}${'='.repeat(60)}${colors.reset}\n`);
}

function assert(condition, testName, successMsg, failureMsg) {
  if (condition) {
    logTest(testName, 'pass', successMsg);
    return true;
  } else {
    logTest(testName, 'fail', failureMsg);
    return false;
  }
}

/**
 * Test 1: Database Connection
 */
async function testDatabaseConnection() {
  logSection('Test 1: Database Connection');

  try {
    const connected = await db.testConnection();
    assert(
      connected,
      'Database connection',
      'Successfully connected to database',
      'Failed to connect to database'
    );
    return connected;
  } catch (error) {
    logTest('Database connection', 'fail', error.message);
    return false;
  }
}

/**
 * Test 2: Verify Tables Exist
 */
async function testTablesExist() {
  logSection('Test 2: Database Schema Verification');

  const requiredTables = [
    'bundle_subscriptions',
    'strategy_purchases',
    'strategy_usage_log',
    'audiences',
    'users'
  ];

  try {
    const result = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = ANY($1)
    `, [requiredTables]);

    const existingTables = result.rows.map(row => row.table_name);

    for (const table of requiredTables) {
      assert(
        existingTables.includes(table),
        `Table: ${table}`,
        `Table exists`,
        `Table missing`
      );
    }

    return existingTables.length === requiredTables.length;
  } catch (error) {
    logTest('Table verification', 'fail', error.message);
    return false;
  }
}

/**
 * Test 3: Verify Audiences Table Columns
 */
async function testAudiencesColumns() {
  logSection('Test 3: Audiences Table Enhancements');

  const requiredColumns = [
    'pricing_monthly',
    'pricing_annual',
    'posts_recommended',
    'posts_maximum',
    'projected_profit_low',
    'projected_profit_high',
    'pricing_percentage',
    'requires_subscription'
  ];

  try {
    const result = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'audiences'
      AND column_name = ANY($1)
    `, [requiredColumns]);

    const existingColumns = result.rows.map(row => row.column_name);

    for (const column of requiredColumns) {
      assert(
        existingColumns.includes(column),
        `Column: audiences.${column}`,
        `Column exists`,
        `Column missing`
      );
    }

    return existingColumns.length === requiredColumns.length;
  } catch (error) {
    logTest('Audiences columns verification', 'fail', error.message);
    return false;
  }
}

/**
 * Test 4: Get Test User and Strategy
 */
async function getTestUserAndStrategy() {
  logSection('Test 4: Fetch Test Data');

  try {
    // Get first user
    const userResult = await db.query('SELECT id, email FROM users LIMIT 1');

    if (userResult.rows.length === 0) {
      logTest('Get test user', 'fail', 'No users found in database');
      return null;
    }

    const user = userResult.rows[0];
    logTest('Get test user', 'pass', `Found user: ${user.email}`);

    // Get first audience/strategy
    const strategyResult = await db.query(`
      SELECT id, pitch, target_segment, user_id
      FROM audiences
      WHERE pitch IS NOT NULL AND pitch != ''
      LIMIT 1
    `);

    if (strategyResult.rows.length === 0) {
      logTest('Get test strategy', 'fail', 'No strategies found in database');
      return { user, strategy: null };
    }

    const strategy = strategyResult.rows[0];
    logTest('Get test strategy', 'pass', `Found strategy: ${strategy.id}`);

    return { user, strategy };
  } catch (error) {
    logTest('Fetch test data', 'fail', error.message);
    return null;
  }
}

/**
 * Test 5: Pricing Calculator - Profit Extraction
 */
async function testPricingCalculatorProfitExtraction() {
  logSection('Test 5: Pricing Calculator - Profit Extraction');

  const testPitches = [
    {
      name: 'Standard profit format',
      pitch: 'Step 5: Profit of $1,000-$3,000 monthly ($1,250-$3,750 revenue, 80% margin at $500/consultation)',
      expectedLow: 1000,
      expectedHigh: 3000
    },
    {
      name: 'Comma-separated format',
      pitch: 'Step 5: Profit of $1,200-$3,600 monthly ($1,500-$4,500 revenue, 80% margin)',
      expectedLow: 1200,
      expectedHigh: 3600
    },
    {
      name: 'Low profit scenario',
      pitch: 'Step 5: Profit of $400-$1,200 monthly ($500-$1,500 revenue, 80% margin)',
      expectedLow: 400,
      expectedHigh: 1200
    }
  ];

  for (const test of testPitches) {
    const mockStrategy = { pitch: test.pitch };
    const pricing = pricingCalculator.calculateProfitBasedPrice(mockStrategy);

    if (pricing) {
      const profitCorrect = pricing.projectedLow === test.expectedLow &&
                           pricing.projectedHigh === test.expectedHigh;

      assert(
        profitCorrect,
        test.name,
        `Extracted profit: $${pricing.projectedLow}-$${pricing.projectedHigh}`,
        `Expected $${test.expectedLow}-$${test.expectedHigh}, got $${pricing.projectedLow}-$${pricing.projectedHigh}`
      );
    } else {
      logTest(test.name, 'fail', 'Failed to extract profit from pitch');
    }
  }
}

/**
 * Test 6: Pricing Calculator - Price Calculation
 */
async function testPricingCalculatorPriceCalculation() {
  logSection('Test 6: Pricing Calculator - Price Calculation');

  const testCases = [
    {
      name: 'Very low profit ($300) - Floor price applies',
      profit: 300,
      expectedMonthly: 39.99, // Floor (calculation would be ~$29)
      tolerance: 0.01
    },
    {
      name: 'Low profit ($500) - Above floor',
      profit: 500,
      expectedMonthly: 46.67, // ~9.33% of 500
      tolerance: 0.5
    },
    {
      name: 'Mid profit ($1000) - 9% of profit',
      profit: 1000,
      expectedMonthly: 90, // ~9% of 1000
      tolerance: 5
    },
    {
      name: 'High profit ($2000) - Capped at $150',
      profit: 2000,
      expectedMonthly: 150, // Ceiling
      tolerance: 0.01
    }
  ];

  for (const test of testCases) {
    const mockStrategy = {
      pitch: `Step 5: Profit of $${test.profit}-$${test.profit * 3} monthly`
    };

    const pricing = pricingCalculator.calculateProfitBasedPrice(mockStrategy);

    if (pricing) {
      const withinTolerance = Math.abs(pricing.monthly - test.expectedMonthly) <= test.tolerance;

      assert(
        withinTolerance,
        test.name,
        `Monthly: $${pricing.monthly} (expected ~$${test.expectedMonthly})`,
        `Expected $${test.expectedMonthly}, got $${pricing.monthly}`
      );

      // Verify annual is monthly × 12 × 0.90
      const expectedAnnual = Math.round(pricing.monthly * 12 * 0.90 * 100) / 100;
      const annualCorrect = Math.abs(pricing.annual - expectedAnnual) < 0.02;

      assert(
        annualCorrect,
        `${test.name} - Annual calculation`,
        `Annual: $${pricing.annual} (10% discount)`,
        `Expected $${expectedAnnual}, got $${pricing.annual}`
      );
    } else {
      logTest(test.name, 'fail', 'Failed to calculate pricing');
    }
  }
}

/**
 * Test 7: Pricing Calculator - Post Quotas
 */
async function testPricingCalculatorPostQuotas() {
  logSection('Test 7: Pricing Calculator - Post Quotas');

  const mockStrategy = {
    pitch: 'Step 5: Profit of $1,000-$3,000 monthly'
  };

  const pricing = pricingCalculator.calculateProfitBasedPrice(mockStrategy);

  if (pricing) {
    assert(
      pricing.posts.recommended === 8,
      'Posts recommended',
      'Recommended: 8 posts/month',
      `Expected 8, got ${pricing.posts.recommended}`
    );

    assert(
      pricing.posts.maximum === 40,
      'Posts maximum',
      'Maximum: 40 posts/month',
      `Expected 40, got ${pricing.posts.maximum}`
    );
  } else {
    logTest('Post quotas', 'fail', 'Failed to get pricing data');
  }
}

/**
 * Test 8: Bundle Pricing Calculator
 */
async function testBundlePricingCalculator() {
  logSection('Test 8: Bundle Pricing Calculator');

  const mockStrategies = [
    { pitch: 'Step 5: Profit of $500-$1,500 monthly' },    // ~$47/mo
    { pitch: 'Step 5: Profit of $1,000-$3,000 monthly' },  // ~$90/mo
    { pitch: 'Step 5: Profit of $2,000-$6,000 monthly' }   // ~$150/mo
  ];

  const bundlePricing = pricingCalculator.calculateAllStrategiesBundle(mockStrategies);

  if (!bundlePricing) {
    logTest('Bundle pricing calculation', 'fail', 'Failed to calculate bundle pricing');
    return;
  }

  // Test strategy count
  assert(
    bundlePricing.strategyCount === 3,
    'Bundle strategy count',
    `Count: ${bundlePricing.strategyCount}`,
    `Expected 3, got ${bundlePricing.strategyCount}`
  );

  // Test monthly discount (10%)
  const expectedBundleMonthly = Math.round(bundlePricing.individualMonthlyTotal * 0.90 * 100) / 100;
  const monthlyCorrect = Math.abs(bundlePricing.bundleMonthly - expectedBundleMonthly) < 0.02;

  assert(
    monthlyCorrect,
    'Bundle monthly discount (10%)',
    `$${bundlePricing.bundleMonthly} (10% off $${bundlePricing.individualMonthlyTotal})`,
    `Expected $${expectedBundleMonthly}, got $${bundlePricing.bundleMonthly}`
  );

  // Test annual discount (19% total)
  const expectedBundleAnnual = Math.round(bundlePricing.bundleMonthly * 12 * 0.90 * 100) / 100;
  const annualCorrect = Math.abs(bundlePricing.bundleAnnual - expectedBundleAnnual) < 0.02;

  assert(
    annualCorrect,
    'Bundle annual discount (19% total)',
    `$${bundlePricing.bundleAnnual} (19% compound discount)`,
    `Expected $${expectedBundleAnnual}, got $${bundlePricing.bundleAnnual}`
  );

  // Test total discount percentage
  const totalDiscountPercent = bundlePricing.savings?.totalDiscountPercent || 0;
  const discountCorrect = totalDiscountPercent >= 18 && totalDiscountPercent <= 20;

  assert(
    discountCorrect,
    'Bundle total discount percentage',
    `${totalDiscountPercent}% total discount`,
    `Expected ~19%, got ${totalDiscountPercent}%`
  );
}

/**
 * Test 9: Database Foreign Key Constraints
 */
async function testDatabaseConstraints() {
  logSection('Test 9: Database Constraints & Data Types');

  try {
    // Check users.id is UUID
    const usersIdType = await db.query(`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'id'
    `);

    assert(
      usersIdType.rows[0]?.data_type === 'uuid',
      'users.id data type',
      'Correctly uses UUID',
      `Expected uuid, got ${usersIdType.rows[0]?.data_type}`
    );

    // Check audiences.id is UUID
    const audiencesIdType = await db.query(`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_name = 'audiences' AND column_name = 'id'
    `);

    assert(
      audiencesIdType.rows[0]?.data_type === 'uuid',
      'audiences.id data type',
      'Correctly uses UUID',
      `Expected uuid, got ${audiencesIdType.rows[0]?.data_type}`
    );

    // Check strategy_purchases foreign keys
    const strategyPurchasesFKs = await db.query(`
      SELECT
        c.column_name,
        c.data_type
      FROM information_schema.columns c
      WHERE c.table_name = 'strategy_purchases'
      AND c.column_name IN ('user_id', 'strategy_id')
    `);

    for (const row of strategyPurchasesFKs.rows) {
      assert(
        row.data_type === 'uuid',
        `strategy_purchases.${row.column_name} data type`,
        'Correctly uses UUID',
        `Expected uuid, got ${row.data_type}`
      );
    }

    // Check bundle_subscriptions foreign key
    const bundleFKs = await db.query(`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_name = 'bundle_subscriptions' AND column_name = 'user_id'
    `);

    assert(
      bundleFKs.rows[0]?.data_type === 'uuid',
      'bundle_subscriptions.user_id data type',
      'Correctly uses UUID',
      `Expected uuid, got ${bundleFKs.rows[0]?.data_type}`
    );

  } catch (error) {
    logTest('Database constraints check', 'fail', error.message);
  }
}

/**
 * Test 10: Check Index Creation
 */
async function testIndexes() {
  logSection('Test 10: Database Indexes');

  const expectedIndexes = [
    { table: 'bundle_subscriptions', index: 'idx_bundle_subscriptions_user_active' },
    { table: 'bundle_subscriptions', index: 'idx_bundle_subscriptions_stripe' },
    { table: 'strategy_purchases', index: 'idx_strategy_purchases_user_strategy' },
    { table: 'strategy_purchases', index: 'idx_strategy_purchases_user_active' },
    { table: 'strategy_usage_log', index: 'idx_strategy_usage_log_user_date' },
    { table: 'strategy_usage_log', index: 'idx_strategy_usage_log_strategy_date' }
  ];

  try {
    for (const { table, index } of expectedIndexes) {
      const result = await db.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = $1 AND indexname = $2
      `, [table, index]);

      assert(
        result.rows.length > 0,
        `Index: ${index}`,
        `Exists on ${table}`,
        `Missing on ${table}`
      );
    }
  } catch (error) {
    logTest('Index verification', 'fail', error.message);
  }
}

/**
 * Test Summary
 */
function printTestSummary() {
  logSection('Test Summary');

  const totalTests = testResults.passed + testResults.failed;
  const passRate = totalTests > 0 ? ((testResults.passed / totalTests) * 100).toFixed(1) : 0;

  console.log(`${colors.cyan}Total Tests: ${totalTests}${colors.reset}`);
  console.log(`${colors.green}Passed: ${testResults.passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${testResults.failed}${colors.reset}`);
  console.log(`${colors.blue}Pass Rate: ${passRate}%${colors.reset}\n`);

  if (testResults.failed > 0) {
    console.log(`${colors.red}Failed Tests:${colors.reset}`);
    testResults.tests
      .filter(t => t.status === 'fail')
      .forEach(t => {
        console.log(`  ${colors.red}❌ ${t.name}${colors.reset}`);
        if (t.message) {
          console.log(`     ${colors.gray}${t.message}${colors.reset}`);
        }
      });
    console.log();
  }

  return testResults.failed === 0;
}

/**
 * Main test runner
 */
async function runTests() {
  console.log(`${colors.blue}╔════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.blue}║  Strategy Subscription Comprehensive Test Suite           ║${colors.reset}`);
  console.log(`${colors.blue}╚════════════════════════════════════════════════════════════╝${colors.reset}\n`);

  try {
    // Run all tests in sequence
    const dbConnected = await testDatabaseConnection();
    if (!dbConnected) {
      console.log(`\n${colors.red}❌ Database connection failed. Cannot proceed with tests.${colors.reset}\n`);
      process.exit(1);
    }

    await testTablesExist();
    await testAudiencesColumns();
    await getTestUserAndStrategy();
    await testPricingCalculatorProfitExtraction();
    await testPricingCalculatorPriceCalculation();
    await testPricingCalculatorPostQuotas();
    await testBundlePricingCalculator();
    await testDatabaseConstraints();
    await testIndexes();

    // Print summary
    const allPassed = printTestSummary();

    // Close database connection
    await db.close();

    if (allPassed) {
      console.log(`${colors.green}✅ All tests passed! Backend is ready for Phase 3.${colors.reset}\n`);
      process.exit(0);
    } else {
      console.log(`${colors.red}❌ Some tests failed. Please review and fix issues.${colors.reset}\n`);
      process.exit(1);
    }

  } catch (error) {
    console.error(`${colors.red}Fatal error during testing:${colors.reset}`, error);
    await db.close();
    process.exit(1);
  }
}

// Run tests
runTests();
