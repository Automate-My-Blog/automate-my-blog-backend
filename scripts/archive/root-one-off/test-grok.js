import { GrokTweetSearchService } from './services/grok-tweet-search.js';

async function testGrokSearch() {
  console.log('🧪 Testing Grok tweet search directly...\n');

  const grokService = new GrokTweetSearchService();

  const startTime = Date.now();

  try {
    const tweets = await grokService.searchRelevantTweets({
      topic: 'postpartum depression support',
      businessType: 'Healthcare',
      targetAudience: 'Expectant mothers',
      maxTweets: 3
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n✅ Search completed in ${elapsed}s`);
    console.log(`📊 Found ${tweets.length} tweets:`);
    console.log(JSON.stringify(tweets, null, 2));

  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`\n❌ Search failed after ${elapsed}s`);
    console.error('Error:', error.message);
    if (error.code) console.error('Error code:', error.code);
  }
}

testGrokSearch();
