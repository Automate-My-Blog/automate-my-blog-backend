import cron from 'node-cron';
import {
  send7DayInactiveReminders,
  send14DayReengagementEmails,
  processLeadNurtureQueue,
  sendCreditExpirationWarnings,
  sendWeeklyUsageDigests,
  sendNewUserSignupAlerts,
  sendHighValueLeadNotifications,
  sendMonthlyRevenueSummary,
  generateFounderWelcomeEmails
} from './emailCampaigns.js';
import { expireOldCredits } from './expireCredits.js';
import {
  fetchAllGoogleData,
  fetchTrendsDataForAllUsers,
  fetchSearchConsoleDataForAllUsers,
  fetchAnalyticsDataForAllUsers
} from './googleDataFetcher.js';
import { trackContentPerformance, getPerformanceInsights } from './performanceTracker.js';
import { processContentCalendarScheduledPosts } from './contentCalendarScheduler.js';

/**
 * Email Campaign Scheduler
 * Manages all scheduled email jobs using node-cron
 *
 * Schedule Format: * * * * * (second minute hour day month dayOfWeek)
 * - 0 9 * * * = Every day at 9:00 AM
 * - 0 * * * * = Every hour at :00
 * - 0 9 * * 1 = Every Monday at 9:00 AM
 */

let scheduledJobs = [];

/**
 * Start all scheduled email campaigns
 */
export function startEmailScheduler() {
  console.log('🚀 Starting email campaign scheduler...\n');

  // Job 1: Process lead nurture queue - Every hour
  const leadNurtureJob = cron.schedule('0 * * * *', async () => {
    console.log('\n⏰ [SCHEDULED] Lead Nurture Queue Processor');
    try {
      await processLeadNurtureQueue();
    } catch (error) {
      console.error('❌ Lead nurture queue job failed:', error);
    }
  });
  scheduledJobs.push({ name: 'Lead Nurture Queue', schedule: 'Every hour', job: leadNurtureJob });

  // Job 2: Credit expiration warnings - Daily at 9:00 AM
  const creditWarningsJob = cron.schedule('0 9 * * *', async () => {
    console.log('\n⏰ [SCHEDULED] Credit Expiration Warnings');
    try {
      await sendCreditExpirationWarnings();
    } catch (error) {
      console.error('❌ Credit expiration warnings job failed:', error);
    }
  });
  scheduledJobs.push({ name: 'Credit Expiration Warnings', schedule: 'Daily at 9:00 AM', job: creditWarningsJob });

  // Job 3: 7-day inactive reminders - Daily at 10:00 AM
  const inactive7DayJob = cron.schedule('0 10 * * *', async () => {
    console.log('\n⏰ [SCHEDULED] 7-Day Inactive Reminders');
    try {
      await send7DayInactiveReminders();
    } catch (error) {
      console.error('❌ 7-day inactive reminders job failed:', error);
    }
  });
  scheduledJobs.push({ name: '7-Day Inactive Reminders', schedule: 'Daily at 10:00 AM', job: inactive7DayJob });

  // Job 4: 14-day re-engagement - Daily at 10:30 AM
  const reengagement14DayJob = cron.schedule('30 10 * * *', async () => {
    console.log('\n⏰ [SCHEDULED] 14-Day Re-engagement Emails');
    try {
      await send14DayReengagementEmails();
    } catch (error) {
      console.error('❌ 14-day re-engagement job failed:', error);
    }
  });
  scheduledJobs.push({ name: '14-Day Re-engagement', schedule: 'Daily at 10:30 AM', job: reengagement14DayJob });

  // Job 5: Weekly usage digests - Every Monday at 9:00 AM
  const weeklyDigestJob = cron.schedule('0 9 * * 1', async () => {
    console.log('\n⏰ [SCHEDULED] Weekly Usage Digests');
    try {
      await sendWeeklyUsageDigests();
    } catch (error) {
      console.error('❌ Weekly usage digests job failed:', error);
    }
  });
  scheduledJobs.push({ name: 'Weekly Usage Digests', schedule: 'Mondays at 9:00 AM', job: weeklyDigestJob });

  // Job 6: New user signup alerts - Every hour
  const newUserAlertsJob = cron.schedule('0 * * * *', async () => {
    console.log('\n⏰ [SCHEDULED] New User Signup Alerts');
    try {
      await sendNewUserSignupAlerts();
    } catch (error) {
      console.error('❌ New user signup alerts job failed:', error);
    }
  });
  scheduledJobs.push({ name: 'New User Signup Alerts', schedule: 'Every hour', job: newUserAlertsJob });

  // Job 6.5: Founder welcome generation - Every 10 minutes
  const founderWelcomeJob = cron.schedule('*/10 * * * *', async () => {
    console.log('\n⏰ [SCHEDULED] Founder Welcome Email Generation (24-min)');
    try {
      await generateFounderWelcomeEmails();
    } catch (error) {
      console.error('❌ Founder welcome generation job failed:', error);
    }
  });
  scheduledJobs.push({
    name: 'Founder Welcome Generation (24-min)',
    schedule: 'Every 10 minutes',
    job: founderWelcomeJob
  });

  // Job 7: High-value lead notifications - Every hour
  const highValueLeadAlertsJob = cron.schedule('0 * * * *', async () => {
    console.log('\n⏰ [SCHEDULED] High-Value Lead Notifications');
    try {
      await sendHighValueLeadNotifications();
    } catch (error) {
      console.error('❌ High-value lead notifications job failed:', error);
    }
  });
  scheduledJobs.push({ name: 'High-Value Lead Notifications', schedule: 'Every hour', job: highValueLeadAlertsJob });

  // Job 8: Expire old credits - Daily at midnight
  const expireCreditsJob = cron.schedule('0 0 * * *', async () => {
    console.log('\n⏰ [SCHEDULED] Expire Old Credits');
    try {
      await expireOldCredits();
    } catch (error) {
      console.error('❌ Expire credits job failed:', error);
    }
  });
  scheduledJobs.push({ name: 'Expire Old Credits', schedule: 'Daily at midnight', job: expireCreditsJob });

  // Job 9: Monthly revenue summary - 1st of each month at 9:00 AM
  const monthlyRevenueSummaryJob = cron.schedule('0 9 1 * *', async () => {
    console.log('\n⏰ [SCHEDULED] Monthly Revenue Summary');
    try {
      await sendMonthlyRevenueSummary();
    } catch (error) {
      console.error('❌ Monthly revenue summary job failed:', error);
    }
  });
  scheduledJobs.push({ name: 'Monthly Revenue Summary', schedule: '1st of each month at 9:00 AM', job: monthlyRevenueSummaryJob });

  // Job 10: Fetch all Google data (Trends, Search Console, Analytics) - Daily at 6:00 AM
  const googleDataFetchJob = cron.schedule('0 6 * * *', async () => {
    console.log('\n⏰ [SCHEDULED] Google Data Fetch (Trends + GSC + Analytics)');
    try {
      await fetchAllGoogleData();
    } catch (error) {
      console.error('❌ Google data fetch job failed:', error);
    }
  });
  scheduledJobs.push({ name: 'Google Data Fetch', schedule: 'Daily at 6:00 AM', job: googleDataFetchJob });

  // Job 11: Track content performance - Weekly on Mondays at 7:00 AM
  const contentPerformanceJob = cron.schedule('0 7 * * 1', async () => {
    console.log('\n⏰ [SCHEDULED] Content Performance Tracking');
    try {
      await trackContentPerformance();
    } catch (error) {
      console.error('❌ Content performance tracking job failed:', error);
    }
  });
  scheduledJobs.push({ name: 'Content Performance Tracking', schedule: 'Weekly on Mondays at 7:00 AM', job: contentPerformanceJob });

  // Job 12: Content calendar scheduled posts - Daily at 8:00 AM (create posts for "today's" calendar day)
  const contentCalendarPostsJob = cron.schedule('0 8 * * *', async () => {
    console.log('\n⏰ [SCHEDULED] Content Calendar Scheduled Posts');
    try {
      const { enqueued, due, errors } = await processContentCalendarScheduledPosts();
      if (errors.length > 0) {
        console.warn('📅 Content calendar scheduler had errors:', errors.slice(0, 5));
      }
    } catch (error) {
      console.error('❌ Content calendar scheduled posts job failed:', error);
    }
  });
  scheduledJobs.push({ name: 'Content Calendar Scheduled Posts', schedule: 'Daily at 8:00 AM', job: contentCalendarPostsJob });

  // Print schedule summary
  console.log('✅ Email campaign scheduler started!\n');
  console.log('📋 Scheduled Jobs:');
  scheduledJobs.forEach((job, index) => {
    console.log(`   ${index + 1}. ${job.name} - ${job.schedule}`);
  });
  console.log('\n');
}

