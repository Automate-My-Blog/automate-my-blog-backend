import db from '../services/database.js';

/**
 * Background job to expire old credits
 * Run daily at midnight
 */
export async function expireOldCredits() {
  try {
    console.log('🕒 Running credit expiration job...');

    const result = await db.query(`
      UPDATE user_credits
      SET status = 'expired'
      WHERE status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at < NOW()
      RETURNING id, user_id, source_type, quantity, expires_at
    `);

    if (result.rows.length > 0) {
      console.log(`🕒 Expired ${result.rows.length} credits:`);
      result.rows.forEach(row => {
        console.log(`  - User ${row.user_id}: ${row.quantity} ${row.source_type} credit (expired ${row.expires_at})`);
      });
    } else {
      console.log('✅ No credits to expire');
    }

    return { expired: result.rows.length };
  } catch (error) {
    console.error('❌ Error expiring credits:', error);
    throw error;
  }
}
