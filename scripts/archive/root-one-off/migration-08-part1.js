import db from './services/database.js';

async function runMigrationPart1() {
  console.log('🔧 Migration 08 Part 1: Add organization columns');
  
  try {
    // Add business intelligence fields to organizations table one by one
    const columns = [
      { name: 'business_type', type: 'VARCHAR(255)' },
      { name: 'industry_category', type: 'VARCHAR(100)' },
      { name: 'business_model', type: 'TEXT' },
      { name: 'company_size', type: 'VARCHAR(50)' },
      { name: 'description', type: 'TEXT' },
      { name: 'target_audience', type: 'TEXT' },
      { name: 'brand_voice', type: 'VARCHAR(100)' },
      { name: 'website_goals', type: 'TEXT' },
      { name: 'last_analyzed_at', type: 'TIMESTAMP' }
    ];

    for (const column of columns) {
      try {
        // Check if column exists
        const exists = await db.query(`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'organizations' AND column_name = $1
          );
        `, [column.name]);

        if (!exists.rows[0].exists) {
          console.log(`Adding column: ${column.name}`);
          await db.query(`ALTER TABLE organizations ADD COLUMN ${column.name} ${column.type};`);
          console.log(`✅ Added ${column.name}`);
        } else {
          console.log(`✅ Column ${column.name} already exists`);
        }
      } catch (error) {
        console.error(`❌ Failed to add column ${column.name}:`, error.message);
        throw error;
      }
    }

    // Add basic indexes for new columns
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_organizations_business_type ON organizations(business_type) WHERE business_type IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_organizations_industry ON organizations(industry_category) WHERE industry_category IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_organizations_company_size ON organizations(company_size) WHERE company_size IS NOT NULL`
    ];

    for (const indexSql of indexes) {
      try {
        await db.query(indexSql);
        console.log(`✅ Index created`);
      } catch (error) {
        console.log(`⚠️ Index creation failed: ${error.message}`);
      }
    }

    // Verify results
    const result = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'organizations' 
      AND column_name IN ('business_type', 'industry_category', 'business_model', 'target_audience', 'brand_voice')
      ORDER BY column_name
    `);

    console.log('📋 Organization columns added:', result.rows.map(r => r.column_name));
    console.log('✅ Part 1 completed successfully');

  } catch (error) {
    console.error('❌ Part 1 failed:', error.message);
    throw error;
  } finally {
    await db.close();
  }
}

runMigrationPart1();