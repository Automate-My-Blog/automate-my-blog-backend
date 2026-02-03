/**
 * SSE (Server-Sent Events) streaming helpers.
 * Reusable utilities for formatting and writing SSE messages.
 * Used by stream-manager and stream routes (Phase 1+).
 */

/**
 * Format a single SSE message (event type + data, newline-delimited).
 * @param {string} event - Event type (e.g. 'message', 'progress', 'error')
 * @param {string|object} data - Payload; objects are JSON.stringify'd
 * @returns {string} SSE-formatted string
 */
export function formatSSE(event, data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload.replace(/\n/g, '\ndata: ')}\n\n`;
}

/**
 * Write an SSE message to the response and flush.
 * @param {import('express').Response} res - Express response (must be SSE-ready)
 * @param {string} event - Event type
 * @param {string|object} data - Payload
 */
export function writeSSE(res, event, data) {
  if (res.writableEnded) return;
  res.write(formatSSE(event, data));
}

/**
 * Send a keepalive comment to prevent timeouts (e.g. proxy/load balancer).
 * @param {import('express').Response} res - Express response
 */
export function sendKeepalive(res) {
  if (res.writableEnded) return;
  res.write(': keepalive\n\n');
}

/**
 * Default interval for keepalive (ms). Can be overridden by caller.
 */
export const DEFAULT_KEEPALIVE_MS = 15000;
