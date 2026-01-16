import { Router } from 'express';
import db from '../services/database.js';
import { normalizeCTA } from '../utils/cta-normalizer.js';

const router = Router();

/**
 * GET /api/v1/organizations/:organizationId/ctas
 * Get CTAs for an organization
 * Returns top CTAs ranked by conversion potential for use in topic preview and content generation
 */
router.get('/:organizationId/ctas', async (req, res) => {
  try {
    const { organizationId } = req.params;

    // Verify organization exists
    const orgCheck = await db.query(
      'SELECT id, website_url FROM organizations WHERE id = $1',
      [organizationId]
    );

    if (orgCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found',
        message: 'The requested organization does not exist'
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
 */
router.post('/:organizationId/ctas/manual', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { ctas } = req.body;

    // Verify organization exists
    const orgCheck = await db.query(
      'SELECT id, website_url FROM organizations WHERE id = $1',
      [organizationId]
    );

    if (orgCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found',
        message: 'The requested organization does not exist'
      });
    }

    const websiteUrl = orgCheck.rows[0].website_url;

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

    // Update organization to mark that it has CTA data
    await db.query(`
      UPDATE organizations
      SET has_cta_data = true
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
