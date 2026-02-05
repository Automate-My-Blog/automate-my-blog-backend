import express from 'express';
import * as founderEmailsService from '../services/founder-emails.js';

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
    const { emails, count } = await founderEmailsService.listPending();
    res.json({ success: true, emails, count });
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
    const email = await founderEmailsService.getById(emailId);
    if (!email) {
      return res.status(404).json({
        success: false,
        error: 'Email not found'
      });
    }
    res.json({ success: true, email });
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

    const { recipientEmail } = await founderEmailsService.sendFounderEmail(emailId, {
      editedSubject,
      editedBody
    });

    console.log(`✅ Founder email ${emailId} sent to ${recipientEmail}`);

    res.json({
      success: true,
      message: 'Email sent successfully',
      emailId,
      recipientEmail
    });
  } catch (error) {
    if (error.message === 'Email not found') {
      return res.status(404).json({ success: false, error: error.message });
    }
    if (error.message === 'Email has already been sent') {
      return res.status(400).json({ success: false, error: error.message });
    }
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

    await founderEmailsService.dismissFounderEmail(emailId);

    console.log(`✅ Founder email ${emailId} dismissed${reason ? ` (reason: ${reason})` : ''}`);

    res.json({
      success: true,
      message: 'Email dismissed successfully',
      emailId
    });
  } catch (error) {
    if (error.message === 'Email not found') {
      return res.status(404).json({ success: false, error: error.message });
    }
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
    const stats = await founderEmailsService.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('❌ Failed to fetch founder email stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
