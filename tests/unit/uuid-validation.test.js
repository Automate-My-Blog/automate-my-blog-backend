import { describe, it, expect } from 'vitest';
import { isUUID } from '../../lib/uuid-validation.js';

describe('uuid-validation', () => {
  it('accepts valid UUID v4', () => {
    expect(isUUID('6b1668f7-c20e-4080-965f-1536e8240f20')).toBe(true);
    expect(isUUID('82086377-f97f-4cff-a3aa-0f64e712bbdd')).toBe(true);
    expect(isUUID('00000000-0000-4000-8000-000000000000')).toBe(true);
  });

  it('rejects placeholder ids from frontend', () => {
    expect(isUUID('analysis-fallback-0')).toBe(false);
    expect(isUUID('analysis-fallback-1')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isUUID(null)).toBe(false);
    expect(isUUID(undefined)).toBe(false);
    expect(isUUID(123)).toBe(false);
  });

  it('rejects malformed strings', () => {
    expect(isUUID('')).toBe(false);
    expect(isUUID('not-a-uuid')).toBe(false);
    expect(isUUID('6b1668f7-c20e-4080-965f')).toBe(false);
  });
});
