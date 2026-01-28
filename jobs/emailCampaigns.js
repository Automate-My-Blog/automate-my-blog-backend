import db from '../services/database.js';
import emailService from '../services/email.js';

/**
 * Email Campaign Jobs
 * Automated email campaigns for re-engagement, lead nurture, and admin alerts
 */

/**
 * Send 7-day inactive reminder to users who haven't logged in for 7 days
 * Run daily at 10:00 AM
 */
export async function send7DayInactiveReminders() {
  try {
    console.log('📧 Running 7-day inactive reminder job...');

    // Find users who:
    // - Last logged in exactly 7 days ago (within a 25-hour window to account for job timing)
    // - Haven't been sent this email in the last 30 days (avoid spam)
    // - Are not unsubscribed from re-engagement emails
    const result = await db.query(`
      SELECT
        u.id,
        u.email,
        u.first_name,
        u.last_login_at,
        el.created_at as last_reengagement_email
      FROM users u
      LEFT JOIN email_logs el ON el.user_id = u.id
        AND el.email_type = '7_day_inactive_reminder'
        AND el.created_at > NOW() - INTERVAL '30 days'
      WHERE u.last_login_at BETWEEN NOW() - INTERVAL '8 days' AND NOW() - INTERVAL '7 days'
        AND u.last_login_at IS NOT NULL
        AND (u.unsubscribed_from IS NULL OR NOT u.unsubscribed_from @> '["reengagement"]'::jsonb)
        AND el.id IS NULL
      LIMIT 100
    `);

    console.log(`📊 Found ${result.rows.length} inactive users (7 days)`);

    let sentCount = 0;
    let failedCount = 0;

    for (const user of result.rows) {
      try {
        await emailService.send7DayInactiveReminder(user.id);
        sentCount++;
        console.log(`  ✅ Sent to ${user.email}`);
      } catch (error) {
        failedCount++;
        console.error(`  ❌ Failed for ${user.email}:`, error.message);
      }
    }

    console.log(`✅ 7-day inactive reminders: ${sentCount} sent, ${failedCount} failed`);
    return { sent: sentCount, failed: failedCount };

  } catch (error) {
    console.error('❌ Error in 7-day inactive reminder job:', error);
    throw error;
  }
}

/**
 * Send 14-day re-engagement email to users who haven't logged in for 14 days
 * Run daily at 10:30 AM
 */
export async function send14DayReengagementEmails() {
  try {
    console.log('📧 Running 14-day re-engagement job...');

    // Find users who:
    // - Last logged in exactly 14 days ago (within a 25-hour window)
    // - Haven't been sent this email in the last 60 days
    // - Are not unsubscribed from re-engagement emails
    const result = await db.query(`
      SELECT
        u.id,
        u.email,
        u.first_name,
        u.last_login_at,
        el.created_at as last_reengagement_email
      FROM users u
      LEFT JOIN email_logs el ON el.user_id = u.id
        AND el.email_type = '14_day_reengagement'
        AND el.created_at > NOW() - INTERVAL '60 days'
      WHERE u.last_login_at BETWEEN NOW() - INTERVAL '15 days' AND NOW() - INTERVAL '14 days'
        AND u.last_login_at IS NOT NULL
        AND (u.unsubscribed_from IS NULL OR NOT u.unsubscribed_from @> '["reengagement"]'::jsonb)
        AND el.id IS NULL
      LIMIT 100
    `);

    console.log(`📊 Found ${result.rows.length} inactive users (14 days)`);

    let sentCount = 0;
    let failedCount = 0;

    for (const user of result.rows) {
      try {
        await emailService.send14DayReengagement(user.id);
        sentCount++;
        console.log(`  ✅ Sent to ${user.email}`);
      } catch (error) {
        failedCount++;
        console.error(`  ❌ Failed for ${user.email}:`, error.message);
      }
    }

    console.log(`✅ 14-day re-engagement: ${sentCount} sent, ${failedCount} failed`);
    return { sent: sentCount, failed: failedCount };

  } catch (error) {
    console.error('❌ Error in 14-day re-engagement job:', error);
    throw error;
  }
}

/**
 * Process lead nurture queue - sends scheduled lead follow-up emails
 * Run every hour
 */
