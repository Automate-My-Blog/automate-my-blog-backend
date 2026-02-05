/**
 * Founder Emails Service
 * Data access and business logic for pending founder welcome emails (admin review/send flow).
 * Keeps routes free of SQL and schema details.
 */
import db from './database.js';
import emailService from './email.js';

/**
 * List all pending founder emails for admin review
 * @returns {Promise<{ emails: Array, count: number }>}
 */
export async function listPending() {
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
  return { emails: result.rows, count: result.rows.length };
}

/**
 * Get a single pending founder email by ID
 * @param {string} emailId
 * @returns {Promise<object|null>}
 */
export async function getById(emailId) {
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
  return result.rows[0] || null;
}

/**
 * Send a founder email (with optional edits) and mark as sent
 * @param {string} emailId
 * @param {{ editedSubject?: string, editedBody?: string }} opts
 * @returns {Promise<{ recipientEmail: string }>}
 * @throws {Error} If email not found or already sent
 */
export async function sendFounderEmail(emailId, { editedSubject, editedBody } = {}) {
  const draftResult = await db.query(
    'SELECT * FROM pending_founder_emails WHERE id = $1',
    [emailId]
  );
  if (draftResult.rows.length === 0) {
    throw new Error('Email not found');
  }
  const draft = draftResult.rows[0];
  if (draft.status === 'sent') {
    throw new Error('Email has already been sent');
  }

  const finalSubject = editedSubject || draft.subject;
  const finalBodyPlainText = editedBody || draft.body_plain_text;
  const finalBodyHtml = finalBodyPlainText
    .split('\n\n')
    .map(para => `<p>${para.trim()}</p>`)
    .join('\n');

  await emailService.sendDirect({
    from: { email: 'james@automatemyblog.com', name: 'James' },
    to: draft.recipient_email,
    subject: finalSubject,
    text: finalBodyPlainText,
    html: finalBodyHtml
  });

  await db.query(`
    UPDATE pending_founder_emails
    SET status = 'sent', sent_at = NOW(), reviewed_at = NOW(),
        subject = $1, body_plain_text = $2, body_html = $3
    WHERE id = $4
  `, [finalSubject, finalBodyPlainText, finalBodyHtml, emailId]);

  return { recipientEmail: draft.recipient_email };
}

/**
 * Dismiss a pending founder email
 * @param {string} emailId
 * @returns {Promise<void>}
 * @throws {Error} If email not found
 */
export async function dismissFounderEmail(emailId) {
  const check = await db.query(
    'SELECT id FROM pending_founder_emails WHERE id = $1',
    [emailId]
  );
  if (check.rows.length === 0) {
    throw new Error('Email not found');
  }
  await db.query(`
    UPDATE pending_founder_emails
    SET status = 'dismissed', reviewed_at = NOW()
    WHERE id = $1
  `, [emailId]);
}

/**
 * Get founder email statistics (last 30 days)
 * @returns {Promise<object>}
 */
export async function getStats() {
  const result = await db.query(`
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
  return result.rows[0];
}