/**
 * Get status of all scheduled jobs
 */
export function getSchedulerStatus() {
  return {
    active: scheduledJobs.length > 0,
    jobs: scheduledJobs.map(job => ({
      name: job.name,
      schedule: job.schedule,
      running: true
    }))
  };
}

/**
 * Manually run a specific job (for testing)
 */
export async function runJob(jobName) {
  const jobMap = {
    'lead_nurture': processLeadNurtureQueue,
    'credit_warnings': sendCreditExpirationWarnings,
    '7day_inactive': send7DayInactiveReminders,
    '14day_reengagement': send14DayReengagementEmails,
    'weekly_digest': sendWeeklyUsageDigests,
    'new_user_alerts': sendNewUserSignupAlerts,
    'high_value_leads': sendHighValueLeadNotifications,
    'expire_credits': expireOldCredits,
    'monthly_revenue': sendMonthlyRevenueSummary,
    'founder_welcome': generateFounderWelcomeEmails,
    'google_data_fetch': fetchAllGoogleData,
    'google_trends_fetch': fetchTrendsDataForAllUsers,
    'google_search_console_fetch': fetchSearchConsoleDataForAllUsers,
    'google_analytics_fetch': fetchAnalyticsDataForAllUsers,
    'content_performance_tracking': trackContentPerformance,
    'content_calendar_scheduled_posts': processContentCalendarScheduledPosts
  };

  const job = jobMap[jobName];
  if (!job) {
    throw new Error(`Unknown job: ${jobName}. Available: ${Object.keys(jobMap).join(', ')}`);
  }

  console.log(`🎯 Manually running job: ${jobName}`);
  return await job();
}

export default {
  startEmailScheduler,
  getSchedulerStatus,
  runJob
};
