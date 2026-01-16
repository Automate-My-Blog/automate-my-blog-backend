/**
 * CTA Normalization Utility
 *
 * Ensures CTA data matches database schema constraints before storage.
 * This is the single source of truth for CTA type and placement mapping.
 *
 * Database Constraints (from 15_website_content_storage.sql):
 * - cta_type: 'button', 'contact_link', 'signup_link', 'demo_link', 'trial_link',
 *             'form', 'email_capture', 'cta_element', 'phone_link', 'download_link'
 * - placement: 'header', 'footer', 'navigation', 'sidebar', 'main_content', 'popup', 'banner'
 */

/**
 * Mapping from scraper/common CTA types to database-valid types
 */
const CTA_TYPE_MAPPING = {
  'contact': 'contact_link',
  'signup': 'signup_link',
  'demo': 'demo_link',
  'trial': 'trial_link',
  'phone': 'phone_link',
  'download': 'download_link',
  'button': 'button',
  'form': 'form',
  'email': 'email_capture',
  'email_capture': 'email_capture',
  'cta': 'cta_element',
  'cta_element': 'cta_element',
  // Database-valid values (pass through)
  'contact_link': 'contact_link',
  'signup_link': 'signup_link',
  'demo_link': 'demo_link',
  'trial_link': 'trial_link',
  'phone_link': 'phone_link',
  'download_link': 'download_link'
};

/**
 * Valid placement values according to database schema
 */
const VALID_PLACEMENTS = [
  'header',
  'footer',
  'navigation',
  'sidebar',
  'main_content',
  'popup',
  'banner'
];

/**
 * Mapping from common placement terms to database-valid placements
 */
const PLACEMENT_MAPPING = {
  'content': 'main_content',
  'main': 'main_content',
  'body': 'main_content',
  'nav': 'navigation',
  'menu': 'navigation',
  'side': 'sidebar',
  'modal': 'popup',
  // Database-valid values (pass through)
  'header': 'header',
  'footer': 'footer',
  'navigation': 'navigation',
  'sidebar': 'sidebar',
  'main_content': 'main_content',
  'popup': 'popup',
  'banner': 'banner'
};

/**
 * Normalize a single CTA object to match database schema
 *
 * @param {Object} cta - Raw CTA data from scraper or API
 * @param {string} cta.text - CTA display text
 * @param {string} cta.type - CTA type (will be mapped to database-valid value)
 * @param {string} cta.placement - CTA placement location (will be validated/mapped)
 * @param {string} cta.href - CTA link URL
 * @param {string} cta.context - Surrounding text context
 * @param {string} cta.className - CSS class name
 * @param {string} cta.tagName - HTML tag name
 * @param {number} cta.conversion_potential - Conversion likelihood score
 * @param {number} cta.visibility_score - Visibility/prominence score
 *
 * @returns {Object} Normalized CTA ready for database insertion
 */
export function normalizeCTA(cta) {
  if (!cta) {
    throw new Error('CTA object is required');
  }

  // Normalize type
  const rawType = (cta.type || cta.cta_type || '').toLowerCase().trim();
  const normalizedType = CTA_TYPE_MAPPING[rawType] || 'cta_element';

  // Normalize placement
  const rawPlacement = (cta.placement || '').toLowerCase().trim();
  let normalizedPlacement = PLACEMENT_MAPPING[rawPlacement];

  // If no mapping found, check if it's already valid
  if (!normalizedPlacement && VALID_PLACEMENTS.includes(rawPlacement)) {
    normalizedPlacement = rawPlacement;
  }

  // Default to main_content if still invalid
  if (!normalizedPlacement) {
    normalizedPlacement = 'main_content';
  }

  return {
    cta_text: cta.text || cta.cta_text || 'Unknown CTA',
    cta_type: normalizedType,
    placement: normalizedPlacement,
    href: cta.href || '',
    context: cta.context || '',
    class_name: cta.className || cta.class_name || '',
    tag_name: cta.tagName || cta.tag_name || 'a',
    conversion_potential: cta.conversion_potential || cta.conversionPotential || 70,
    visibility_score: cta.visibility_score || cta.visibilityScore || 70
  };
}

/**
 * Normalize an array of CTAs
 *
 * @param {Array} ctas - Array of raw CTA objects
 * @returns {Array} Array of normalized CTAs
 */
export function normalizeCTAs(ctas) {
  if (!Array.isArray(ctas)) {
    return [];
  }

  return ctas.map((cta, index) => {
    try {
      return normalizeCTA(cta);
    } catch (error) {
      console.warn(`Failed to normalize CTA at index ${index}:`, error.message);
      return null;
    }
  }).filter(Boolean); // Remove any null entries from failed normalizations
}

/**
 * Validate if a CTA type is database-valid
 *
 * @param {string} type - CTA type to validate
 * @returns {boolean} True if valid
 */
export function isValidCTAType(type) {
  const validTypes = new Set(Object.values(CTA_TYPE_MAPPING));
  return validTypes.has(type);
}

/**
 * Validate if a placement is database-valid
 *
 * @param {string} placement - Placement to validate
 * @returns {boolean} True if valid
 */
export function isValidPlacement(placement) {
  return VALID_PLACEMENTS.includes(placement);
}

/**
 * Get all valid CTA types
 *
 * @returns {Array} Array of valid CTA type strings
 */
export function getValidCTATypes() {
  return [...new Set(Object.values(CTA_TYPE_MAPPING))];
}

/**
 * Get all valid placement values
 *
 * @returns {Array} Array of valid placement strings
 */
export function getValidPlacements() {
  return [...VALID_PLACEMENTS];
}

export default {
  normalizeCTA,
  normalizeCTAs,
  isValidCTAType,
  isValidPlacement,
  getValidCTATypes,
  getValidPlacements
};
