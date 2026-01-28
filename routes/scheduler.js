import express from 'express';
import { getSchedulerStatus, runJob } from '../jobs/scheduler.js';

const router = express.Router();

/**
 * GET /api/v1/scheduler/status
 * Get status of all scheduled jobs
 */
router.get('/status', (req, res) => {
  try {
    const status = getSchedulerStatus();
    res.json({
      success: true,
      scheduler: status
    });
  } catch (error) {
    console.error('❌ Failed to get scheduler status:', error);
    res.status(500).json({
      error: 'Failed to get scheduler status',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/scheduler/run/:jobName
 * Manually run a specific job (for testing/debugging)
 *
 * Available jobs:
 * - lead_nurture
 * - credit_warnings
 * - 7day_inactive
 * - 14day_reengagement
 * - weekly_digest
 * - new_user_alerts
 * - high_value_leads
 * - expire_credits
 * - monthly_revenue
 */
router.post('/run/:jobName', async (req, res) => {
  try {
    const { jobName } = req.params;

    console.log(`🎯 Manually triggering job: ${jobName}`);
    const result = await runJob(jobName);

    res.json({
      success: true,
      job: jobName,
      result,
      message: `Job ${jobName} completed successfully`
    });
  } catch (error) {
    console.error(`❌ Failed to run job ${req.params.jobName}:`, error);
    res.status(500).json({
      error: 'Failed to run job',
      message: error.message,
      availableJobs: [
        'lead_nurture',
        'credit_warnings',
        '7day_inactive',
        '14day_reengagement',
        'weekly_digest',
        'new_user_alerts',
        'high_value_leads',
        'expire_credits',
        'monthly_revenue'
      ]
    });
  }
});

/**
 * GET /api/v1/scheduler/jobs
 * List all available jobs with descriptions
 */
router.get('/jobs', (req, res) => {
  const jobs = [
    {
      name: 'lead_nurture',
      description: 'Process lead nurture queue - sends scheduled follow-up emails to leads',
      schedule: 'Every hour',
      endpoint: 'POST /api/v1/scheduler/run/lead_nurture'
    },
    {
      name: 'credit_warnings',
      description: 'Send warnings to users with credits expiring in 7 days',
      schedule: 'Daily at 9:00 AM',
      endpoint: 'POST /api/v1/scheduler/run/credit_warnings'
    },
    {
      name: '7day_inactive',
      description: 'Send re-engagement emails to users inactive for 7 days',
      schedule: 'Daily at 10:00 AM',
      endpoint: 'POST /api/v1/scheduler/run/7day_inactive'
    },
    {
      name: '14day_reengagement',
      description: 'Send re-engagement emails to users inactive for 14 days',
      schedule: 'Daily at 10:30 AM',
      endpoint: 'POST /api/v1/scheduler/run/14day_reengagement'
    },
    {
      name: 'weekly_digest',
      description: 'Send weekly usage digests to active users',
      schedule: 'Mondays at 9:00 AM',
      endpoint: 'POST /api/v1/scheduler/run/weekly_digest'
    },
    {
      name: 'new_user_alerts',
      description: 'Alert admin of new user signups (past hour)',
      schedule: 'Every hour',
      endpoint: 'POST /api/v1/scheduler/run/new_user_alerts'
    },
    {
      name: 'high_value_leads',
      description: 'Alert admin of high-value leads (score > 80)',
      schedule: 'Every hour',
      endpoint: 'POST /api/v1/scheduler/run/high_value_leads'
    },
    {
      name: 'expire_credits',
      description: 'Expire old credits past their expiration date',
      schedule: 'Daily at midnight',
      endpoint: 'POST /api/v1/scheduler/run/expire_credits'
    },
    {
      name: 'monthly_revenue',
      description: 'Send monthly revenue and metrics summary to admin',
      schedule: '1st of each month at 9:00 AM',
      endpoint: 'POST /api/v1/scheduler/run/monthly_revenue'
    }
  ];

  res.json({
    success: true,
    totalJobs: jobs.length,
    jobs
  });
});

export default router;