export async function processLeadNurtureQueue() {
  try {
    console.log('📧 Running lead nurture queue processor...');

    // Find leads scheduled to receive emails now
    const result = await db.query(`
      SELECT
        lnq.id as queue_id,
        lnq.lead_id,
        lnq.email_type,
        lnq.context_snapshot,
        lnq.priority,
        wl.email,
        wl.website_url
      FROM lead_nurture_queue lnq
      JOIN website_leads wl ON wl.id = lnq.lead_id
      WHERE lnq.status = 'pending'
        AND lnq.scheduled_for <= NOW()
        AND lnq.cancelled_at IS NULL
      ORDER BY lnq.priority DESC, lnq.scheduled_for ASC
      LIMIT 50
    `);

    console.log(`📊 Found ${result.rows.length} leads ready for nurture emails`);

    let sentCount = 0;
    let failedCount = 0;

    for (const item of result.rows) {
      try {
        // Send appropriate email based on type
        switch (item.email_type) {
          case 'high_lead_score_followup':
            await emailService.sendHighLeadScoreFollowup(item.lead_id);
            break;
          case 'warm_lead_nurture':
            await emailService.sendWarmLeadNurture(item.lead_id);
            break;
          case 'cold_lead_reactivation':
            await emailService.sendColdLeadReactivation(item.lead_id);
            break;
          default:
            console.warn(`  ⚠️ Unknown email type: ${item.email_type}`);
            continue;
        }

        // Mark as sent
        await db.query(`
          UPDATE lead_nurture_queue
          SET status = 'sent', sent_at = NOW()
          WHERE id = $1
        `, [item.queue_id]);

        sentCount++;
        console.log(`  ✅ Sent ${item.email_type} to ${item.email}`);

      } catch (error) {
        failedCount++;
        console.error(`  ❌ Failed for lead ${item.lead_id}:`, error.message);

        // Mark as failed but don't remove from queue
        await db.query(`
          UPDATE lead_nurture_queue
          SET status = 'failed'
          WHERE id = $1
        `, [item.queue_id]);
      }
    }

    console.log(`✅ Lead nurture queue: ${sentCount} sent, ${failedCount} failed`);
    return { sent: sentCount, failed: failedCount };

  } catch (error) {
    console.error('❌ Error in lead nurture queue processor:', error);
    throw error;
  }
}

/**
 * Send credit expiration warnings (7 days before expiration)
 * Run daily at 9:00 AM
 */
export async function sendCreditExpirationWarnings() {
  try {
    console.log('📧 Running credit expiration warning job...');

    // Find users with credits expiring in 7 days who haven't been warned
    const result = await db.query(`
      SELECT
        uc.user_id,
        u.email,
        u.first_name,
        COUNT(*) as expiring_credits,
        MIN(uc.expires_at) as earliest_expiration
      FROM user_credits uc
      JOIN users u ON u.id = uc.user_id
      WHERE uc.status = 'active'
        AND uc.expires_at BETWEEN NOW() + INTERVAL '6 days' AND NOW() + INTERVAL '8 days'
        AND uc.expiration_warning_sent_at IS NULL
        AND (u.unsubscribed_from IS NULL OR NOT u.unsubscribed_from @> '["engagement"]'::jsonb)
      GROUP BY uc.user_id, u.email, u.first_name
      LIMIT 100
    `);

    console.log(`📊 Found ${result.rows.length} users with expiring credits`);

    let sentCount = 0;
    let failedCount = 0;

    for (const user of result.rows) {
      try {
        await emailService.sendCreditExpirationWarning(
          user.user_id,
          user.expiring_credits,
          new Date(user.earliest_expiration)
        );

        // Mark credits as warned
        await db.query(`
          UPDATE user_credits
          SET expiration_warning_sent_at = NOW()
          WHERE user_id = $1
            AND status = 'active'
            AND expires_at BETWEEN NOW() + INTERVAL '6 days' AND NOW() + INTERVAL '8 days'
        `, [user.user_id]);

        sentCount++;
        console.log(`  ✅ Sent to ${user.email} (${user.expiring_credits} credits)`);

      } catch (error) {
        failedCount++;
        console.error(`  ❌ Failed for ${user.email}:`, error.message);
      }
    }

    console.log(`✅ Credit expiration warnings: ${sentCount} sent, ${failedCount} failed`);
    return { sent: sentCount, failed: failedCount };

  } catch (error) {
    console.error('❌ Error in credit expiration warning job:', error);
    throw error;
  }
}

