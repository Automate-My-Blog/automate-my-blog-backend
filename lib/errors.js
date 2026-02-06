/**
 * Domain errors for consistent business-rule failure handling.
 * Handlers map these to HTTP status and response body without changing API contract.
 */

/** 404-style: resource missing or no access (e.g. blog post not found) */
export class NotFoundError extends Error {
  constructor(message = 'Not found', resource = null) {
    super(message);
    this.name = 'NotFoundError';
    this.resource = resource;
  }
}

/** 400-style: invalid input (validation) */
export class ValidationError extends Error {
  constructor(message = 'Validation failed', details = null) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

/** 401-style: auth required or invalid credentials */
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/** 409-style: conflict (e.g. user already exists) */
export class ConflictError extends Error {
  constructor(message = 'Conflict') {
    super(message);
    this.name = 'ConflictError';
  }
}

/** 400-style: operation not allowed in current state (e.g. job not cancellable) */
export class InvariantViolation extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'InvariantViolation';
    this.statusCode = statusCode;
  }
}

/** 503-style: dependency unavailable (e.g. Redis not configured) */
export class ServiceUnavailableError extends Error {
  constructor(message = 'Service unavailable') {
    super(message);
    this.name = 'ServiceUnavailableError';
  }
}

/**
 * Map a thrown error to HTTP status and JSON body.
 * Preserves existing API shape: { error: string, message: string }.
 *
 * @param {Error} err
 * @returns {{ statusCode: number, body: { error: string, message: string } }}
 */
export function toHttpResponse(err) {
  const body = {
    error: err?.message ? String(err.message).split('\n')[0].slice(0, 200) : 'Error',
    message: err?.message ?? 'An error occurred'
  };

  if (err instanceof NotFoundError) {
    return { statusCode: 404, body: { error: body.error, message: body.message } };
  }
  if (err instanceof ValidationError) {
    const message = err.details != null ? String(err.details) : body.message;
    return { statusCode: 400, body: { error: body.error, message } };
  }
  if (err instanceof UnauthorizedError) {
    return { statusCode: 401, body: { error: body.error, message: body.message } };
  }
  if (err instanceof ConflictError) {
    return { statusCode: 409, body: { error: body.error, message: body.message } };
  }
  if (err instanceof InvariantViolation) {
    const statusCode = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 400;
    return { statusCode, body: { error: body.error, message: body.message } };
  }
  if (err instanceof ServiceUnavailableError) {
    return { statusCode: 503, body: { error: body.error, message: body.message } };
  }

  // Legacy / ad-hoc: statusCode on error (e.g. job-queue retry/cancel)
  if (err && typeof err.statusCode === 'number' && err.statusCode >= 400) {
    return { statusCode: err.statusCode, body: { error: body.error, message: body.message } };
  }

  return { statusCode: 500, body: { error: body.error, message: body.message } };
}
