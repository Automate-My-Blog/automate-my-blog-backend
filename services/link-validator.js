import axios from 'axios';

/**
 * Link Validator Service
 * Validates CTA and internal links before content generation
 */

/**
 * Validate a list of links
 * @param {Array} links - Array of link objects with href property
 * @returns {Object} Validation results with all_valid flag and list of invalid links
 */
async function validateLinks(links) {
  if (!links || links.length === 0) {
    return {
      all_valid: true,
      invalid_links: [],
      results: []
    };
  }

  console.log(`🔗 Validating ${links.length} links...`);

  const results = await Promise.all(links.map(async (link) => {
    try {
      const href = link.href || link.target_url || link.url;
      if (!href) {
        return {
          href: 'unknown',
          valid: false,
          error: 'No URL provided'
        };
      }

      // Skip validation for relative URLs (assume valid)
      if (href.startsWith('/')) {
        return {
          href,
          valid: true,
          status: 'relative',
          message: 'Relative URL (not validated)'
        };
      }

      // Skip validation for mailto: and tel: links
      if (href.startsWith('mailto:') || href.startsWith('tel:')) {
        return {
          href,
          valid: true,
          status: 'special',
          message: 'Email/phone link (not validated)'
        };
      }

      // Skip validation for anchor links
      if (href.startsWith('#')) {
        return {
          href,
          valid: true,
          status: 'anchor',
          message: 'Anchor link (not validated)'
        };
      }

      // Validate absolute URLs
      try {
        // Use HEAD request to check if URL is accessible
        const response = await axios.head(href, {
          timeout: 5000,
          validateStatus: (status) => status < 500, // Accept all non-5xx statuses
          maxRedirects: 5,
          headers: {
            'User-Agent': 'AutomateBlog-LinkValidator/1.0'
          }
        });

        const isValid = response.status >= 200 && response.status < 400;

        return {
          href,
          valid: isValid,
          status: response.status,
          message: isValid ? 'Link is accessible' : `HTTP ${response.status}`
        };
      } catch (headError) {
        // If HEAD fails, try GET (some servers don't support HEAD)
        try {
          const response = await axios.get(href, {
            timeout: 5000,
            validateStatus: (status) => status < 500,
            maxRedirects: 5,
            headers: {
              'User-Agent': 'AutomateBlog-LinkValidator/1.0'
            },
            // Only download first 1KB to check if URL works
            responseType: 'stream',
            maxContentLength: 1024
          });

          const isValid = response.status >= 200 && response.status < 400;

          // Cancel the stream to avoid downloading full content
          if (response.data && response.data.destroy) {
            response.data.destroy();
          }

          return {
            href,
            valid: isValid,
            status: response.status,
            message: isValid ? 'Link is accessible' : `HTTP ${response.status}`
          };
        } catch (getError) {
          throw headError; // Throw original error
        }
      }
    } catch (error) {
      // Handle network errors, timeouts, etc.
      let errorMessage = error.message;

      if (error.code === 'ENOTFOUND') {
        errorMessage = 'Domain not found';
      } else if (error.code === 'ECONNREFUSED') {
        errorMessage = 'Connection refused';
      } else if (error.code === 'ETIMEDOUT') {
        errorMessage = 'Request timeout';
      } else if (error.response) {
        errorMessage = `HTTP ${error.response.status}`;
      }

      return {
        href: link.href || link.target_url || link.url,
        valid: false,
        error: errorMessage
      };
    }
  }));

  const invalidLinks = results.filter(r => !r.valid);
  const allValid = invalidLinks.length === 0;

  console.log(`✅ Link validation complete: ${results.length - invalidLinks.length}/${results.length} valid`);

  return {
    all_valid: allValid,
    invalid_links: invalidLinks,
    results
  };
}

/**
 * Validate CTAs for an organization
 * @param {String} organizationId - Organization ID
 * @param {Object} db - Database connection
 * @returns {Object} Validation results
 */
async function validateOrganizationCTAs(organizationId, db) {
  console.log(`🔗 Validating CTAs for organization: ${organizationId}`);

  try {
    // Fetch CTAs from database
    const ctaResult = await db.query(`
      SELECT id, cta_text, href, cta_type, placement
      FROM cta_analysis
      WHERE organization_id = $1
      ORDER BY conversion_potential DESC
    `, [organizationId]);

    const ctas = ctaResult.rows;

    if (ctas.length === 0) {
      return {
        success: true,
        message: 'No CTAs to validate',
        all_valid: true,
        invalid_count: 0
      };
    }

    // Validate links
    const validation = await validateLinks(ctas);

    return {
      success: true,
      message: validation.all_valid
        ? `All ${ctas.length} CTAs are valid`
        : `${validation.invalid_links.length} of ${ctas.length} CTAs have issues`,
      all_valid: validation.all_valid,
      invalid_count: validation.invalid_links.length,
      invalid_links: validation.invalid_links,
      results: validation.results
    };
  } catch (error) {
    console.error('❌ CTA validation failed:', error);
    return {
      success: false,
      error: error.message,
      all_valid: false
    };
  }
}

/**
 * Get validation status for display
 * @param {Object} validationResult - Result from validateLinks or validateOrganizationCTAs
 * @returns {String} Human-readable status message
 */
function getValidationStatusMessage(validationResult) {
  if (!validationResult || !validationResult.results) {
    return 'Link validation not performed';
  }

  const total = validationResult.results.length;
  const valid = validationResult.results.filter(r => r.valid).length;
  const invalid = total - valid;

  if (invalid === 0) {
    return `✅ All ${total} link${total !== 1 ? 's' : ''} are working`;
  } else {
    return `⚠️ ${invalid} of ${total} link${total !== 1 ? 's' : ''} may have issues`;
  }
}

export default {
  validateLinks,
  validateOrganizationCTAs,
  getValidationStatusMessage
};
