import express from 'express';
import db from '../services/database.js';
import emailService from '../services/email.js';

const router = express.Router();

/**
 * Founder Email Review & Send API Routes
 * Routes for James to review and send LLM-generated founder welcome emails
 */

/**
 * GET /api/v1/admin/pending-founder-emails
 * Get all pending founder emails for review
 */
router.get('/api/v1/admin/pending-founder-emails', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        pfe.*,
        u.email as user_email,
        u.first_name,
        u.last_name
      FROM pending_founder_emails pfe
      JOIN users u ON u.id = pfe.user_id
      WHERE pfe.status = 'pending'
      ORDER BY pfe.generated_at DESC
    `);

    res.json({
      success: true,
      emails: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('❌ Failed to fetch pending founder emails:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/admin/pending-founder-emails/:emailId
 * Get a specific pending founder email by ID
 */
router.get('/api/v1/admin/pending-founder-emails/:emailId', async (req, res) => {
  try {
    const { emailId } = req.params;

    const result = await db.query(`
      SELECT
        pfe.*,
        u.email as user_email,
        u.first_name,
        u.last_name,
        u.first_login_at
      FROM pending_founder_emails pfe
      JOIN users u ON u.id = pfe.user_id
      WHERE pfe.id = $1
    `, [emailId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Email not found'
      });
    }

    res.json({
      success: true,
      email: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Failed to fetch founder email:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/admin/send-founder-email/:emailId
 * Send a pending founder email (manually triggered by James)
 * Body: { editedSubject?, editedBody? } - optional edits before sending
 */
router.post('/api/v1/admin/send-founder-email/:emailId', async (req, res) => {
  try {
    const { emailId } = req.params;
    const { editedSubject, editedBody } = req.body;

    console.log(`📤 Sending founder email ${emailId}...`);

    // Get the email draft
    const emailResult = await db.query(`
      SELECT * FROM pending_founder_emails WHERE id = $1
    `, [emailId]);

    if (emailResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Email not found'
      });
    }

    const draft = emailResult.rows[0];

    // Check if already sent
    if (draft.status === 'sent') {
      return res.status(400).json({
        success: false,
        error: 'Email has already been sent'
      });
    }

    // Use edited version or original
    const finalSubject = editedSubject || draft.subject;
    const finalBodyPlainText = editedBody || draft.body_plain_text;

    // Convert plain text to HTML (simple paragraph formatting)
    const finalBodyHtml = finalBodyPlainText
      .split('\n\n')
      .map(para => `<p>${para.trim()}</p>`)
      .join('\n');

    // Send the email directly using emailService
    const sendResult = await emailService.sendDirect({
      from: {
        email: 'james@automatemyblog.com',
        name: 'James'
      },
      to: draft.recipient_email,
      subject: finalSubject,
      text: finalBodyPlainText,
      html: finalBodyHtml
    });

    // Mark as sent
    await db.query(`
      UPDATE pending_founder_emails
      SET
        status = 'sent',
        sent_at = NOW(),
        reviewed_at = NOW(),
        subject = $1,
        body_plain_text = $2,
        body_html = $3
      WHERE id = $4
    `, [finalSubject, finalBodyPlainText, finalBodyHtml, emailId]);

    console.log(`✅ Founder email ${emailId} sent to ${draft.recipient_email}`);

    res.json({
      success: true,
      message: 'Email sent successfully',
      emailId: emailId,
      recipientEmail: draft.recipient_email
    });

  } catch (error) {
    console.error('❌ Failed to send founder email:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/admin/dismiss-founder-email/:emailId
 * Dismiss a pending email (won't be sent)
 * Body: { reason? } - optional dismissal reason
 */
router.post('/api/v1/admin/dismiss-founder-email/:emailId', async (req, res) => {
  try {
    const { emailId } = req.params;
    const { reason } = req.body;

    console.log(`🗑️ Dismissing founder email ${emailId}...`);

    // Check if email exists
    const emailResult = await db.query(`
      SELECT * FROM pending_founder_emails WHERE id = $1
    `, [emailId]);

    if (emailResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Email not found'
      });
    }

    // Mark as dismissed
    await db.query(`
      UPDATE pending_founder_emails
      SET
        status = 'dismissed',
        reviewed_at = NOW()
      WHERE id = $1
    `, [emailId]);

    console.log(`✅ Founder email ${emailId} dismissed${reason ? ` (reason: ${reason})` : ''}`);

    res.json({
      success: true,
      message: 'Email dismissed successfully',
      emailId: emailId
    });

  } catch (error) {
    console.error('❌ Failed to dismiss founder email:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/admin/founder-emails/stats
 * Get statistics about founder welcome emails
 */
router.get('/api/v1/admin/founder-emails/stats', async (req, res) => {
  try {
    const statsResult = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE status = 'sent') as sent_count,
        COUNT(*) FILTER (WHERE status = 'dismissed') as dismissed_count,
        COUNT(*) FILTER (WHERE status = 'reviewed') as reviewed_count,
        COUNT(*) as total_count,
        ROUND(AVG(EXTRACT(EPOCH FROM (sent_at - generated_at))/3600), 2) as avg_hours_to_send,
        MAX(generated_at) as last_generation_at
      FROM pending_founder_emails
      WHERE generated_at >= NOW() - INTERVAL '30 days'
    `);

    res.json({
      success: true,
      stats: statsResult.rows[0]
    });
  } catch (error) {
    console.error('❌ Failed to fetch founder email stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
