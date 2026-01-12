import webScraperService from './services/webscraper.js';

/**
 * Test WebScraper service new functionality locally
 */
async function testWebScraperLocally() {
  console.log('🧪 Testing WebScraper Service Phase 1A Features');
  console.log('='.repeat(50));

  const testUrl = 'https://blog.hubspot.com';
  
  try {
    // Test 1: Blog Discovery
    console.log('\n📖 Test 1: Blog Discovery');
    console.log('-'.repeat(30));
    
    const blogDiscovery = await webScraperService.discoverBlogPages(testUrl);
    console.log('✅ Blog Discovery Results:');
    console.log(`   - Blog sections found: ${blogDiscovery.blogSections.length}`);
    console.log(`   - Blog posts found: ${blogDiscovery.blogPosts.length}`);
    console.log(`   - Total posts discovered: ${blogDiscovery.totalPostsFound}`);
    
    if (blogDiscovery.blogPosts.length > 0) {
      console.log('   - First post:', blogDiscovery.blogPosts[0].title);
    }

    // Test 2: CTA Extraction
    console.log('\n🎯 Test 2: CTA Extraction');
    console.log('-'.repeat(30));
    
    const ctas = await webScraperService.extractCTAs(testUrl);
    console.log(`✅ CTA Extraction Results: Found ${ctas.length} CTAs`);
    
    if (ctas.length > 0) {
      console.log('   - Sample CTA:', {
        type: ctas[0].type,
        text: ctas[0].text.substring(0, 50) + '...',
        placement: ctas[0].placement
      });
    }

    // Test 3: Internal Link Analysis
    console.log('\n🔗 Test 3: Internal Link Analysis');
    console.log('-'.repeat(30));
    
    const linkStructure = await webScraperService.extractInternalLinks(testUrl);
    console.log(`✅ Internal Links Results: Found ${linkStructure.totalLinksFound} internal links`);
    
    if (linkStructure.internalLinks.length > 0) {
      console.log('   - Sample link:', {
        text: linkStructure.internalLinks[0].text.substring(0, 40) + '...',
        linkType: linkStructure.internalLinks[0].linkType,
        context: linkStructure.internalLinks[0].context
      });
    }

    console.log('\n🎉 All WebScraper tests completed successfully!');
    
  } catch (error) {
    console.error('❌ WebScraper test failed:', error.message);
  }
}

// Run the test
testWebScraperLocally()
  .then(() => {
    console.log('\n✅ WebScraper testing completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 WebScraper testing failed:', error);
    process.exit(1);
  });