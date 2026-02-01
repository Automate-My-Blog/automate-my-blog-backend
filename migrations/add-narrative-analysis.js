import db from '../services/database.js';

async function addNarrativeAnalysisColumns() {
  try {
    console.log('📝 Adding narrative analysis columns to organization_intelligence table...');

    await db.query(`
      ALTER TABLE organization_intelligence
      ADD COLUMN IF NOT EXISTS narrative_analysis TEXT,
      ADD COLUMN IF NOT EXISTS narrative_confidence DECIMAL(3,2) DEFAULT 0.8,
      ADD COLUMN IF NOT EXISTS key_insights JSONB
    `);

    console.log('✅ Columns added successfully');

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_org_intelligence_narrative
      ON organization_intelligence(organization_id)
      WHERE narrative_analysis IS NOT NULL
    `);

    console.log('✅ Index created successfully');
    console.log('✅ Database schema updated successfully');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error updating database schema:', error.message);
    console.error(error);
    process.exit(1);
  }
}

addNarrativeAnalysisColumns();
