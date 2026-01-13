import express from 'express';
import db from '../services/database.js';

const router = express.Router();

/**
 * Manual Input Management API
 * Handles fallback data entry when automated scraping fails
 */

/**
 * POST /api/v1/manual-inputs
 * Store manual input data for an organization
 */
router.post('/', async (req, res) => {
  try {
    const { organizationId, inputType, inputData, inputSource = 'manual' } = req.body;
    const userId = req.user.userId;

    // Validate required fields
    if (!organizationId || !inputType || !inputData) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'organizationId, inputType, and inputData are required'
      });
    }

    // Validate input type
    const validInputTypes = [
      'brand_voice', 'cta_preferences', 'internal_linking', 'brand_colors',
      'target_audience', 'business_objectives', 'competitor_info', 'industry_context'
    ];

    if (!validInputTypes.includes(inputType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid input type',
        message: `Input type must be one of: ${validInputTypes.join(', ')}`
      });
    }

    // Verify user has access to organization
    const orgCheck = await db.query(
      'SELECT id FROM organizations WHERE id = $1',
      [organizationId]
    );

    if (orgCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found',
        message: 'The specified organization does not exist'
      });
    }

    console.log(`📝 Storing manual input of type '${inputType}' for organization: ${organizationId}`);

    // Insert or update manual input (upsert)
    const result = await db.query(`
      INSERT INTO user_manual_inputs (
        organization_id, input_type, input_data, input_source, created_by
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (organization_id, input_type) 
      DO UPDATE SET
        input_data = EXCLUDED.input_data,
        input_source = EXCLUDED.input_source,
        created_by = EXCLUDED.created_by,
        updated_at = NOW()
      RETURNING *
    `, [organizationId, inputType, JSON.stringify(inputData), inputSource, userId]);

    const savedInput = result.rows[0];

    // Update organization data availability
    await db.query(
      'SELECT update_organization_data_availability($1)',
      [organizationId]
    );

    console.log(`✅ Manual input saved successfully: ${savedInput.id}`);

    res.json({
      success: true,
      data: {
        id: savedInput.id,
        inputType: savedInput.input_type,
        inputData: JSON.parse(savedInput.input_data),
        inputSource: savedInput.input_source,
        createdAt: savedInput.created_at,
        updatedAt: savedInput.updated_at
      }
    });

  } catch (error) {
    console.error('Manual input creation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to store manual input',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/manual-inputs/:organizationId
 * Retrieve all manual inputs for an organization
 */
router.get('/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params;

    console.log(`🔍 Retrieving manual inputs for organization: ${organizationId}`);

    const result = await db.query(`
      SELECT 
        id,
        input_type,
        input_data,
        input_source,
        confidence_score,
        validated,
        created_at,
        updated_at
      FROM user_manual_inputs 
      WHERE organization_id = $1
      ORDER BY updated_at DESC
    `, [organizationId]);

    const inputs = result.rows.map(row => ({
      id: row.id,
      inputType: row.input_type,
      inputData: JSON.parse(row.input_data),
      inputSource: row.input_source,
      confidenceScore: parseFloat(row.confidence_score),
      validated: row.validated,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    res.json({
      success: true,
      data: inputs
    });

  } catch (error) {
    console.error('Manual inputs retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve manual inputs',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/manual-inputs/:organizationId/availability
 * Get data availability status for an organization
 */
router.get('/:organizationId/availability', async (req, res) => {
  try {
    const { organizationId } = req.params;

    console.log(`🔍 Checking data availability for organization: ${organizationId}`);

    // Get current data availability
    const orgResult = await db.query(
      'SELECT data_availability FROM organizations WHERE id = $1',
      [organizationId]
    );

    if (orgResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found'
      });
    }

    let availability = orgResult.rows[0].data_availability;

    // If data availability is null or outdated, refresh it
    if (!availability || !availability.last_analysis_date) {
      console.log('🔄 Refreshing data availability status...');
      const updateResult = await db.query(
        'SELECT update_organization_data_availability($1)',
        [organizationId]
      );
      availability = updateResult.rows[0].update_organization_data_availability;
    }

    // Get missing data types that need manual input
    const missingData = [];
    if (!availability.has_blog_content) missingData.push('brand_voice');
    if (!availability.has_cta_data) missingData.push('cta_preferences');
    if (!availability.has_internal_links) missingData.push('internal_linking');
    if (!availability.has_visual_design) missingData.push('brand_colors');

    // Check if manual inputs already exist for missing data
    const manualInputsResult = await db.query(
      'SELECT input_type FROM user_manual_inputs WHERE organization_id = $1 AND validated = TRUE',
      [organizationId]
    );

    const existingInputs = manualInputsResult.rows.map(row => row.input_type);
    const stillMissing = missingData.filter(type => !existingInputs.includes(type));

    res.json({
      success: true,
      data: {
        availability,
        missingDataTypes: stillMissing,
        existingManualInputs: existingInputs,
        requiresManualInput: stillMissing.length > 0,
        completenessScore: availability.completeness_score || 0
      }
    });

  } catch (error) {
    console.error('Data availability check error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check data availability',
      message: error.message
    });
  }
});

/**
 * PUT /api/v1/manual-inputs/:inputId/validate
 * Mark a manual input as validated
 */
router.put('/:inputId/validate', async (req, res) => {
  try {
    const { inputId } = req.params;
    const { validated = true } = req.body;

    console.log(`✅ ${validated ? 'Validating' : 'Invalidating'} manual input: ${inputId}`);

    const result = await db.query(`
      UPDATE user_manual_inputs 
      SET validated = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING organization_id
    `, [validated, inputId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Manual input not found'
      });
    }

    const organizationId = result.rows[0].organization_id;

    // Update organization data availability
    await db.query(
      'SELECT update_organization_data_availability($1)',
      [organizationId]
    );

    res.json({
      success: true,
      message: `Manual input ${validated ? 'validated' : 'invalidated'} successfully`
    });

  } catch (error) {
    console.error('Manual input validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate manual input',
      message: error.message
    });
  }
});

/**
 * DELETE /api/v1/manual-inputs/:inputId
 * Delete a manual input
 */
router.delete('/:inputId', async (req, res) => {
  try {
    const { inputId } = req.params;

    console.log(`🗑️ Deleting manual input: ${inputId}`);

    const result = await db.query(`
      DELETE FROM user_manual_inputs 
      WHERE id = $1
      RETURNING organization_id
    `, [inputId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Manual input not found'
      });
    }

    const organizationId = result.rows[0].organization_id;

    // Update organization data availability
    await db.query(
      'SELECT update_organization_data_availability($1)',
      [organizationId]
    );

    res.json({
      success: true,
      message: 'Manual input deleted successfully'
    });

  } catch (error) {
    console.error('Manual input deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete manual input',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/manual-inputs/templates/:inputType
 * Get input template/schema for a specific input type
 */
router.get('/templates/:inputType', async (req, res) => {
  try {
    const { inputType } = req.params;

    const templates = {
      brand_voice: {
        schema: {
          tone: { type: 'string', required: true, options: ['professional', 'casual', 'friendly', 'authoritative', 'conversational'] },
          style: { type: 'string', required: true, options: ['formal', 'informal', 'technical', 'simple', 'detailed'] },
          personality: { type: 'array', required: false, description: 'Brand personality traits' },
          avoid: { type: 'array', required: false, description: 'Things to avoid in content' }
        },
        example: {
          tone: 'professional',
          style: 'conversational',
          personality: ['helpful', 'innovative', 'trustworthy'],
          avoid: ['overly technical jargon', 'sales-heavy language']
        }
      },
      
      cta_preferences: {
        schema: {
          primary_action: { type: 'string', required: true, description: 'Main action you want users to take' },
          cta_style: { type: 'string', required: true, options: ['direct', 'soft', 'benefit-focused', 'urgency-based'] },
          placement: { type: 'string', required: true, options: ['inline', 'end-of-post', 'sidebar', 'multiple'] },
          messaging: { type: 'array', required: false, description: 'Preferred CTA messages' }
        },
        example: {
          primary_action: 'Schedule a demo',
          cta_style: 'benefit-focused',
          placement: 'end-of-post',
          messaging: ['See how it works for you', 'Get your free demo', 'Start your free trial']
        }
      },

      internal_linking: {
        schema: {
          priority_pages: { type: 'array', required: true, description: 'URLs of important pages to link to' },
          linking_strategy: { type: 'string', required: true, options: ['aggressive', 'moderate', 'minimal'] },
          anchor_text_style: { type: 'string', required: true, options: ['exact-match', 'natural', 'branded'] },
          max_links_per_post: { type: 'number', required: false, default: 5 }
        },
        example: {
          priority_pages: ['/services', '/about', '/contact'],
          linking_strategy: 'moderate',
          anchor_text_style: 'natural',
          max_links_per_post: 3
        }
      },

      brand_colors: {
        schema: {
          primary_color: { type: 'string', required: true, description: 'Primary brand color (hex)' },
          secondary_color: { type: 'string', required: false, description: 'Secondary brand color (hex)' },
          accent_color: { type: 'string', required: false, description: 'Accent color (hex)' },
          color_palette: { type: 'array', required: false, description: 'Additional brand colors' },
          style_preference: { type: 'string', required: true, options: ['modern', 'classic', 'bold', 'minimal', 'playful'] }
        },
        example: {
          primary_color: '#1976d2',
          secondary_color: '#424242',
          accent_color: '#ff5722',
          color_palette: ['#f5f5f5', '#333333'],
          style_preference: 'modern'
        }
      },

      target_audience: {
        schema: {
          primary_audience: { type: 'string', required: true, description: 'Primary target audience' },
          demographics: { type: 'object', required: false },
          pain_points: { type: 'array', required: true, description: 'Main challenges they face' },
          goals: { type: 'array', required: true, description: 'What they want to achieve' },
          experience_level: { type: 'string', required: true, options: ['beginner', 'intermediate', 'advanced', 'mixed'] }
        },
        example: {
          primary_audience: 'Small business owners',
          demographics: { age_range: '30-50', business_size: '1-50 employees' },
          pain_points: ['Limited marketing budget', 'Time constraints', 'Lack of technical expertise'],
          goals: ['Increase customer acquisition', 'Improve online presence', 'Streamline operations'],
          experience_level: 'beginner'
        }
      },

      business_objectives: {
        schema: {
          primary_goal: { type: 'string', required: true, options: ['lead_generation', 'brand_awareness', 'customer_education', 'sales', 'retention'] },
          secondary_goals: { type: 'array', required: false },
          success_metrics: { type: 'array', required: false, description: 'How you measure success' },
          timeline: { type: 'string', required: false, description: 'Timeline for achieving goals' }
        },
        example: {
          primary_goal: 'lead_generation',
          secondary_goals: ['brand_awareness', 'customer_education'],
          success_metrics: ['email signups', 'demo requests', 'content engagement'],
          timeline: '6 months'
        }
      }
    };

    const template = templates[inputType];
    
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found',
        message: `No template available for input type: ${inputType}`
      });
    }

    res.json({
      success: true,
      data: {
        inputType,
        ...template
      }
    });

  } catch (error) {
    console.error('Template retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve template',
      message: error.message
    });
  }
});

export default router;