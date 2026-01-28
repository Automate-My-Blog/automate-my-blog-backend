import db from './database.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Lead Email Triggers Service
 * Automatically queues lead nurture emails based on lead scoring
 */

/**
 * Queue lead nurture email based on lead score
 * Called after lead scoring is calculated
 *
 * @param {string} leadId - Lead ID
 * @returns {Promise<object>} Queue result
 */
export async function queueLeadNurtureEmail(leadId) {
  try {
    // Get lead score
    const scoreResult = await db.query(`
      SELECT
        wl.id,
        wl.email,
        wl.website_url,
        wl.lead_source,
        wl.created_at,
        ls.total_score,
        ls.industry_fit_score,
        ls.urgency_score,
        ls.company_size_score,
        ls.engagement_score
      FROM website_leads wl
      JOIN lead_scoring ls ON ls.lead_id = wl.id
      WHERE wl.id = $1
    `, [leadId]);

    if (scoreResult.rows.length === 0) {
      console.log(`⚠️ Lead ${leadId} not found or not scored`);
      return { queued: false, reason: 'lead_not_found' };
    }

    const lead = scoreResult.rows[0];
    const score = lead.total_score;

    // Determine email type and schedule based on score
    let emailType = null;
    let scheduledFor = new Date();
    let priority = 50;

    if (score > 80) {
      // High-value lead - follow up in 1 hour (urgent!)
      emailType = 'high_lead_score_followup';
      scheduledFor.setHours(scheduledFor.getHours() + 1);
      priority = 90;
    } else if (score >= 50) {
      // Warm lead - follow up in 2 days
      emailType = 'warm_lead_nurture';
      scheduledFor.setDate(scheduledFor.getDate() + 2);
      priority = 60;
    } else {
      // Cold lead - follow up in 7 days
      emailType = 'cold_lead_reactivation';
      scheduledFor.setDate(scheduledFor.getDate() + 7);
      priority = 30;
    }

    // Check if email already queued for this lead
    const existingQueue = await db.query(`
      SELECT id, status
      FROM lead_nurture_queue
      WHERE lead_id = $1
        AND email_type = $2
        AND status IN ('pending', 'sent')
    `, [leadId, emailType]);

    if (existingQueue.rows.length > 0) {
      console.log(`⚠️ Lead ${leadId} already has ${emailType} queued/sent`);
      return { queued: false, reason: 'already_queued' };
    }

    // Create context snapshot for the email
    const contextSnapshot = {
      leadScore: score,
      industryFitScore: lead.industry_fit_score,
      urgencyScore: lead.urgency_score,
      companySizeScore: lead.company_size_score,
      engagementScore: lead.engagement_score,
      email: lead.email,
      websiteUrl: lead.website_url,
      leadSource: lead.lead_source,
      createdAt: lead.created_at
    };

    // Queue the email
    const queueId = uuidv4();
    await db.query(`
      INSERT INTO lead_nurture_queue (
        id, lead_id, email_type, scheduled_for, priority, context_snapshot
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [queueId, leadId, emailType, scheduledFor, priority, JSON.stringify(contextSnapshot)]);

    console.log(`✅ Queued ${emailType} for lead ${leadId} (score: ${score}, scheduled: ${scheduledFor.toISOString()})`);

    return {
      queued: true,
      queueId,
      emailType,
      scheduledFor,
      priority,
      score
    };

  } catch (error) {
    console.error('❌ Error queueing lead nurture email:', error);
    throw error;
  }
}

/**
 * Queue lead converted celebration email
 * Called when a lead converts to a registered user
 *
 * @param {string} leadId - Original lead ID
 * @param {string} userId - New user ID
 * @returns {Promise<object>} Queue result
 */
export async function queueLeadConvertedEmail(leadId, userId) {
  try {
    // Cancel any pending nurture emails for this lead
    await db.query(`
      UPDATE lead_nurture_queue
      SET status = 'cancelled', cancelled_at = NOW()
      WHERE lead_id = $1
        AND status = 'pending'
    `, [leadId]);

    console.log(`✅ Cancelled pending nurture emails for converted lead ${leadId}`);

    // Queue celebration email (send immediately)
    const queueId = uuidv4();
    const scheduledFor = new Date(); // Send now

    await db.query(`
      INSERT INTO lead_nurture_queue (
        id, lead_id, email_type, scheduled_for, priority, context_snapshot
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      queueId,
      leadId,
      'lead_converted_celebration',
      scheduledFor,
      100, // High priority
      JSON.stringify({ userId, leadId, convertedAt: new Date().toISOString() })
    ]);

    console.log(`✅ Queued lead_converted_celebration for lead ${leadId} -> user ${userId}`);

    return {
      queued: true,
      queueId,
      emailType: 'lead_converted_celebration',
      scheduledFor
    };

  } catch (error) {
    console.error('❌ Error queueing lead converted email:', error);
    throw error;
  }
}

/**
 * Reschedule lead nurture email (e.g., if lead engages)
 *
 * @param {string} leadId - Lead ID
 * @param {number} delayHours - Hours to delay
 * @returns {Promise<object>} Reschedule result
 */
export async function rescheduleLeadNurtureEmail(leadId, delayHours = 24) {
  try {
    const newScheduledFor = new Date();
    newScheduledFor.setHours(newScheduledFor.getHours() + delayHours);

    const result = await db.query(`
      UPDATE lead_nurture_queue
      SET scheduled_for = $1
      WHERE lead_id = $2
        AND status = 'pending'
      RETURNING id, email_type
    `, [newScheduledFor, leadId]);

    if (result.rows.length > 0) {
      console.log(`✅ Rescheduled ${result.rows.length} emails for lead ${leadId} to ${newScheduledFor.toISOString()}`);
      return { rescheduled: true, count: result.rows.length, newScheduledFor };
    } else {
      console.log(`⚠️ No pending emails to reschedule for lead ${leadId}`);
      return { rescheduled: false, reason: 'no_pending_emails' };
    }

  } catch (error) {
    console.error('❌ Error rescheduling lead nurture email:', error);
    throw error;
  }
}

/**
 * Cancel all pending lead nurture emails
 *
 * @param {string} leadId - Lead ID
 * @returns {Promise<object>} Cancel result
 */
export async function cancelLeadNurtureEmails(leadId) {
  try {
    const result = await db.query(`
      UPDATE lead_nurture_queue
      SET status = 'cancelled', cancelled_at = NOW()
      WHERE lead_id = $1
        AND status = 'pending'
      RETURNING id, email_type
    `, [leadId]);

    if (result.rows.length > 0) {
      console.log(`✅ Cancelled ${result.rows.length} emails for lead ${leadId}`);
      return { cancelled: true, count: result.rows.length };
    } else {
      console.log(`⚠️ No pending emails to cancel for lead ${leadId}`);
      return { cancelled: false, reason: 'no_pending_emails' };
    }

  } catch (error) {
    console.error('❌ Error cancelling lead nurture emails:', error);
    throw error;
  }
}

export default {
  queueLeadNurtureEmail,
  queueLeadConvertedEmail,
  rescheduleLeadNurtureEmail,
  cancelLeadNurtureEmails
};
