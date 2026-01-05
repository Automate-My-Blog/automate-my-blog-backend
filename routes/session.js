import express from 'express';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// Create a new session
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

// Get session data (simplified version for Vercel compatibility)
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

    // For now, return empty session data until we can verify audience tables work in Vercel
    res.json({
      success: true,
      session: {
        id: sessionId,
        audiences: [],
        topics: [],
        keywords: [],
        created_at: new Date().toISOString()
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