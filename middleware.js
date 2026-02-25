/**
 * Vercel Edge Middleware: handle OPTIONS (CORS preflight) at the edge
 * so the response always has CORS headers before any Node function runs.
 */
import { next } from '@vercel/functions';

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-session-id',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Max-Age': '86400',
};

function isOriginAllowed(origin) {
  if (!origin) return false;
  return (
    /^https:\/\/(staging\.|www\.)?automatemyblog\.com$/i.test(origin) ||
    /^https?:\/\/[^/]+\.vercel\.app$/i.test(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
  );
}

export const config = {
  matcher: ['/api/:path*'],
};

export default function middleware(request) {
  if (request.method !== 'OPTIONS') {
    return next();
  }
  const origin = request.headers.get('origin') || '';
  let fallback = 'https://staging.automatemyblog.com';
  try {
    if (typeof process !== 'undefined' && process.env) {
      fallback = (process.env.CORS_OPTIONS_FALLBACK_ORIGIN || (process.env.CORS_ORIGINS || '').split(',')[0]?.trim() || fallback).trim() || fallback;
    }
  } catch (_) {}
  const allowOrigin = origin && isOriginAllowed(origin) ? origin : fallback;
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'Access-Control-Allow-Origin': allowOrigin,
      Vary: 'Origin',
    },
  });
}
