/**
 * Helpers for session-adoption integration tests.
 * Create anonymous org + org_intelligence, then adopt via API.
 */
import db from '../../services/database.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Insert anonymous organization and organization_intelligence for a session.
 * @param {string} sessionId
 * @returns {Promise<{ orgId: string; intelId: string }>}
 */
export async function createAnonymousSessionData(sessionId) {
  const slug = `test-adopt-${sessionId.slice(0, 12)}-${Date.now()}`;
  const orgRes = await db.query(
    `INSERT INTO organizations (id, name, slug, session_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())
     RETURNING id`,
    [uuidv4(), 'Anonymous Test Org', slug, sessionId]
  );
  const orgId = orgRes.rows[0].id;

  const intelRes = await db.query(
    `INSERT INTO organization_intelligence (id, session_id, is_current, analysis_type, created_at, updated_at)
     VALUES ($1, $2, TRUE, 'website_analysis', NOW(), NOW())
     RETURNING id`,
    [uuidv4(), sessionId]
  );
  const intelId = intelRes.rows[0].id;

  return { orgId, intelId };
}
