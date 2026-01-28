/**
 * Test fixtures for unit tests.
 * Use these for consistent, readable test data.
 */

export const ctaFixtures = {
  minimal: { text: 'Sign Up', type: 'button', href: '/signup' },
  full: {
    text: 'Book a Demo',
    type: 'demo',
    placement: 'header',
    href: 'https://example.com/demo',
    context: 'above fold',
    className: 'btn-primary',
    tagName: 'a',
    conversion_potential: 85,
    visibility_score: 90,
  },
  alternativeFields: {
    cta_text: 'Contact Us',
    cta_type: 'contact_link',
    placement: 'footer',
    href: 'mailto:hello@example.com',
    conversionPotential: 80,
    visibilityScore: 70,
  },
  unknownType: { text: 'Click', type: 'unknown_thing', href: '#' },
  emptyOptional: { text: 'Submit', type: 'form', href: '' },
};

export const contentFixtures = {
  empty: '',
  noUrls: 'Just plain text with no links.',
  markdownOnly: 'See [our docs](https://example.com/docs) for more.',
  htmlOnly: '<p>Visit <a href="https://example.com">home</a>.</p>',
  bareUrls: 'Check https://example.com and https://other.com.',
  placeholder: 'Sign up at [your website](https://yourwebsite.com) or [insert url here](https://example.com/placeholder).',
  relative: 'Go [home](/about) or <a href="/contact">contact</a>.',
  mailtoTel: 'Email <a href="mailto:hi@example.com">us</a> or call <a href="tel:+15551234567">here</a>.',
  authoritative: 'Source: [NIH](https://www.nih.gov/foo) and [CDC](https://www.cdc.gov/bar).',
  mixed: `
Intro. [Link A](https://example.com/a) and <a href="https://example.com/b">Link B</a>.
Also https://example.com/c. Avoid [bad](https://yourwebsite.com).
  `.trim(),
};

export const validationResultFixtures = {
  allValid: {
    results: [
      { href: 'https://a.com', valid: true },
      { href: '/about', valid: true },
    ],
  },
  someInvalid: {
    results: [
      { href: 'https://a.com', valid: true },
      { href: 'https://b.com', valid: false, error: '404' },
    ],
  },
  empty: { results: [] },
  singleInvalid: {
    results: [{ href: 'https://x.com', valid: false, error: 'ETIMEDOUT' }],
  },
};

export const linkFixtures = {
  relative: { href: '/about' },
  mailto: { href: 'mailto:admin@example.com' },
  tel: { href: 'tel:+15551234567' },
  anchor: { href: '#section' },
  absolute: { href: 'https://example.com/page' },
  noHref: {},
  targetUrl: { target_url: 'https://example.com/alt' },
  urlOnly: { url: 'https://example.com/url-only' },
};
