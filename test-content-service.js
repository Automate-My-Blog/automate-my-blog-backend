import contentService from './services/content.js';
import authService from './services/auth.js';

// Test content service and blog posts functionality
async function testContentService() {
  console.log('🧪 Testing Content Service and Blog Posts...\n');
  
  let testUser = null;
  let testPosts = [];
  
  try {
    // Step 1: Get content service status
    console.log('1️⃣ Checking content service status...');
    const contentStatus = contentService.getStorageStatus();
    const authStatus = authService.getStorageStatus ? authService.getStorageStatus() : null;
    
    console.log('📊 Content Service Status:');
    console.log(`   Mode: ${contentStatus.mode}`);
    console.log(`   Database Available: ${contentStatus.databaseAvailable}`);
    console.log(`   Fallback Posts: ${contentStatus.fallbackPostCount}`);
    if (authStatus) {
      console.log(`   Auth Mode: ${authStatus.mode}`);
    }
    
    // Step 2: Create test user for blog posts
    console.log('\n2️⃣ Creating test user...');
    try {
      testUser = await authService.register({
        email: 'blogger@automatemyblog.com',
        password: 'bloggerPassword123!',
        firstName: 'Test',
        lastName: 'Blogger',
        organizationName: 'Test Blog Org'
      });
      console.log(`✅ Test user created: ${testUser.user.email} (${testUser.user.id})`);
    } catch (error) {
      if (error.message.includes('already exists')) {
        // User exists, try to login
        const loginResult = await authService.login('blogger@automatemyblog.com', 'bloggerPassword123!');
        testUser = loginResult;
        console.log(`✅ Using existing test user: ${testUser.user.email} (${testUser.user.id})`);
      } else {
        throw error;
      }
    }
    
    const userId = testUser.user.id;
    
    // Step 3: Test blog post creation
    console.log('\n3️⃣ Testing blog post creation...');
    
    const testBlogPost1 = {
      title: 'How to Build AI-Powered Applications',
      content: `# How to Build AI-Powered Applications

In today's rapidly evolving tech landscape, AI-powered applications are becoming increasingly important...

## Key Benefits

1. **Enhanced User Experience**: AI can personalize interactions
2. **Improved Efficiency**: Automate repetitive tasks
3. **Better Decision Making**: Data-driven insights

## Getting Started

To build AI-powered applications, you'll need to consider:
- Choosing the right AI models
- Data collection and preprocessing
- Integration with existing systems

This is a comprehensive guide to help you get started with your AI journey.`,
      topic: {
        title: 'How to Build AI-Powered Applications',
        subheader: 'A comprehensive guide for developers',
        category: 'Technology'
      },
      businessInfo: {
        businessType: 'Technology Company',
        targetAudience: 'Software Developers',
        brandVoice: 'Expert and Helpful'
      },
      generationMetadata: {
        tokensUsed: 1500,
        generationTime: 12000,
        aiModel: 'gpt-4'
      }
    };
    
    const savedPost1 = await contentService.saveBlogPost(userId, testBlogPost1);
    testPosts.push(savedPost1);
    console.log(`✅ Blog post created: "${savedPost1.title}" (${savedPost1.id})`);
    
    // Step 4: Create a second blog post
    console.log('\n4️⃣ Creating second blog post...');
    
    const testBlogPost2 = {
      title: 'The Future of Content Marketing',
      content: `# The Future of Content Marketing

Content marketing continues to evolve with new technologies and changing consumer behaviors...

## Emerging Trends

- **AI-Generated Content**: Automated content creation
- **Interactive Content**: Engaging multimedia experiences  
- **Personalization at Scale**: Tailored content for each user

## Best Practices

1. Focus on value-driven content
2. Leverage data analytics
3. Embrace new content formats

The future is bright for innovative content marketers who adapt to these changes.`,
      topic: {
        title: 'The Future of Content Marketing',
        subheader: 'Trends and strategies for 2024',
        category: 'Marketing'
      },
      businessInfo: {
        businessType: 'Marketing Agency',
        targetAudience: 'Marketing Professionals',
        brandVoice: 'Insightful and Forward-Thinking'
      },
      status: 'published'
    };
    
    const savedPost2 = await contentService.saveBlogPost(userId, testBlogPost2);
    testPosts.push(savedPost2);
    console.log(`✅ Second blog post created: "${savedPost2.title}" (${savedPost2.id})`);
    
    // Step 5: Test getting user's blog posts
    console.log('\n5️⃣ Testing get user blog posts...');
    
    const userPosts = await contentService.getUserBlogPosts(userId, {
      limit: 10,
      offset: 0,
      status: 'all'
    });
    
    console.log(`✅ Retrieved ${userPosts.posts.length} blog posts`);
    console.log(`   Total posts: ${userPosts.total}`);
    console.log(`   Has more: ${userPosts.hasMore}`);
    
    userPosts.posts.forEach((post, index) => {
      console.log(`   ${index + 1}. "${post.title}" (${post.status}) - ${post.wordCount} words`);
    });
    
    // Step 6: Test getting specific blog post
    console.log('\n6️⃣ Testing get specific blog post...');
    
    const specificPost = await contentService.getBlogPost(savedPost1.id, userId);
    console.log(`✅ Retrieved specific post: "${specificPost.title}"`);
    console.log(`   Status: ${specificPost.status}`);
    console.log(`   Word count: ${specificPost.wordCount}`);
    console.log(`   Content preview: ${specificPost.content?.substring(0, 100)}...`);
    
    // Step 7: Test updating blog post
    console.log('\n7️⃣ Testing blog post update...');
    
    const updatedPost = await contentService.updateBlogPost(savedPost1.id, userId, {
      title: 'How to Build AI-Powered Applications (Updated)',
      status: 'published'
    });
    
    console.log(`✅ Updated blog post: "${updatedPost.title}"`);
    console.log(`   New status: ${updatedPost.status}`);
    
    // Step 8: Test search functionality
    console.log('\n8️⃣ Testing search functionality...');
    
    const searchResults = await contentService.getUserBlogPosts(userId, {
      search: 'AI',
      limit: 10
    });
    
    console.log(`✅ Search for "AI" returned ${searchResults.posts.length} posts`);
    searchResults.posts.forEach(post => {
      console.log(`   Found: "${post.title}"`);
    });
    
    // Step 9: Test filtering by status
    console.log('\n9️⃣ Testing status filtering...');
    
    const publishedPosts = await contentService.getUserBlogPosts(userId, {
      status: 'published',
      limit: 10
    });
    
    console.log(`✅ Filter by "published" returned ${publishedPosts.posts.length} posts`);
    
    // Step 10: Test invalid operations
    console.log('\n🔟 Testing error handling...');
    
    try {
      await contentService.getBlogPost('nonexistent-id', userId);
      console.log('❌ Should have failed for non-existent post');
    } catch (error) {
      console.log('✅ Correctly rejected non-existent post:', error.message);
    }
    
    try {
      await contentService.updateBlogPost(savedPost1.id, 'wrong-user-id', { title: 'Hacked!' });
      console.log('❌ Should have failed for wrong user');
    } catch (error) {
      console.log('✅ Correctly rejected wrong user access:', error.message);
    }
    
    console.log('\n🎉 Content service test completed successfully!');
    
  } catch (error) {
    console.error('\n💥 Content service test failed:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    // Optional: Clean up test data
    console.log('\n🧹 Test data cleanup...');
    console.log(`   Created ${testPosts.length} test posts`);
    console.log('   Test data will remain for inspection');
    
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️  Content service test interrupted');
  process.exit(0);
});

// Run the test
testContentService().catch(console.error);