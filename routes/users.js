import express from 'express';
import db from '../services/database.js';

const router = express.Router();

// Safe JSON parsing to handle corrupted database records (same as in audiences.js)
const safeParse = (jsonString, fieldName, recordId) => {
  if (!jsonString) return null;
  if (typeof jsonString === 'object') return jsonString; // Already parsed
  
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.error(`JSON parse error for ${fieldName} in record ${recordId}:`, {
      error: error.message,
      rawValue: jsonString,
      valueType: typeof jsonString
    });
    // Return a fallback object instead of failing
    return fieldName === 'target_segment' 
      ? { demographics: 'Data parsing error', psychographics: 'Please recreate audience', searchBehavior: 'N/A' }
      : null;
  }
};

// POST /api/v1/users/adopt-session
router.post('/adopt-session', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { session_id } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'User must be authenticated to adopt session data'
      });
    }

    if (!session_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing session ID',
        message: 'session_id is required for adoption'
      });
    }

    console.log(`🔄 Adopting session ${session_id} for user ${userId}`);

    // Start transaction for atomic session adoption
    await db.query('BEGIN');

    try {
      // 1. Transfer audiences from session to user
      const audiencesResult = await db.query(`
        UPDATE audiences 
        SET user_id = $1, session_id = NULL, updated_at = NOW()
        WHERE session_id = $2
        RETURNING id, target_segment, customer_problem, priority
      `, [userId, session_id]);

      // 2. Transfer keywords from session to user
      const keywordsResult = await db.query(`
        UPDATE seo_keywords 
        SET user_id = $1, session_id = NULL
        WHERE session_id = $2
        RETURNING id, keyword, audience_id
      `, [userId, session_id]);

      // 3. Transfer content topics from session to user  
      const topicsResult = await db.query(`
        UPDATE content_topics 
        SET session_id = NULL
        WHERE session_id = $1
        RETURNING id, title, audience_id
      `, [session_id]);

      // Commit the transaction
      await db.query('COMMIT');

      const adoptedCounts = {
        audiences: audiencesResult.rows.length,
        keywords: keywordsResult.rows.length,
        topics: topicsResult.rows.length
      };

      console.log(`✅ Session adoption completed:`, adoptedCounts);

      res.json({
        success: true,
        message: 'Session data successfully adopted',
        adopted: adoptedCounts,
        data: {
          audiences: audiencesResult.rows.map(row => ({
            id: row.id,
            target_segment: safeParse(row.target_segment, 'target_segment', row.id),
            customer_problem: row.customer_problem,
            priority: row.priority
          })),
          keywords: keywordsResult.rows,
          topics: topicsResult.rows
        }
      });

    } catch (transactionError) {
      // Rollback on any error
      await db.query('ROLLBACK');
      throw transactionError;
    }

  } catch (error) {
    console.error('Session adoption error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to adopt session data',
      message: error.message
    });
  }
});

export default router;