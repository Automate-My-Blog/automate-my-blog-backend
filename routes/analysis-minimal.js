import express from 'express';

const router = express.Router();

/**
 * POST /api/v1/analysis/adopt-session
 * Minimal version for testing deployment
 */
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

    // Minimal response for testing
    res.json({
      success: true,
      message: 'Organization intelligence session adoption endpoint is available',
      adopted: {
        organizations: 0,
        intelligence: 0
      },
      analysis: null
    });

  } catch (error) {
    console.error('Analysis session adoption error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to adopt organization intelligence session data',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/analysis/recent
 * Minimal version for testing deployment
 */
router.get('/recent', async (req, res) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'This endpoint requires user authentication'
      });
    }

    // Minimal response for testing
    res.json({
      success: true,
      analysis: null,
      message: 'Recent analysis endpoint is available'
    });

  } catch (error) {
    console.error('Get recent analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve recent analysis',
      message: error.message
    });
  }
});

export default router;