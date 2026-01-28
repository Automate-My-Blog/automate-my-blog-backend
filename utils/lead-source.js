/**
 * Derive lead source from referrer URL.
 * Used by lead capture to attribute leads (organic, social, referral, direct).
 *
 * @param {string|null|undefined} referrer - Referrer URL
 * @returns {'website_analysis'|'organic_search'|'social'|'referral'|'direct'} Lead source
 */
export function deriveLeadSourceFromReferrer(referrer) {
  if (!referrer) return 'website_analysis';
  if (referrer.includes('google.com') || referrer.includes('bing.com')) return 'organic_search';
  if (referrer.includes('facebook.com') || referrer.includes('linkedin.com')) return 'social';
  if (referrer.includes('automatemyblog.com')) {
    return referrer.includes('?ref=') || referrer.includes('&ref=') ? 'referral' : 'direct';
  }
  return 'referral';
}
