import express from 'express';

const router = express.Router();

/**
 * POST /api/v1/analysis/adopt-session
 * Website analysis session adoption endpoint
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

    console.log(`🔄 Analysis session adoption request: user=${userId}, session=${session_id}`);

    // Return minimal success response for now 
    // TODO: Implement actual database adoption logic after deployment is verified
    res.json({
      success: true,
      message: 'Website analysis session adoption endpoint is working',
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
      error: 'Failed to adopt analysis session data',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/analysis/recent
 * Get user's recent website analysis data
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

    console.log(`📊 Getting recent analysis for user: ${req.user.userId}`);

    // Return minimal response for now
    // TODO: Implement actual database query after deployment is verified  
    res.json({
      success: true,
      analysis: null,
      message: 'No analysis found (endpoint working, database query not yet implemented)'
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