/**
 * Content Validator Service
 * Validates generated blog content for placeholder URLs and link integrity
 */

/**
 * Extract all URLs from markdown/HTML content
 * @param {String} content - Blog content (markdown or HTML)
 * @returns {Array} Array of found URLs
 */
function extractURLs(content) {
  if (!content) return [];

  const urls = [];

  // Match markdown links: [text](url)
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = markdownLinkRegex.exec(content)) !== null) {
    urls.push({
      text: match[1],
      url: match[2],
      type: 'markdown'
    });
  }

  // Match HTML links: <a href="url">text</a>
  const htmlLinkRegex = /<a\s+(?:[^>]*?\s+)?href="([^"]*)"/gi;
  while ((match = htmlLinkRegex.exec(content)) !== null) {
    urls.push({
      url: match[1],
      type: 'html'
    });
  }

  // Match bare URLs (http/https)
  const bareUrlRegex = /https?:\/\/[^\s\)"\]]+/g;
  while ((match = bareUrlRegex.exec(content)) !== null) {
    // Only add if not already captured in markdown/HTML links
    const alreadyCaptured = urls.some(u => u.url === match[0]);
    if (!alreadyCaptured) {
      urls.push({
        url: match[0],
        type: 'bare'
      });
    }
  }

  return urls;
}

/**
 * Check if URL is a placeholder pattern
 * @param {String} url - URL to check
 * @returns {Boolean} True if URL is a placeholder
 */
function isPlaceholderURL(url) {
  const placeholderPatterns = [
    /yourwebsite\.com/i,
    /example\.com/i,
    /yourdomain\.com/i,
    /your-website/i,
    /\[insert.*url\]/i,
    /\[your.*url\]/i,
    /placeholder/i,
    /xxx/i
  ];

  return placeholderPatterns.some(pattern => pattern.test(url));
}

/**
 * Check if URL is from an approved source
 * @param {String} url - URL to check
 * @param {Array} approvedCTAs - List of approved CTA URLs
 * @param {Array} approvedInternalLinks - List of approved internal link URLs
 * @returns {Object} Validation result
 */
function isApprovedURL(url, approvedCTAs = [], approvedInternalLinks = []) {
  // Build set of approved URLs
  const approvedURLs = new Set();

  approvedCTAs.forEach(cta => {
    if (cta.href) approvedURLs.add(cta.href);
  });

  approvedInternalLinks.forEach(link => {
    if (link.target_url) approvedURLs.add(link.target_url);
  });

  // Check if URL is in approved list
  if (approvedURLs.has(url)) {
    return { approved: true, source: 'approved_list' };
  }

  // Check if it's a relative URL (likely internal)
  if (url.startsWith('/')) {
    return { approved: true, source: 'relative_path' };
  }

  // Check if it's a mailto: or tel: link
  if (url.startsWith('mailto:') || url.startsWith('tel:')) {
    return { approved: true, source: 'contact_link' };
  }

  // Check if it's a known authoritative domain
  const authoritativeDomains = [
    'nih.gov',
    'cdc.gov',
    'who.int',
    'mayoclinic.org',
    'webmd.com',
    'healthline.com',
    'medlineplus.gov',
    // Add more as needed
  ];

  const isAuthoritative = authoritativeDomains.some(domain => url.includes(domain));
  if (isAuthoritative) {
    return { approved: true, source: 'authoritative_domain' };
  }

  // External URL not in approved list
  return { approved: false, source: 'external_unknown' };
}

/**
 * Validate generated content for placeholder URLs and link integrity
 * @param {String} content - Generated blog content
 * @param {Array} allowedCTAs - CTAs that were provided to OpenAI
 * @param {Array} allowedInternalLinks - Internal links that were provided to OpenAI
 * @returns {Object} Validation results
 */
function validateGeneratedContent(content, allowedCTAs = [], allowedInternalLinks = []) {
  console.log('🔍 Validating generated content for placeholder URLs...');

  // Extract all URLs from content
  const foundURLs = extractURLs(content);

  const issues = [];
  const stats = {
    total_urls: foundURLs.length,
    placeholder_urls: 0,
    unapproved_urls: 0,
    approved_urls: 0
  };

  foundURLs.forEach(({ url, text, type }) => {
    // Check for placeholders
    if (isPlaceholderURL(url)) {
      stats.placeholder_urls++;
      issues.push({
        type: 'placeholder',
        url,
        text,
        linkType: type,
        severity: 'high',
        message: 'Found placeholder URL that should be replaced'
      });
      return;
    }

    // Check if URL is approved
    const approval = isApprovedURL(url, allowedCTAs, allowedInternalLinks);

    if (approval.approved) {
      stats.approved_urls++;
    } else {
      stats.unapproved_urls++;
      issues.push({
        type: 'unapproved',
        url,
        text,
        linkType: type,
        severity: 'medium',
        message: `URL not in approved list - may be externally sourced (${approval.source})`
      });
    }
  });

  const isValid = issues.filter(i => i.severity === 'high').length === 0;

  console.log(`✅ Content validation complete:`, stats);

  if (issues.length > 0) {
    console.warn(`⚠️ Found ${issues.length} potential issues:`, issues);
  }

  return {
    valid: isValid,
    issues,
    stats,
    summary: isValid
      ? `All ${stats.total_urls} URLs are valid`
      : `Found ${stats.placeholder_urls} placeholder URLs and ${stats.unapproved_urls} unapproved URLs`
  };
}

/**
 * Remove placeholder links from content
 * Converts placeholder links to plain text
 * @param {String} content - Content with potential placeholder links
 * @returns {String} Content with placeholders removed
 */
function removePlaceholderLinks(content) {
  if (!content) return content;

  // Extract all URLs
  const urls = extractURLs(content);

  let cleanedContent = content;

  urls.forEach(({ url, text }) => {
    if (isPlaceholderURL(url)) {
      // Remove markdown link, keep text
      const markdownPattern = new RegExp(`\\[${text}\\]\\(${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
      cleanedContent = cleanedContent.replace(markdownPattern, text);

      // Remove HTML link, keep text
      const htmlPattern = new RegExp(`<a[^>]*href="${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([^<]*)</a>`, 'gi');
      cleanedContent = cleanedContent.replace(htmlPattern, '$1');
    }
  });

  return cleanedContent;
}

/**
 * Get validation summary for logging
 * @param {Object} validation - Validation result from validateGeneratedContent
 * @returns {String} Human-readable summary
 */
function getValidationSummary(validation) {
  if (!validation) return 'No validation performed';

  const { valid, stats, issues } = validation;

  if (valid && issues.length === 0) {
    return `✅ Content is clean: ${stats.total_urls} URLs, all approved`;
  }

  const highIssues = issues.filter(i => i.severity === 'high').length;
  const mediumIssues = issues.filter(i => i.severity === 'medium').length;

  return `⚠️ Found ${highIssues} critical and ${mediumIssues} medium issues in ${stats.total_urls} URLs`;
}

export default {
  validateGeneratedContent,
  removePlaceholderLinks,
  extractURLs,
  isPlaceholderURL,
  getValidationSummary
};
