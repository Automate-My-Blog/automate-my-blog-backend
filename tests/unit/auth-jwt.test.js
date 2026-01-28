import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/database.js', () => ({
  default: {
    query: vi.fn(),
    testConnection: vi.fn().mockResolvedValue(true),
  },
}));

import DatabaseAuthService from '../../services/auth-database.js';

describe('auth (JWT)', () => {
  let auth;

  beforeEach(() => {
    auth = new DatabaseAuthService();
  });

  describe('generateTokens + verifyToken round-trip', () => {
    it('returns access and refresh tokens for a user', () => {
      const user = {
        id: 'user-123',
        email: 'test@example.com',
        first_name: 'Test',
        last_name: 'User',
        role: 'user',
      };
      const tokens = auth.generateTokens(user);
      expect(tokens).toHaveProperty('accessToken');
      expect(tokens).toHaveProperty('refreshToken');
      expect(tokens).toHaveProperty('expiresIn');
      expect(typeof tokens.accessToken).toBe('string');
      expect(typeof tokens.refreshToken).toBe('string');
      expect(tokens.accessToken.length).toBeGreaterThan(0);
    });

    it('verifyToken decodes a valid access token', () => {
      const user = {
        id: 'user-456',
        email: 'jwt@example.com',
        first_name: 'JWT',
        last_name: 'Test',
        role: 'user',
      };
      const { accessToken } = auth.generateTokens(user);
      const decoded = auth.verifyToken(accessToken);
      expect(decoded).toHaveProperty('userId', user.id);
      expect(decoded).toHaveProperty('email', user.email);
      expect(decoded).toHaveProperty('firstName');
      expect(decoded).toHaveProperty('lastName');
      expect(decoded).toHaveProperty('role');
    });

    it('verifyToken throws for invalid or malformed token', () => {
      expect(() => auth.verifyToken('not-a-jwt')).toThrow(/Invalid or expired token/);
      expect(() => auth.verifyToken('')).toThrow(/Invalid or expired token/);
      expect(() => auth.verifyToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.sign')).toThrow(/Invalid or expired token/);
    });
  });
});
