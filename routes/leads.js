import express from 'express';
import leadsService from '../services/leads.js';
import DatabaseAuthService from '../services/auth-database.js';

const router = express.Router();
const authService = new DatabaseAuthService();

/**
 * Helper middleware to require superadmin role
 */
function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'super_admin') {
    return res.status(403).json({
      success: false,
      error: 'Superadmin access required'
    });
  }
  next();
}

/**
 * Track a conversion step for a lead
 * POST /api/v1/leads/track-conversion
 *
 * Body:
 * - leadId: UUID of the lead (optional if sessionId provided)
 * - sessionId: Session ID to find lead (optional if leadId provided)
 * - step: Conversion step name (e.g., 'analysis_started', 'view_audiences_clicked')
 * - stepData: Additional data about the step (optional)
 */
router.post('/track-conversion', async (req, res) => {
  try {
    const { leadId, sessionId, step, stepData = {} } = req.body;

    if (!step) {
      return res.status(400).json({
        success: false,
        error: 'step is required'
      });
    }

    let actualLeadId = leadId;

    // If no leadId provided, try to find lead by sessionId
    if (!actualLeadId && sessionId) {
      const lead = await leadsService.getLeadBySessionId(sessionId);
      if (lead) {
        actualLeadId = lead.id;
      }
    }

    // If still no leadId, return error
    if (!actualLeadId) {
      return res.status(400).json({
        success: false,
        error: 'Either leadId or sessionId must be provided, and lead must exist'
      });
    }

    // Track the conversion step
    const result = await leadsService.trackConversionStep(
      actualLeadId,
      step,
      stepData,
      sessionId
    );

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error tracking conversion step:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to track conversion step',
      message: error.message
    });
  }
});

/**
 * Get all leads with their conversion steps
 * GET /api/v1/leads
 */
router.get('/',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { page = 1, limit = 50, status, sortBy = 'created_at', sortOrder = 'DESC' } = req.query;

      const leads = await leadsService.getAllLeads({
        page: parseInt(page),
        limit: parseInt(limit),
        status,
        sortBy,
        sortOrder
      });

      res.json({
        success: true,
        ...leads
      });
    } catch (error) {
      console.error('Error getting leads:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get leads',
        message: error.message
      });
    }
  }
);

/**
 * Get lead details including conversion steps
 * GET /api/v1/leads/:leadId
 */
router.get('/:leadId',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { leadId } = req.params;

      const lead = await leadsService.getLeadDetails(leadId);

      if (!lead) {
        return res.status(404).json({
          success: false,
          error: 'Lead not found'
        });
      }

      res.json({
        success: true,
        lead
      });
    } catch (error) {
      console.error('Error getting lead details:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get lead details',
        message: error.message
      });
    }
  }
);

export default router;
