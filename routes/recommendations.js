import express from 'express';
import db from '../services/database.js';

const router = express.Router();

const REC_PREFIX = 'rec_';

/**
 * Recommendation definitions: key, title, description, priority, bucket, cta.
 * predicate(userId, db) => Promise<boolean> — when true, recommendation is eligible (still filtered by dismiss/complete).
 */
const RECOMMENDATION_DEFINITIONS = [
  {
    key: 'first_post',
    title: 'Create your first post',
    description: 'Get started by writing your first post.',
    priority: 'high',
    bucket: 'now',
    cta: { label: 'Create Post', action: 'create_post', params: {} },
    predicate: async (userId, database) => {
      const r = await database.query(
        `SELECT 1 FROM blog_posts WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      return r.rows.length === 0;
    }
  },
  {
    key: 'follow_up_post',
    title: 'Publish a follow-up post',
    description: "You haven't published in 7 days.",
    priority: 'high',
    bucket: 'now',
    cta: { label: 'Create Post', action: 'create_post', params: {} },
    predicate: async (userId, database) => {
      const r = await database.query(
        `SELECT created_at FROM blog_posts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      if (r.rows.length === 0) return false; // no posts -> first_post only
      const lastAt = r.rows[0].created_at;
      if (!lastAt) return true;
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return new Date(lastAt) < sevenDaysAgo;
    }
  }
];

/**
 * GET /api/v1/recommendations
 * Returns active recommendations for the authenticated user, excluding dismissed/completed.
 */
router.get('/', async (req, res) => {
  if (!req.user?.userId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const userId = req.user.userId;

  try {
    const actionsResult = await db.query(
      `SELECT recommendation_key FROM user_recommendation_actions WHERE user_id = $1`,
      [userId]
    );
    const hiddenKeys = new Set(actionsResult.rows.map((r) => r.recommendation_key));

    const recommendations = [];
    for (const def of RECOMMENDATION_DEFINITIONS) {
      if (hiddenKeys.has(def.key)) continue;
      const eligible = def.predicate ? await def.predicate(userId, db) : true;
      if (!eligible) continue;
      recommendations.push({
        id: REC_PREFIX + def.key,
        title: def.title,
        description: def.description,
        priority: def.priority,
        bucket: def.bucket,
        cta: def.cta
      });
    }

    return res.json({ success: true, recommendations });
  } catch (err) {
    console.error('GET /api/v1/recommendations error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load recommendations' });
  }
});

/**
 * Parse recommendation id from path (e.g. rec_follow_up_post -> follow_up_post).
 * Returns null if invalid.
 */
function parseRecommendationKey(idParam) {
  if (!idParam || typeof idParam !== 'string') return null;
  if (!idParam.startsWith(REC_PREFIX)) return null;
  const key = idParam.slice(REC_PREFIX.length).trim();
  return key || null;
}

/**
 * POST /api/v1/recommendations/:id/dismiss
 * Marks the recommendation as dismissed so it no longer appears in GET.
 */
router.post('/:id/dismiss', async (req, res) => {
  if (!req.user?.userId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const userId = req.user.userId;
  const key = parseRecommendationKey(req.params.id);
  if (!key) {
    return res.status(400).json({ success: false, error: 'Invalid recommendation id' });
  }

  try {
    await db.query(
      `INSERT INTO user_recommendation_actions (user_id, recommendation_key, action)
       VALUES ($1, $2, 'dismissed')
       ON CONFLICT (user_id, recommendation_key) DO UPDATE SET action = 'dismissed', created_at = NOW()`,
      [userId, key]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('POST /api/v1/recommendations/:id/dismiss error:', err);
    return res.status(500).json({ success: false, error: 'Failed to dismiss recommendation' });
  }
});

/**
 * POST /api/v1/recommendations/:id/complete
 * Marks the recommendation as completed so it no longer appears in GET.
 */
router.post('/:id/complete', async (req, res) => {
  if (!req.user?.userId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const userId = req.user.userId;
  const key = parseRecommendationKey(req.params.id);
  if (!key) {
    return res.status(400).json({ success: false, error: 'Invalid recommendation id' });
  }

  try {
    await db.query(
      `INSERT INTO user_recommendation_actions (user_id, recommendation_key, action)
       VALUES ($1, $2, 'completed')
       ON CONFLICT (user_id, recommendation_key) DO UPDATE SET action = 'completed', created_at = NOW()`,
      [userId, key]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('POST /api/v1/recommendations/:id/complete error:', err);
    return res.status(500).json({ success: false, error: 'Failed to complete recommendation' });
  }
});

export default router;
