/**
 * Auth cookie names and options for httpOnly cookie-based auth.
 * Used by login/register (set), refresh (read + set), logout (clear), and auth middleware/SSE (read).
 */

export const COOKIE_NAMES = {
  access: 'access_token',
  refresh: 'refresh_token'
};

const isProduction = process.env.NODE_ENV === 'production';
const isSecure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';

/** SameSite: Lax for same-site; use 'none' only when frontend is on a different site (e.g. different domain). */
function getSameSite() {
  const v = (process.env.COOKIE_SAME_SITE || '').toLowerCase();
  if (v === 'none') return 'none';
  if (v === 'strict') return 'strict';
  return 'lax';
}

/**
 * Options for setting auth cookies (HttpOnly, Secure in production, Path, MaxAge).
 * @param {{ accessMaxAgeSeconds?: number, refreshMaxAgeSeconds?: number }}
 */
export function getAuthCookieOptions({ accessMaxAgeSeconds, refreshMaxAgeSeconds } = {}) {
  const base = {
    httpOnly: true,
    secure: isSecure,
    sameSite: getSameSite(),
    path: '/'
  };
  const domain = (process.env.COOKIE_DOMAIN || '').trim() || undefined;
  if (domain) base.domain = domain;

  return {
    access: {
      ...base,
      maxAge: accessMaxAgeSeconds ?? (7 * 24 * 60 * 60), // 7d default
      sameSite: base.sameSite
    },
    refresh: {
      ...base,
      maxAge: refreshMaxAgeSeconds ?? (30 * 24 * 60 * 60), // 30d default
      sameSite: base.sameSite
    }
  };
}

/** Options for clearing cookies (must match path/domain/secure/sameSite used when setting). */
export function getAuthCookieClearOptions() {
  const opts = { path: '/', httpOnly: true, secure: isSecure, sameSite: getSameSite() };
  const domain = (process.env.COOKIE_DOMAIN || '').trim() || undefined;
  if (domain) opts.domain = domain;
  return opts;
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
