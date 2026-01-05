import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../services/database.js';

const router = express.Router();

router.post('/create', async (req, res) => {
  try {
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    res.json({
      success: true,
      session_id: sessionId,
      expires_at: expiresAt.toISOString()
    });

  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create session',
      message: error.message
    });
  }
});

router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing session ID',
        message: 'Session ID is required'
      });
    }

    const audiencesResult = await db.query(`
      SELECT 
        id, target_segment, customer_problem, priority, created_at,
        COUNT(sk.id) as keywords_count,
        COUNT(ct.id) as topics_count
      FROM audiences a
      LEFT JOIN seo_keywords sk ON a.id = sk.audience_id
      LEFT JOIN content_topics ct ON a.id = ct.audience_id
      WHERE a.session_id = $1
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `, [sessionId]);

    const audiences = audiencesResult.rows.map(row => ({
      id: row.id,
      target_segment: JSON.parse(row.target_segment),
      customer_problem: row.customer_problem,
      priority: row.priority,
      keywords_count: parseInt(row.keywords_count),
      topics_count: parseInt(row.topics_count),
      created_at: row.created_at
    }));

    const keywordsResult = await db.query(`
      SELECT id, keyword, search_volume, competition, relevance_score, audience_id
      FROM seo_keywords 
      WHERE session_id = $1
      ORDER BY relevance_score DESC NULLS LAST
    `, [sessionId]);

    const topicsResult = await db.query(`
      SELECT id, title, description, category, audience_id
      FROM content_topics 
      WHERE session_id = $1
      ORDER BY created_at DESC
    `, [sessionId]);

    res.json({
      success: true,
      session: {
        id: sessionId,
        audiences,
        topics: topicsResult.rows,
        keywords: keywordsResult.rows,
        created_at: audiences.length > 0 ? audiences[0].created_at : new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Get session data error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve session data',
      message: error.message
    });
  }
});

export default router;