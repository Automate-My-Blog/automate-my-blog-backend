/**
 * Test if the webhook endpoint is accessible
 * This doesn't test the actual webhook, just that the endpoint exists
 */

console.log('\n🔍 Webhook Endpoint Diagnostic\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('1. Check webhook endpoint URL:');
const backendUrl = process.env.BACKEND_URL || 'https://automate-my-blog-backend.vercel.app';
const webhookUrl = `${backendUrl}/api/v1/stripe/webhook`;
console.log(`   ${webhookUrl}`);
console.log();

console.log('2. Check Stripe Dashboard:');
console.log('   Go to: https://dashboard.stripe.com/webhooks');
console.log('   Verify webhook is configured for:');
console.log(`   - Endpoint URL: ${webhookUrl}`);
console.log('   - Events: checkout.session.completed, customer.subscription.*');
console.log();

console.log('3. Check for failed webhook deliveries:');
console.log('   In Stripe Dashboard → Webhooks → Click your webhook');
console.log('   Look for "Attempts" section with failed deliveries');
console.log();

console.log('4. Environment Variables Status:');
console.log(`   STRIPE_SECRET_KEY: ${process.env.STRIPE_SECRET_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`   STRIPE_WEBHOOK_SECRET: ${process.env.STRIPE_WEBHOOK_SECRET ? '✅ Set' : '❌ Missing'}`);
console.log(`   STRIPE_PRICE_CREATOR: ${process.env.STRIPE_PRICE_CREATOR ? '✅ Set' : '❌ Missing'}`);
console.log(`   STRIPE_PRICE_PROFESSIONAL: ${process.env.STRIPE_PRICE_PROFESSIONAL ? '✅ Set' : '❌ Missing'}`);
console.log();

console.log('5. What you should see in Stripe logs:');
console.log('   - 200 response = webhook working ✅');
console.log('   - 400 response = signature verification failed ⚠️');
console.log('   - 500 response = server error ❌');
console.log('   - Timeout = endpoint not responding ❌');
console.log();

console.log('6. If webhook is failing:');
console.log('   a) Copy the webhook signing secret from Stripe Dashboard');
console.log('   b) Update STRIPE_WEBHOOK_SECRET in Vercel env vars');
console.log('   c) Redeploy backend');
console.log();

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
