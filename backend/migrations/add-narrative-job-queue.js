import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function up() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS narrative_generation_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      error_message TEXT,
      last_error_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Index for efficient job lookup
    CREATE INDEX IF NOT EXISTS idx_narrative_jobs_status_priority
    ON narrative_generation_jobs(status, priority DESC, created_at ASC)
    WHERE status = 'pending';

    -- Index for organization lookup
    CREATE INDEX IF NOT EXISTS idx_narrative_jobs_organization
    ON narrative_generation_jobs(organization_id);

    -- Prevent duplicate pending jobs for same organization
    CREATE UNIQUE INDEX IF NOT EXISTS idx_narrative_jobs_org_pending
    ON narrative_generation_jobs(organization_id)
    WHERE status = 'pending';
  `);

  console.log('✅ Created narrative_generation_jobs table');
}

async function down() {
  await pool.query(`
    DROP TABLE IF EXISTS narrative_generation_jobs CASCADE;
  `);
  console.log('✅ Dropped narrative_generation_jobs table');
}

async function main() {
  try {
    await up();
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run migration
main();

export { up, down };
