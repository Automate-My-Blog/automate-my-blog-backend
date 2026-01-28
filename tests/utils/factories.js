/**
 * Factory builders for test entities.
 * Use for creating User, Project, Post, etc. with sensible defaults.
 */

/**
 * @param {Partial<object>} overrides
 * @returns {object} Project-like object for tests
 */
export function project(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: 'proj-uuid-1',
    userId: 'user-uuid-1',
    name: 'Test Project',
    websiteUrl: 'https://example.com',
    businessType: 'b2b',
    targetAudience: 'SMB owners',
    contentFocus: 'SEO',
    brandVoice: 'professional',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * @param {Partial<object>} overrides
 * @returns {object} User-like object for tests
 */
export function user(overrides = {}) {
  return {
    id: 'user-uuid-1',
    email: 'test@example.com',
    first_name: 'Test',
    last_name: 'User',
    role: 'user',
    status: 'active',
    ...overrides,
  };
}

/**
 * @param {Partial<object>} overrides
 * @returns {object} CTA-like object for tests
 */
export function cta(overrides = {}) {
  return {
    text: 'Get Started',
    type: 'button',
    placement: 'main_content',
    href: 'https://example.com/start',
    ...overrides,
  };
}
