/**
 * Analysis card icon URLs for the guided funnel (Issue #261).
 * Returns stable icon URLs keyed by card type so the frontend can show icons on analysis cards.
 * Uses Iconify API (Material Design Icons) for consistent, no-auth icon URLs.
 */

const ICONIFY_BASE = 'https://api.iconify.design';
const CARD_ICONS = {
  businessType: 'mdi/briefcase-outline',
  targetAudience: 'mdi/account-group-outline',
  contentFocus: 'mdi/file-document-edit-outline',
  keywords: 'mdi/tag-multiple-outline',
  description: 'mdi/text-box-outline',
  brandVoice: 'mdi/microphone-outline'
};

/**
 * Get icon URLs for analysis cards. Frontend can use iconUrls.businessType, etc.
 * @param {object} analysis - Analysis object (used to decide which cards exist; all keys always returned)
 * @returns {{ businessType?: string, targetAudience?: string, contentFocus?: string, keywords?: string, description?: string, brandVoice?: string }}
 */
export function getAnalysisIconUrls(analysis = {}) {
  const out = {};
  for (const [key, path] of Object.entries(CARD_ICONS)) {
    out[key] = `${ICONIFY_BASE}/${path}.svg`;
  }
  return out;
}
