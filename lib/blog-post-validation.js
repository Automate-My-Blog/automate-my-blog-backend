/**
 * Blog post input validation: named rules for create and update.
 * Throws ValidationError so handlers can delegate to central error mapping.
 */

import { ValidationError } from './errors.js';

/**
 * Validate create blog post body. Throws ValidationError if required fields missing.
 * @param {{ title?: string, content?: string, topic?: unknown, businessInfo?: unknown, status?: string }} body
 * @returns {{ title: string, content: string, topic?: unknown, businessInfo?: unknown, status: string }}
 */
export function validateCreateBlogPostBody(body) {
  const { title, content, topic, businessInfo, status = 'draft' } = body || {};
  if (!title || (typeof title === 'string' && !title.trim())) {
    throw new ValidationError('Missing required fields', 'title and content are required');
  }
  if (!content || (typeof content === 'string' && !content.trim())) {
    throw new ValidationError('Missing required fields', 'title and content are required');
  }
  return {
    title: String(title).trim(),
    content: typeof content === 'string' ? content : String(content),
    topic,
    businessInfo,
    status: status ? String(status).trim() : 'draft'
  };
}

/**
 * Validate update blog post body. At least one of title, content, status must be provided.
 * Throws ValidationError if no updates.
 * @param {{ title?: string, content?: string, status?: string }} body
 * @returns {{ title?: string, content?: string, status?: string }}
 */
export function validateUpdateBlogPostBody(body) {
  const updates = {};
  if (body?.title !== undefined) updates.title = body.title;
  if (body?.content !== undefined) updates.content = body.content;
  if (body?.status !== undefined) updates.status = body.status;

  if (Object.keys(updates).length === 0) {
    throw new ValidationError(
      'No updates provided',
      'At least one field (title, content, status) must be provided'
    );
  }
  return updates;
}
