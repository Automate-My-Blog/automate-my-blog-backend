import { describe, it, expect } from 'vitest';
import { normalizeCTA } from '../../utils/cta-normalizer.js';
import { ctaFixtures } from '../utils/fixtures.js';

describe('cta-normalizer', () => {
  describe('normalizeCTA', () => {
    it('normalizes minimal CTA with required fields', () => {
      const out = normalizeCTA(ctaFixtures.minimal);
      expect(out.cta_text).toBe('Sign Up');
      expect(out.cta_type).toBe('button');
      expect(out.placement).toBe('main_content');
      expect(out.href).toBe('/signup');
      expect(out.tag_name).toBe('a');
      expect(out.conversion_potential).toBe(70);
      expect(out.visibility_score).toBe(70);
    });

    it('normalizes full CTA and maps type/placement', () => {
      const out = normalizeCTA(ctaFixtures.full);
      expect(out.cta_text).toBe('Book a Demo');
      expect(out.cta_type).toBe('demo_link');
      expect(out.placement).toBe('header');
      expect(out.href).toBe('https://example.com/demo');
      expect(out.context).toBe('above fold');
      expect(out.class_name).toBe('btn-primary');
      expect(out.tag_name).toBe('a');
      expect(out.conversion_potential).toBe(85);
      expect(out.visibility_score).toBe(90);
    });

    it('accepts alternative field names (cta_text, conversionPotential, etc.)', () => {
      const out = normalizeCTA(ctaFixtures.alternativeFields);
      expect(out.cta_text).toBe('Contact Us');
      expect(out.cta_type).toBe('contact_link');
      expect(out.placement).toBe('footer');
      expect(out.href).toBe('mailto:hello@example.com');
      expect(out.conversion_potential).toBe(80);
      expect(out.visibility_score).toBe(70);
    });

    it('maps unknown type to cta_element and invalid placement to main_content', () => {
      const out = normalizeCTA(ctaFixtures.unknownType);
      expect(out.cta_type).toBe('cta_element');
      expect(out.placement).toBe('main_content');
    });

    it('handles empty optional fields with defaults', () => {
      const out = normalizeCTA(ctaFixtures.emptyOptional);
      expect(out.cta_text).toBe('Submit');
      expect(out.cta_type).toBe('form');
      expect(out.href).toBe('');
      expect(out.context).toBe('');
      expect(out.class_name).toBe('');
      expect(out.tag_name).toBe('a');
      expect(out.conversion_potential).toBe(70);
      expect(out.visibility_score).toBe(70);
    });

    it('normalizes type/placement case (trim + lowercase)', () => {
      const out = normalizeCTA({
        text: 'X',
        type: '  DEMO  ',
        placement: '  HEADER  ',
        href: '',
      });
      expect(out.cta_type).toBe('demo_link');
      expect(out.placement).toBe('header');
    });

    it('uses cta_type when type is missing', () => {
      const out = normalizeCTA({ text: 'X', cta_type: 'contact_link', href: '' });
      expect(out.cta_type).toBe('contact_link');
    });

    it('uses placement mapping (content -> main_content, nav -> navigation)', () => {
      expect(normalizeCTA({ text: 'A', type: 'button', placement: 'content', href: '' }).placement).toBe('main_content');
      expect(normalizeCTA({ text: 'A', type: 'button', placement: 'nav', href: '' }).placement).toBe('navigation');
    });

    it('throws when cta is null', () => {
      expect(() => normalizeCTA(null)).toThrow('CTA object is required');
    });

    it('throws when cta is undefined', () => {
      expect(() => normalizeCTA(undefined)).toThrow('CTA object is required');
    });
  });
});
