/**
 * Auth cookie names and options for httpOnly cookie-based auth.
 * Used by login/register (set), refresh (read + set), logout (clear), and auth middleware/SSE (read).
 */

export const COOKIE_NAMES = {
  access: 'access_token',
  refresh: 'refresh_token'
};

// Cross-origin: when true, cookies use SameSite=None; Secure so browser sends them from another origin (e.g. staging frontend → API).
// Set COOKIE_CROSS_ORIGIN=true on staging/production to force this if VERCEL/NODE_ENV aren't set as expected.
const isProduction = process.env.NODE_ENV === 'production';
const isVercel = process.env.VERCEL === '1';
const crossOriginEnv = (process.env.COOKIE_CROSS_ORIGIN || '').toLowerCase();
const forceCrossOriginEnv = crossOriginEnv === 'true' || crossOriginEnv === '1' || crossOriginEnv === 'yes';
export const useCrossOriginCookies = isProduction || isVercel || forceCrossOriginEnv;

/** Secure=true required for SameSite=None; use whenever we might set SameSite=none. */
const isSecure = useCrossOriginCookies || process.env.COOKIE_SECURE === 'true';

/**
 * SameSite for auth cookies.
 * In production and on Vercel we default to 'none' so cookies are sent on cross-origin requests
 * (e.g. frontend at staging.automatemyblog.com → API at *.vercel.app). Requires Secure.
 * Override with COOKIE_SAME_SITE=lax|strict|none if needed.
 */
function getSameSite() {
  const v = (process.env.COOKIE_SAME_SITE || '').toLowerCase();
  if (v === 'none') return 'none';
  if (v === 'strict') return 'strict';
  if (v === 'lax') return 'lax';
  return useCrossOriginCookies ? 'none' : 'lax';
}

/**
 * Options for setting auth cookies: HttpOnly, Secure, SameSite, Path=/, optional Domain.
 * When SameSite=None we always set Secure=true (browser requirement).
 */
export function getAuthCookieOptions({ accessMaxAgeSeconds, refreshMaxAgeSeconds } = {}) {
  const sameSite = getSameSite();
  const secure = sameSite === 'none' ? true : isSecure;

  const base = {
    httpOnly: true,
    secure,
    sameSite,
    path: '/'
  };
  const domain = (process.env.COOKIE_DOMAIN || '').trim() || undefined;
  if (domain) base.domain = domain;

  return {
    access: {
      ...base,
      maxAge: accessMaxAgeSeconds ?? (7 * 24 * 60 * 60), // 7d default
    },
    refresh: {
      ...base,
      maxAge: refreshMaxAgeSeconds ?? (30 * 24 * 60 * 60), // 30d default
    }
  };
}

/** Options for clearing cookies (must match path/domain/secure/sameSite used when setting). */
export function getAuthCookieClearOptions() {
  const sameSite = getSameSite();
  const secure = sameSite === 'none' ? true : isSecure;
  const opts = { path: '/', httpOnly: true, secure, sameSite };
  const domain = (process.env.COOKIE_DOMAIN || '').trim() || undefined;
  if (domain) opts.domain = domain;
  return opts;
}

const ACCESS_MAX_AGE = 7 * 24 * 60 * 60;
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

function getDomainPart() {
  const domain = (process.env.COOKIE_DOMAIN || '').trim() || '';
  return domain ? `; Domain=${domain}` : '';
}

/**
 * Build raw Set-Cookie header values for auth cookies with exact attributes for cross-origin.
 * Guarantees SameSite=None; Secure in the response.
 * @param {string} accessToken
 * @param {string} refreshToken
 * @returns {[string, string]} Two Set-Cookie header values [access, refresh]
 */
export function buildAuthSetCookieHeaders(accessToken, refreshToken) {
  const domainPart = getDomainPart();
  return [
    `${COOKIE_NAMES.access}=${accessToken}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${ACCESS_MAX_AGE}${domainPart}`,
    `${COOKIE_NAMES.refresh}=${refreshToken}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${REFRESH_MAX_AGE}${domainPart}`
  ];
}

/**
 * Build raw Set-Cookie header values to clear auth cookies (Max-Age=0). Must match Path/Domain/Secure/SameSite used when setting.
 */
export function buildAuthClearCookieHeaders() {
  const domainPart = getDomainPart();
  return [
    `${COOKIE_NAMES.access}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0${domainPart}`,
    `${COOKIE_NAMES.refresh}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0${domainPart}`
  ];
}

/**
 * Parse Cookie header into a plain object. Handles simple key=value; key2=value2.
 * @param {string} [header]
 * @returns {{ [key: string]: string }}
 */
export function parseCookieHeader(header) {
  if (!header || typeof header !== 'string') return {};
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}
