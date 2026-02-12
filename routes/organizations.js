import { Router } from 'express';
import db from '../services/database.js';
import { normalizeCTA } from '../utils/cta-normalizer.js';

const router = Router();

/** Extract user context (JWT or session) for optional-auth routes. Same pattern as analysis. */
function extractUserContext(req) {
  const sessionId = req.headers['x-session-id'] || req.body?.session_id || req.query?.sessionId || null;
  if (req.user?.userId) {
    return { isAuthenticated: true, userId: req.user.userId, sessionId: sessionId || null };
  }
  return { isAuthenticated: false, userId: null, sessionId: sessionId || null };
}

/** Require at least session or auth; return error response or null. */
function validateUserContext(context) {
  if (!context.isAuthenticated && !context.sessionId) {
    return { status: 401, body: { success: false, error: 'Authentication or session required', message: 'Provide Authorization header or x-session-id.' } };
  }
  return null;
}

/** Verify organization access (owner or session). Returns org row or null. */
async function getOrganizationForContext(organizationId, userContext) {
  if (!organizationId) return null;
  if (userContext.isAuthenticated) {
    const r = await db.query('SELECT id FROM organizations WHERE id = $1 AND owner_user_id = $2', [organizationId, userContext.userId]);
    return r.rows[0] || null;
  }
  if (userContext.sessionId) {
    const r = await db.query('SELECT id FROM organizations WHERE id = $1 AND session_id = $2', [organizationId, userContext.sessionId]);
    return r.rows[0] || null;
  }
  return null;
}

/**
 * GET /api/v1/organizations/:organizationId/social-handles
 * Get discovered or manually set social media handles for the organization.
 * Requires JWT or x-session-id; org must be owned by user or linked to session.
 */
router.get('/:organizationId/social-handles', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const userContext = extractUserContext(req);
    const validationError = validateUserContext(userContext);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    const org = await getOrganizationForContext(organizationId, userContext);
    if (!org) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found',
        message: 'The requested organization does not exist or you do not have access'
      });
    }

    const orgCheck = await db.query(
      'SELECT id, social_handles FROM organizations WHERE id = $1',
      [organizationId]
    );
    const socialHandles = orgCheck.rows[0].social_handles || {};

    res.json({
      success: true,
      social_handles: socialHandles
    });
  } catch (error) {
    console.error('Error fetching organization social handles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch social handles',
      message: error.message
    });
  }
});

/**
 * PATCH /api/v1/organizations/:organizationId/social-handles
 * Set or override social media handles (e.g. from manual input).
 * Body: { "social_handles": { "twitter": ["@handle"], "linkedin": ["company/slug"], ... } }
 */
