/**
 * Integration tests: Voice adaptation schema (migration 037).
 * Verifies voice_samples, aggregated_voice_profiles, and update_organization_data_availability.
 * Requires DATABASE_URL and migration 037 to be applied.
 *
 * @see GitHub issue #245
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('integration voice adaptation schema', () => {
  /** @type {import('pg').Client} */
  let db;
  /** @type {string} */
  let orgId;
  /** @type {string} */
  let sampleId;
  /** @type {string} */
  let profileId;

  beforeAll(async () => {
    const mod = await import('../../services/database.js');
    db = mod.default;
  });

  it('voice_samples and aggregated_voice_profiles tables exist', async () => {
    const tables = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('voice_samples', 'aggregated_voice_profiles')`
    );
    expect(tables.rows.map((r) => r.table_name).sort()).toEqual([
      'aggregated_voice_profiles',
      'voice_samples',
    ]);
  });

  it('voice_samples has required columns and constraints', async () => {
    const cols = await db.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'voice_samples'
       ORDER BY ordinal_position`
    );
    const names = cols.rows.map((r) => r.column_name);
    expect(names).toContain('organization_id');
    expect(names).toContain('source_type');
    expect(names).toContain('raw_content');
    expect(names).toContain('processing_status');
    expect(names).toContain('style_analysis');
    expect(names).toContain('vocabulary_analysis');
    expect(names).toContain('structural_patterns');
    expect(names).toContain('formatting_preferences');
    expect(names).toContain('quality_score');
    expect(names).toContain('is_active');
    expect(names).toContain('weight');
  });

  it('aggregated_voice_profiles has required columns', async () => {
    const cols = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'aggregated_voice_profiles'
       ORDER BY ordinal_position`
    );
    const names = cols.rows.map((r) => r.column_name);
    expect(names).toContain('organization_id');
    expect(names).toContain('style');
    expect(names).toContain('vocabulary');
    expect(names).toContain('structure');
    expect(names).toContain('formatting');
    expect(names).toContain('sample_count');
    expect(names).toContain('total_word_count');
    expect(names).toContain('confidence_score');
  });

  it('organizations has voice_adaptation_settings column', async () => {
    const cols = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'organizations'
         AND column_name = 'voice_adaptation_settings'`
    );
    expect(cols.rows.length).toBe(1);
  });

  it('insert voice_sample and aggregated_voice_profile, update_organization_data_availability returns has_voice_samples', async () => {
    const orgRes = await db.query(
      `SELECT id FROM organizations ORDER BY created_at DESC LIMIT 1`
    );
    expect(orgRes.rows.length).toBeGreaterThan(0);
    orgId = orgRes.rows[0].id;

    const insertSample = await db.query(
      `INSERT INTO voice_samples (
         organization_id, source_type, raw_content, word_count,
         processing_status, quality_score, is_active
       ) VALUES ($1, 'blog_post', 'Sample content for voice test.', 5, 'completed', 80, TRUE)
       RETURNING id`,
      [orgId]
    );
    sampleId = insertSample.rows[0].id;

    const insertProfile = await db.query(
      `INSERT INTO aggregated_voice_profiles (
         organization_id, sample_count, total_word_count, confidence_score,
         style, vocabulary, structure, formatting
       ) VALUES ($1, 1, 5, 60, '{}', '{}', '{}', '{}')
       ON CONFLICT (organization_id) DO UPDATE SET
         sample_count = 1, total_word_count = 5, confidence_score = 60, updated_at = NOW()
       RETURNING id`,
      [orgId]
    );
    profileId = insertProfile.rows[0].id;

    const availability = await db.query(
      'SELECT update_organization_data_availability($1) AS result',
      [orgId]
    );
    const result = availability.rows[0].result;
    expect(result).toBeDefined();
    expect(result.has_voice_samples).toBe(true);
    expect(typeof result.completeness_score).toBe('number');
    expect(result.last_voice_profile_at).toBeDefined();
  });

  it('rejects invalid source_type on voice_samples', async () => {
    const orgRes = await db.query('SELECT id FROM organizations LIMIT 1');
    const oid = orgRes.rows[0].id;
    await expect(
      db.query(
        `INSERT INTO voice_samples (organization_id, source_type, raw_content, word_count)
         VALUES ($1, 'invalid_type', 'x', 1)`,
        [oid]
      )
    ).rejects.toMatchObject({ code: '23514' });
  });

  afterAll(async () => {
    if (!db) return;
    if (sampleId) {
      await db.query('DELETE FROM voice_samples WHERE id = $1', [sampleId]).catch(() => {});
    }
    if (profileId) {
      await db.query('DELETE FROM aggregated_voice_profiles WHERE id = $1', [profileId]).catch(() => {});
    }
    if (orgId) {
      await db.query('SELECT update_organization_data_availability($1)', [orgId]).catch(() => {});
    }
  });
});
