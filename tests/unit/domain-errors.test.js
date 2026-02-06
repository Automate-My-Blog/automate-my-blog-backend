/**
 * Unit tests: domain errors and toHttpResponse mapping.
 */
import { describe, it, expect } from 'vitest';
import {
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ConflictError,
  InvariantViolation,
  ServiceUnavailableError,
  toHttpResponse
} from '../../lib/errors.js';

describe('lib/errors', () => {
  describe('toHttpResponse', () => {
    it('maps NotFoundError to 404', () => {
      const err = new NotFoundError('Blog post not found');
      const { statusCode, body } = toHttpResponse(err);
      expect(statusCode).toBe(404);
      expect(body).toEqual({ error: 'Blog post not found', message: 'Blog post not found' });
    });

    it('maps ValidationError to 400', () => {
      const err = new ValidationError('Invalid email');
      const { statusCode, body } = toHttpResponse(err);
      expect(statusCode).toBe(400);
      expect(body.message).toBe('Invalid email');
    });

    it('maps UnauthorizedError to 401', () => {
      const err = new UnauthorizedError('Invalid token');
      const { statusCode } = toHttpResponse(err);
      expect(statusCode).toBe(401);
    });

    it('maps ConflictError to 409', () => {
      const err = new ConflictError('User already exists');
      const { statusCode } = toHttpResponse(err);
      expect(statusCode).toBe(409);
    });

    it('maps InvariantViolation to statusCode on error (default 400)', () => {
      const err = new InvariantViolation('Job is not cancellable');
      const { statusCode } = toHttpResponse(err);
      expect(statusCode).toBe(400);
    });

    it('maps ServiceUnavailableError to 503', () => {
      const err = new ServiceUnavailableError('Redis required');
      const { statusCode } = toHttpResponse(err);
      expect(statusCode).toBe(503);
    });

    it('maps legacy err.statusCode to that status', () => {
      const err = new Error('Job is not in failed state');
      err.statusCode = 400;
      const { statusCode } = toHttpResponse(err);
      expect(statusCode).toBe(400);
    });

    it('maps generic Error to 500', () => {
      const err = new Error('Database connection failed');
      const { statusCode, body } = toHttpResponse(err);
      expect(statusCode).toBe(500);
      expect(body.message).toBe('Database connection failed');
    });
  });
});
