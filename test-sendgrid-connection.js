import dotenv from 'dotenv';
import sgMail from '@sendgrid/mail';

dotenv.config();

/**
 * Simple SendGrid connection test
 * Sends a test email to verify API key and DNS configuration
 */

async function testSendGridConnection() {
  try {
    console.log('🧪 Testing SendGrid Connection...\n');

    // Check if API key is configured
    if (!process.env.SENDGRID_API_KEY || process.env.SENDGRID_API_KEY.includes('xxxxx')) {
      console.error('❌ SENDGRID_API_KEY not configured in .env file');
      process.exit(1);
    }

    // Initialize SendGrid
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    console.log('✅ SendGrid API key loaded');
    console.log(`📧 From: ${process.env.SENDGRID_FROM_EMAIL}`);
    console.log(`👤 From Name: ${process.env.SENDGRID_FROM_NAME}`);
    console.log(`↩️  Reply-To: ${process.env.SENDGRID_REPLY_TO_EMAIL}\n`);

    // Prompt for recipient email
    const recipientEmail = process.env.TEST_EMAIL || 'james@frankel.tv';

    console.log(`📬 Sending test email to: ${recipientEmail}\n`);

    const msg = {
      to: recipientEmail,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL,
        name: process.env.SENDGRID_FROM_NAME
      },
      replyTo: process.env.SENDGRID_REPLY_TO_EMAIL,
      subject: 'SendGrid Test Email - AutoBlog',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #333;">SendGrid Connection Test</h1>
          <p style="color: #666; font-size: 16px; line-height: 1.5;">
            This is a test email from your AutoBlog email system.
          </p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>✅ SendGrid API:</strong> Connected</p>
            <p style="margin: 5px 0;"><strong>✅ DNS Records:</strong> Verified</p>
            <p style="margin: 5px 0;"><strong>✅ Email Delivery:</strong> Working</p>
          </div>
          <p style="color: #666; font-size: 14px;">
            If you received this email, your SendGrid integration is working correctly!
          </p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
          <p style="color: #999; font-size: 12px;">
            Sent from AutoBlog Email System<br>
            ${new Date().toISOString()}
          </p>
        </div>
      `,
      text: `
SendGrid Connection Test

This is a test email from your AutoBlog email system.

✅ SendGrid API: Connected
✅ DNS Records: Verified
✅ Email Delivery: Working

If you received this email, your SendGrid integration is working correctly!

Sent from AutoBlog Email System
${new Date().toISOString()}
      `
    };

    // Send email
    const response = await sgMail.send(msg);

    console.log('✅ Email sent successfully!\n');
    console.log('📊 Response Details:');
    console.log(`   Status Code: ${response[0].statusCode}`);
    console.log(`   Message ID: ${response[0].headers['x-message-id']}`);
    console.log(`\n📬 Check ${recipientEmail} for the test email\n`);

  } catch (error) {
    console.error('❌ SendGrid Test Failed:\n');

    if (error.response) {
      console.error(`   Status: ${error.response.statusCode}`);
      console.error(`   Body: ${JSON.stringify(error.response.body, null, 2)}`);
    } else {
      console.error(`   Error: ${error.message}`);
    }

    console.error('\n🔍 Troubleshooting:');
    console.error('   1. Verify SENDGRID_API_KEY in .env file');
    console.error('   2. Check SendGrid API key has "Full Access" permissions');
    console.error('   3. Verify domain authentication in SendGrid dashboard');
    console.error('   4. Ensure SPF record is added to DNS\n');

    process.exit(1);
  }
}

testSendGridConnection();