/**
 * Send weekly usage digest to active users
 * Run every Monday at 9:00 AM
 */
export async function sendWeeklyUsageDigests() {
  try {
    console.log('📧 Running weekly usage digest job...');

    // Find users who:
    // - Generated at least 1 post in the last 7 days
    // - Are not unsubscribed from engagement emails
    const result = await db.query(`
      SELECT
        u.id,
        u.email,
        u.first_name,
        COUNT(DISTINCT bp.id) as posts_generated
      FROM users u
      JOIN blog_posts bp ON bp.user_id = u.id
      WHERE bp.created_at >= NOW() - INTERVAL '7 days'
        AND (u.unsubscribed_from IS NULL OR NOT u.unsubscribed_from @> '["engagement"]'::jsonb)
      GROUP BY u.id, u.email, u.first_name
      HAVING COUNT(DISTINCT bp.id) >= 1
      LIMIT 200
    `);

    console.log(`📊 Found ${result.rows.length} active users for weekly digest`);

    let sentCount = 0;
    let failedCount = 0;

    for (const user of result.rows) {
      try {
        await emailService.sendUsageDigest(user.id);
        sentCount++;
        console.log(`  ✅ Sent to ${user.email}`);
      } catch (error) {
        failedCount++;
        console.error(`  ❌ Failed for ${user.email}:`, error.message);
      }
    }

    console.log(`✅ Weekly usage digests: ${sentCount} sent, ${failedCount} failed`);
    return { sent: sentCount, failed: failedCount };

  } catch (error) {
    console.error('❌ Error in weekly usage digest job:', error);
    throw error;
  }
}

/**
 * Send new user signup alerts to admin
 * Run every hour (catches signups from the past hour)
 */
export async function sendNewUserSignupAlerts() {
  try {
    console.log('📧 Running new user signup alert job...');

    // Find users created in the last hour who haven't had an alert sent
    const result = await db.query(`
      SELECT
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.created_at
      FROM users u
      LEFT JOIN email_logs el ON el.user_id = u.id
        AND el.email_type = 'new_user_signup_alert'
      WHERE u.created_at >= NOW() - INTERVAL '1 hour'
        AND el.id IS NULL
      LIMIT 50
    `);

    console.log(`📊 Found ${result.rows.length} new signups to alert admin`);

    let sentCount = 0;
    let failedCount = 0;

    for (const user of result.rows) {
      try {
        await emailService.sendNewUserSignupAlert(user.id);
        sentCount++;
        console.log(`  ✅ Alert sent for ${user.email}`);
      } catch (error) {
        failedCount++;
        console.error(`  ❌ Failed for ${user.email}:`, error.message);
      }
    }

    console.log(`✅ New user signup alerts: ${sentCount} sent, ${failedCount} failed`);
    return { sent: sentCount, failed: failedCount };

  } catch (error) {
    console.error('❌ Error in new user signup alert job:', error);
    throw error;
  }
}

/**
 * Send high-value lead notifications to admin
 * Run every hour (catches high-scoring leads from the past hour)
 */
export async function sendHighValueLeadNotifications() {
  try {
    console.log('📧 Running high-value lead notification job...');

    // Find leads with score > 80 created in the last hour who haven't had an alert sent
    const result = await db.query(`
      SELECT
        wl.id,
        wl.email,
        wl.website_url,
        ls.total_score
      FROM website_leads wl
      JOIN lead_scoring ls ON ls.lead_id = wl.id
      LEFT JOIN email_logs el ON el.recipient_email = wl.email
        AND el.email_type = 'high_value_lead_notification'
      WHERE ls.total_score > 80
        AND wl.created_at >= NOW() - INTERVAL '1 hour'
        AND el.id IS NULL
      LIMIT 20
    `);

    console.log(`📊 Found ${result.rows.length} high-value leads to alert admin`);

    let sentCount = 0;
    let failedCount = 0;

    for (const lead of result.rows) {
      try {
        await emailService.sendHighValueLeadNotification(lead.id);
        sentCount++;
        console.log(`  ✅ Alert sent for ${lead.email} (score: ${lead.total_score})`);
      } catch (error) {
        failedCount++;
        console.error(`  ❌ Failed for lead ${lead.id}:`, error.message);
      }
    }

    console.log(`✅ High-value lead notifications: ${sentCount} sent, ${failedCount} failed`);
    return { sent: sentCount, failed: failedCount };

  } catch (error) {
    console.error('❌ Error in high-value lead notification job:', error);
    throw error;
  }
}

