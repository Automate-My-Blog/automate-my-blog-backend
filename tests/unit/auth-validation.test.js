/**
 * Unit tests: auth validation (registration, login, refresh).
 */
import { describe, it, expect } from 'vitest';
import {
  validateRegistrationInput,
  validateLoginInput,
  validateRefreshInput
} from '../../lib/auth-validation.js';
import { ValidationError } from '../../lib/errors.js';

describe('lib/auth-validation', () => {
  describe('validateRegistrationInput', () => {
    it('returns normalized fields when input is valid', () => {
      const out = validateRegistrationInput({
        email: ' Test@Example.COM ',
        password: 'password123',
        firstName: '  Jane  ',
        lastName: 'Doe',
        organizationName: 'Acme'
      });
      expect(out.email).toBe('test@example.com');
      expect(out.firstName).toBe('Jane');
      expect(out.password).toBe('password123');
    });

    it('throws ValidationError when required fields missing', () => {
      expect(() => validateRegistrationInput({})).toThrow(ValidationError);
      expect(() => validateRegistrationInput({ email: 'a@b.com', password: 'longenough' })).toThrow(ValidationError);
    });

    it('throws ValidationError for invalid email', () => {
      expect(() =>
        validateRegistrationInput({
          email: 'not-an-email',
          password: 'password123',
          firstName: 'A',
          lastName: 'B',
          organizationName: 'C'
        })
      ).toThrow(ValidationError);
    });

    it('throws ValidationError when password too short', () => {
      expect(() =>
        validateRegistrationInput({
          email: 'a@b.com',
          password: 'short',
          firstName: 'A',
          lastName: 'B',
          organizationName: 'C'
        })
      ).toThrow(ValidationError);
    });

    it('accepts optional websiteUrl and returns it when valid', () => {
      const out = validateRegistrationInput({
        email: 'u@v.com',
        password: 'password123',
        firstName: 'A',
        lastName: 'B',
        organizationName: 'C',
        websiteUrl: 'https://example.com'
      });
      expect(out.websiteUrl).toBe('https://example.com');
    });

    it('returns null websiteUrl when omitted', () => {
      const out = validateRegistrationInput({
        email: 'u@v.com',
        password: 'password123',
        firstName: 'A',
        lastName: 'B',
        organizationName: 'C'
      });
      expect(out.websiteUrl).toBeNull();
    });

    it('throws ValidationError for invalid websiteUrl when provided', () => {
      expect(() =>
        validateRegistrationInput({
          email: 'a@b.com',
          password: 'password123',
          firstName: 'A',
          lastName: 'B',
          organizationName: 'C',
          websiteUrl: 'not-a-url'
        })
      ).toThrow(ValidationError);
    });
  });

  describe('validateLoginInput', () => {
    it('returns email and password when present', () => {
      const out = validateLoginInput({ email: 'u@v.com', password: 'secret' });
      expect(out.email).toBe('u@v.com');
      expect(out.password).toBe('secret');
    });

    it('throws ValidationError when email or password missing', () => {
      expect(() => validateLoginInput({})).toThrow(ValidationError);
      expect(() => validateLoginInput({ email: 'a@b.com' })).toThrow(ValidationError);
    });
  });

  describe('validateRefreshInput', () => {
    it('returns refreshToken when present', () => {
      const out = validateRefreshInput({ refreshToken: 'abc' });
      expect(out.refreshToken).toBe('abc');
    });

    it('throws ValidationError when refreshToken missing', () => {
      expect(() => validateRefreshInput({})).toThrow(ValidationError);
    });
  });
});
