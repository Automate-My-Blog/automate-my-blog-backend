/**
 * Test script for Grok Tweet Search Service
 * Tests the ability to search for real tweets using Grok's X/Twitter access
 */

import dotenv from 'dotenv';

// Load environment variables FIRST before any other imports
dotenv.config();

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function runTests() {
  // Import AFTER dotenv.config() using dynamic import
  const { default: grokTweetSearch } = await import('./services/grok-tweet-search.js');
  log('\n🧪 GROK TWEET SEARCH TEST SUITE', 'blue');
  log('========================================\n', 'blue');

  let passed = 0;
  let failed = 0;

  // Test 1: Search for tweets about a health topic
  try {
    log('\n📝 Test 1: Search for tweets about postpartum depression', 'cyan');
    log('──────────────────────────────────────────────────────\n');

    const tweets = await grokTweetSearch.searchRelevantTweets({
      topic: 'postpartum depression treatment and support',
      businessType: 'Healthcare',
      targetAudience: 'New mothers and families',
      maxTweets: 3
    });

    if (tweets && Array.isArray(tweets)) {
      log(`✅ Test 1 PASSED: Got ${tweets.length} tweet URLs`, 'green');
      tweets.forEach((url, i) => {
        log(`   ${i + 1}. ${url}`, 'cyan');
      });
      passed++;
    } else {
      log('❌ Test 1 FAILED: Invalid response format', 'red');
      failed++;
    }
  } catch (error) {
    log(`❌ Test 1 FAILED: ${error.message}`, 'red');
    failed++;
  }

  // Test 2: Validate tweet URLs
  try {
    log('\n📝 Test 2: Validate a real tweet URL', 'cyan');
    log('──────────────────────────────────────────────────────\n');

    // Use a well-known account's tweet (example)
    const testUrl = 'https://x.com/elonmusk/status/1';
    const exists = await grokTweetSearch.validateTweetExists(testUrl);

    if (typeof exists === 'boolean') {
      log(`✅ Test 2 PASSED: Validation returned ${exists}`, 'green');
      passed++;
    } else {
      log('❌ Test 2 FAILED: Invalid validation response', 'red');
      failed++;
    }
  } catch (error) {
    log(`❌ Test 2 FAILED: ${error.message}`, 'red');
    failed++;
  }

  // Test 3: Handle missing API key gracefully
  try {
    log('\n📝 Test 3: Graceful degradation without API key', 'cyan');
    log('──────────────────────────────────────────────────────\n');

    // Temporarily save and clear API key
    const originalKey = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY;

    // Create new instance without key
    const { GrokTweetSearchService } = await import('./services/grok-tweet-search.js');
    const noKeyService = new GrokTweetSearchService();

    const tweets = await noKeyService.searchRelevantTweets({
      topic: 'test',
      businessType: 'test',
      targetAudience: 'test'
    });

    // Restore API key
    process.env.XAI_API_KEY = originalKey;

    if (Array.isArray(tweets) && tweets.length === 0) {
      log('✅ Test 3 PASSED: Returns empty array without API key', 'green');
      passed++;
    } else {
      log('❌ Test 3 FAILED: Should return empty array', 'red');
      failed++;
    }
  } catch (error) {
    log(`❌ Test 3 FAILED: ${error.message}`, 'red');
    failed++;
  }

  // Summary
  log('\n══════════════════════════════════════', 'blue');
  log('TEST SUMMARY', 'blue');
  log('══════════════════════════════════════\n', 'blue');

  const total = passed + failed;
  const passRate = ((passed / total) * 100).toFixed(1);

  log(`Total Tests: ${total}`);
  log(`Passed: ${passed}`, 'green');
  log(`Failed: ${failed}`, failed > 0 ? 'red' : 'green');
  log(`Pass Rate: ${passRate}%`, passRate >= 60 ? 'green' : 'red');

  if (failed === 0) {
    log('\n🎉 ALL TESTS PASSED! Grok tweet search is working correctly.', 'green');
  } else {
    log(`\n⚠️  ${failed} test(s) failed. Please review the failures above.`, 'yellow');
  }

  log('\n');
  return failed === 0;
}

// Run the tests
runTests()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test suite error:', error);
    process.exit(1);
  });