/**
 * Send monthly revenue summary to admin
 * Run on 1st of each month at 9:00 AM
 */
export async function sendMonthlyRevenueSummary() {
  try {
    console.log('📧 Running monthly revenue summary job...');

    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const monthName = lastMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

    // Calculate total revenue from Stripe payments (last month)
    const revenueResult = await db.query(`
      SELECT
        COALESCE(SUM(CAST(amount AS DECIMAL) / 100), 0) as total_revenue,
        COUNT(DISTINCT user_id) as paying_users,
        COUNT(*) as total_transactions
      FROM stripe_payments
      WHERE status = 'succeeded'
        AND created_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
        AND created_at < DATE_TRUNC('month', NOW())
    `);

    // Get new subscriptions count
    const newSubsResult = await db.query(`
      SELECT COUNT(*) as new_subscriptions
      FROM users
      WHERE plan_tier != 'free'
        AND created_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
        AND created_at < DATE_TRUNC('month', NOW())
    `);

    // Get churned subscriptions (downgraded to free)
    const churnedResult = await db.query(`
      SELECT COUNT(*) as churned_subscriptions
      FROM users
      WHERE plan_tier = 'free'
        AND updated_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
        AND updated_at < DATE_TRUNC('month', NOW())
        AND created_at < DATE_TRUNC('month', NOW() - INTERVAL '1 month')
    `);

    // Get credits purchased vs used
    const creditsResult = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE source = 'purchase') as credits_purchased,
        COUNT(*) FILTER (WHERE status = 'used') as credits_used,
        COUNT(*) FILTER (WHERE status = 'expired') as credits_expired
      FROM user_credits
      WHERE created_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
        AND created_at < DATE_TRUNC('month', NOW())
    `);

    // Get blog posts generated count
    const postsResult = await db.query(`
      SELECT COUNT(*) as posts_generated
      FROM blog_posts
      WHERE created_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
        AND created_at < DATE_TRUNC('month', NOW())
    `);

    // Get new user signups
    const signupsResult = await db.query(`
      SELECT COUNT(*) as new_signups
      FROM users
      WHERE created_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
        AND created_at < DATE_TRUNC('month', NOW())
    `);

    // Get comparison to previous month
    const prevRevenueResult = await db.query(`
      SELECT COALESCE(SUM(CAST(amount AS DECIMAL) / 100), 0) as prev_revenue
      FROM stripe_payments
      WHERE status = 'succeeded'
        AND created_at >= DATE_TRUNC('month', NOW() - INTERVAL '2 months')
        AND created_at < DATE_TRUNC('month', NOW() - INTERVAL '1 month')
    `);

    const revenue = parseFloat(revenueResult.rows[0].total_revenue) || 0;
    const prevRevenue = parseFloat(prevRevenueResult.rows[0].prev_revenue) || 0;
    const revenueGrowth = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : 0;

    const metrics = {
      month: monthName,
      totalRevenue: revenue,
      previousMonthRevenue: prevRevenue,
      revenueGrowth: revenueGrowth.toFixed(1),
      payingUsers: parseInt(revenueResult.rows[0].paying_users) || 0,
      totalTransactions: parseInt(revenueResult.rows[0].total_transactions) || 0,
      newSubscriptions: parseInt(newSubsResult.rows[0].new_subscriptions) || 0,
      churnedSubscriptions: parseInt(churnedResult.rows[0].churned_subscriptions) || 0,
      creditsPurchased: parseInt(creditsResult.rows[0].credits_purchased) || 0,
      creditsUsed: parseInt(creditsResult.rows[0].credits_used) || 0,
      creditsExpired: parseInt(creditsResult.rows[0].credits_expired) || 0,
      postsGenerated: parseInt(postsResult.rows[0].posts_generated) || 0,
      newSignups: parseInt(signupsResult.rows[0].new_signups) || 0
    };

    console.log(`📊 Monthly Revenue Summary for ${monthName}:`, metrics);

    // Send to admin
    await emailService.sendMonthlyRevenueSummary(metrics);

    console.log(`✅ Monthly revenue summary sent to admin`);
    return { sent: true, metrics };

  } catch (error) {
    console.error('❌ Error in monthly revenue summary job:', error);
    throw error;
  }
}
