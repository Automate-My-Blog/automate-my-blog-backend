import founderEmailGenerator from '../services/founderEmailGenerator.js';
import db from '../services/database.js';

/**
 * Test founder welcome email generation with real data
 * Usage: node scripts/test-founder-welcome-generation.js <email>
 */

async function testFounderWelcomeGeneration() {
  try {
    const testEmail = process.argv[2] || 'james@frankel.tv';

    console.log(`🧪 Testing founder welcome email generation for: ${testEmail}\n`);

    // Get user by email
    const userResult = await db.query(`
      SELECT id, email, first_name, last_name, created_at, first_login_at
      FROM users
      WHERE email = $1
    `, [testEmail]);

    if (userResult.rows.length === 0) {
      console.error(`❌ User not found: ${testEmail}`);
      process.exit(1);
    }

    const user = userResult.rows[0];
    console.log('User Details:');
    console.log(`  ID: ${user.id}`);
    console.log(`  Name: ${user.first_name} ${user.last_name}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Signed Up: ${user.created_at}`);
    console.log(`  First Login: ${user.first_login_at || 'Not set'}`);

    // Check if they've generated posts
    const postResult = await db.query(`
      SELECT COUNT(*) as post_count, title as latest_post_title
      FROM blog_posts
      WHERE user_id = $1
      GROUP BY title
      ORDER BY MAX(created_at) DESC
      LIMIT 1
    `, [user.id]);

    const postCount = postResult.rows.length > 0 ? parseInt(postResult.rows[0].post_count) : 0;
    const latestPostTitle = postResult.rows.length > 0 ? postResult.rows[0].latest_post_title : null;

    console.log(`  Posts Generated: ${postCount}`);
    if (latestPostTitle) {
      console.log(`  Latest Post: "${latestPostTitle}"`);
    }
    console.log('');

    // Generate email
    console.log('📧 Generating founder welcome email draft...\n');
    const result = await founderEmailGenerator.generateWelcomeEmail(user.id);

    console.log('✅ Email draft generated!');
    console.log(`   Draft ID: ${result.id}`);
    console.log(`   Recipient: ${result.recipientEmail}`);
    console.log(`   Has Generated Post: ${result.hasGeneratedPost}`);
    console.log(`   Subject: ${result.subject}`);
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log('Email Body (Plain Text):');
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    console.log(result.bodyPlainText);
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    console.log(`Draft stored in pending_founder_emails table.`);
    console.log(`Review at: ${process.env.FRONTEND_URL}/admin/pending-emails/${result.id}\n`);

    // Show HTML version
    console.log('HTML Version:');
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(result.bodyHtml);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

testFounderWelcomeGeneration();
