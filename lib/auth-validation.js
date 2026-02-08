/**
 * Auth input validation: named rules for registration and login.
 * Throws ValidationError (lib/errors.js) so handlers can delegate to central error mapping.
 */

import { ValidationError } from './errors.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
// URL with or without protocol, with or without www (e.g. example.com, https://example.com)
const WEBSITE_URL_REGEX = /^(https?:\/\/)?(www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/.*)?$/;

/**
 * Validate registration body. Throws ValidationError with a single message.
 * @param {{ email?: string, password?: string, firstName?: string, lastName?: string, organizationName?: string, websiteUrl?: string }} body
 */
export function validateRegistrationInput(body) {
  const { email, password, firstName, lastName, organizationName, websiteUrl } = body || {};
  if (!email || !password || !firstName || !lastName || !organizationName) {
    throw new ValidationError(
      'Missing required fields',
      'email, password, firstName, lastName, and organizationName are required'
    );
  }
  if (!EMAIL_REGEX.test(String(email).trim())) {
    throw new ValidationError('Invalid email format', 'Please provide a valid email address');
  }
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(
      'Invalid password',
      'Password must be at least 8 characters long'
    );
  }
  const trimmedWebsite = websiteUrl != null ? String(websiteUrl).trim() : '';
  if (trimmedWebsite && !WEBSITE_URL_REGEX.test(trimmedWebsite)) {
    throw new ValidationError(
      'Invalid website URL',
      'Please provide a valid website URL (e.g. example.com or https://example.com)'
    );
  }
  return {
    email: String(email).toLowerCase().trim(),
    password: String(password),
    firstName: String(firstName).trim(),
    lastName: String(lastName).trim(),
    organizationName: String(organizationName).trim(),
    websiteUrl: trimmedWebsite || null
  };
}

/**
 * Validate login body. Throws ValidationError if missing credentials.
 * @param {{ email?: string, password?: string }} body
 */
export function validateLoginInput(body) {
  const { email, password } = body || {};
  if (!email || !password) {
    throw new ValidationError('Missing credentials', 'Email and password are required');
  }
  return {
    email: String(email).toLowerCase().trim(),
    password: String(password)
  };
}

/**
 * Validate refresh token body. Throws ValidationError if missing.
 * @param {{ refreshToken?: string }} body
 */
export function validateRefreshInput(body) {
  const refreshToken = body?.refreshToken;
  if (!refreshToken) {
    throw new ValidationError('Missing refresh token', 'Refresh token is required');
  }
  return { refreshToken: String(refreshToken) };
}