router.patch('/:organizationId/social-handles', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const userContext = extractUserContext(req);
    const validationError = validateUserContext(userContext);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    const org = await getOrganizationForContext(organizationId, userContext);
    if (!org) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found',
        message: 'The requested organization does not exist or you do not have access'
      });
    }

    const { social_handles: bodyHandles } = req.body;

    if (bodyHandles !== undefined && (typeof bodyHandles !== 'object' || bodyHandles === null || Array.isArray(bodyHandles))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid input',
        message: 'social_handles must be an object with platform keys and array-of-strings values (e.g. { "twitter": ["@acme"] })'
      });
    }

    const socialHandles = bodyHandles || {};
    for (const key of Object.keys(socialHandles)) {
      if (!Array.isArray(socialHandles[key])) {
        return res.status(400).json({
          success: false,
          error: 'Invalid input',
          message: `social_handles.${key} must be an array of strings`
        });
      }
      if (socialHandles[key].some(v => typeof v !== 'string')) {
        return res.status(400).json({
          success: false,
          error: 'Invalid input',
          message: `social_handles.${key} must contain only strings`
        });
      }
    }

    await db.query(
      'UPDATE organizations SET social_handles = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(socialHandles), organizationId]
    );

    res.json({
      success: true,
      social_handles: socialHandles
    });
  } catch (error) {
    console.error('Error updating organization social handles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update social handles',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/organizations/:organizationId/refresh-social-voice
 * Re-run discovery of social handles from the organization's website and persist them.
 */
router.post('/:organizationId/refresh-social-voice', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const userContext = extractUserContext(req);
    const validationError = validateUserContext(userContext);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    const org = await getOrganizationForContext(organizationId, userContext);
    if (!org) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found',
        message: 'The requested organization does not exist or you do not have access'
      });
    }

    const orgRow = await db.query('SELECT id, website_url FROM organizations WHERE id = $1', [organizationId]);
    const websiteUrl = orgRow.rows[0]?.website_url;
    if (!websiteUrl) {
      return res.status(400).json({
        success: false,
        error: 'No website URL',
        message: 'Organization has no website_url set. Set a website before refreshing social handles.'
      });
    }

    const webScraperService = (await import('../services/webscraper.js')).default;
    const scraped = await webScraperService.scrapeWebsite(websiteUrl);
    const socialHandles = scraped?.socialHandles || {};

    if (Object.keys(socialHandles).length > 0) {
      await db.query(
        'UPDATE organizations SET social_handles = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(socialHandles), organizationId]
      );
    }

    res.json({
      success: true,
      social_handles: socialHandles,
      message: Object.keys(socialHandles).length > 0
        ? `Found and saved ${Object.keys(socialHandles).length} platform(s).`
        : 'No social handles found on the website.'
    });
  } catch (error) {
    console.error('Error refreshing social handles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh social handles',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/organizations/:organizationId/ctas
 * Get CTAs for an organization
 * Returns top CTAs ranked by conversion potential for use in topic preview and content generation
 * Requires JWT or x-session-id; org must be owned by user or linked to session.
 */
router.get('/:organizationId/ctas', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const userContext = extractUserContext(req);
    const validationError = validateUserContext(userContext);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    const org = await getOrganizationForContext(organizationId, userContext);
    if (!org) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found',
        message: 'The requested organization does not exist or you do not have access'
      });
    }

    console.log('📊 [CTA DEBUG] API: Fetching CTAs for organization:', { organizationId });

    // Fetch CTAs for this organization
    const ctaResult = await db.query(`
      SELECT
        id,
        cta_text as text,
        cta_type as type,
        href,
        placement,
        conversion_potential,
        data_source,
        page_type,
        context
      FROM cta_analysis
      WHERE organization_id = $1
      ORDER BY conversion_potential DESC
      LIMIT 5
    `, [organizationId]);

    const ctas = ctaResult.rows;
    const count = ctas.length;
    const has_sufficient_ctas = count >= 3;

    console.log('📊 [CTA DEBUG] API: Database query result:', {
      organizationId,
      ctaCount: ctas.length,
      ctas: ctas.map(cta => ({
        id: cta.id,
        text: cta.text,
        type: cta.type,
        href: cta.href,
        placement: cta.placement,
        data_source: cta.data_source
      }))
    });

    console.log(`📊 Retrieved ${count} CTAs for organization ${organizationId}`);

    console.log('✅ [CTA DEBUG] API: Sending CTA response:', {
      organizationId,
      ctaCount: count,
      has_sufficient_ctas: has_sufficient_ctas,
      response: { success: true, ctas: ctas, count: count, has_sufficient_ctas: has_sufficient_ctas }
    });

    res.json({
      success: true,
      ctas,
      count,
      has_sufficient_ctas,
      message: has_sufficient_ctas
        ? `Found ${count} CTAs ready for content generation`
        : `Only ${count} CTAs found. We recommend at least 3 for best results.`
    });

  } catch (error) {
    console.error('Error fetching organization CTAs:', error);
    console.error('🚨 [CTA DEBUG] API: Failed to fetch CTAs:', {
      organizationId: req.params.organizationId,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch CTAs',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/organizations/:organizationId/ctas/manual
 * Manually add CTAs for an organization
 * Used when website scraping didn't find enough CTAs
 * Requires JWT or x-session-id; org must be owned by user or linked to session.
 */
router.post('/:organizationId/ctas/manual', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const userContext = extractUserContext(req);
    const validationError = validateUserContext(userContext);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    const org = await getOrganizationForContext(organizationId, userContext);
    if (!org) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found',
        message: 'The requested organization does not exist or you do not have access'
      });
    }

    const orgRow = await db.query('SELECT id, website_url FROM organizations WHERE id = $1', [organizationId]);
    const websiteUrl = orgRow.rows[0]?.website_url;

    // Validate input
    if (!Array.isArray(ctas) || ctas.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid input',
        message: 'ctas must be a non-empty array'
      });
    }

    if (ctas.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient CTAs',
        message: 'Please provide at least 3 CTAs for best content generation results'
      });
    }

    // Validate each CTA
    for (const cta of ctas) {
      if (!cta.text || !cta.href || !cta.type || !cta.placement) {
        return res.status(400).json({
          success: false,
          error: 'Invalid CTA',
          message: 'Each CTA must have text, href, type, and placement'
        });
      }

      // Validate URL format (allow relative or absolute URLs)
      const urlPattern = /^(https?:\/\/.+|\/[a-zA-Z0-9\-_\/]*)/;
      if (!urlPattern.test(cta.href)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid URL',
          message: `Invalid href format for CTA "${cta.text}". Must be absolute URL or relative path.`
        });
      }
    }

    // Check for duplicate URLs
    const hrefs = ctas.map(c => c.href);
    const uniqueHrefs = new Set(hrefs);
    if (hrefs.length !== uniqueHrefs.size) {
      return res.status(400).json({
        success: false,
        error: 'Duplicate URLs',
        message: 'Each CTA must have a unique URL'
      });
    }

    // Insert CTAs into database
    let insertedCount = 0;
    for (const cta of ctas) {
      try {
        // Normalize CTA using centralized utility
        const normalized = normalizeCTA(cta);

        await db.query(`
          INSERT INTO cta_analysis (
            organization_id,
            page_url,
            cta_text,
            cta_type,
            placement,
            href,
            context,
            conversion_potential,
            visibility_score,
            page_type,
            analysis_source,
            data_source,
            scraped_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
          ON CONFLICT (organization_id, page_url, cta_text, placement) DO UPDATE SET
            cta_type = EXCLUDED.cta_type,
            href = EXCLUDED.href,
            context = EXCLUDED.context,
            conversion_potential = EXCLUDED.conversion_potential,
            data_source = EXCLUDED.data_source,
            scraped_at = EXCLUDED.scraped_at
        `, [
          organizationId,
          websiteUrl || 'manual-entry',
          normalized.cta_text,
          normalized.cta_type,
          normalized.placement,
          normalized.href,
          cta.context || `Manually entered CTA for ${normalized.cta_type}`,
          cta.conversion_potential || 75,  // Default potential for manual CTAs
          80,  // Default visibility
          'manual_entry',
          'manual_input',
          'manual'  // Track that this was manually entered
        ]);

        insertedCount++;
      } catch (insertError) {
        console.warn(`Failed to insert CTA "${cta.text}":`, insertError.message);
      }
    }

    // Update organization data_availability to mark that it has CTA data
    await db.query(`
      UPDATE organizations
      SET data_availability = jsonb_set(
        COALESCE(data_availability, '{}'::jsonb),
        '{has_cta_data}',
        'true'::jsonb
      )
      WHERE id = $1
    `, [organizationId]);

    console.log(`✅ Manually added ${insertedCount} CTAs for organization ${organizationId}`);

    res.json({
      success: true,
      message: `Successfully added ${insertedCount} CTAs`,
      ctas_added: insertedCount,
      has_sufficient_ctas: insertedCount >= 3
    });

  } catch (error) {
    console.error('Error adding manual CTAs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add CTAs',
      message: error.message
    });
  }
});

export default router;
