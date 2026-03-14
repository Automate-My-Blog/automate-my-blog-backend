import db from './services/database.js';

async function runEssentialMigration() {
  try {
    console.log('🔧 Running essential organization intelligence migration...');
    
    // First, check if organization_intelligence table exists
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'organization_intelligence'
      );
    `);
    
    if (tableCheck.rows[0].exists) {
      console.log('✅ organization_intelligence table already exists');
    } else {
      console.log('🔧 Creating organization_intelligence table...');
      
      // Create the organization_intelligence table
      await db.query(`
        CREATE TABLE organization_intelligence (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
          
          -- Customer scenarios and business psychology
          customer_scenarios JSONB,
          business_value_assessment JSONB,
          customer_language_patterns JSONB,
          search_behavior_insights JSONB,
          
          -- SEO and content strategy
          seo_opportunities JSONB,
          content_strategy_recommendations JSONB,
          competitive_intelligence JSONB,
          
          -- Analysis metadata
          analysis_type VARCHAR(50) DEFAULT 'website_analysis',
          analysis_confidence_score DECIMAL(3,2) DEFAULT 0.75,
          data_sources JSONB,
          ai_model_used VARCHAR(50),
          web_enhancement_successful BOOLEAN DEFAULT FALSE,
          
          -- Raw analysis data backup
          raw_openai_response JSONB,
          
          -- Versioning and tracking
          analysis_version INTEGER DEFAULT 1,
          superseded_by UUID REFERENCES organization_intelligence(id),
          is_current BOOLEAN DEFAULT TRUE,
          
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('✅ organization_intelligence table created');
    }
    
    // Check and add missing columns to organizations table
    const orgColumns = [
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
    
    for (const column of orgColumns) {
      const columnCheck = await db.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'organizations' 
          AND column_name = $1
        );
      `, [column.name]);
      
      if (!columnCheck.rows[0].exists) {
        console.log(`🔧 Adding column ${column.name} to organizations table...`);
        await db.query(`ALTER TABLE organizations ADD COLUMN ${column.name} ${column.type};`);
        console.log(`✅ Column ${column.name} added`);
      } else {
        console.log(`✅ Column ${column.name} already exists`);
      }
    }
    
    // Create indexes for performance
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_organization_intelligence_org_id ON organization_intelligence(organization_id);',
      'CREATE INDEX IF NOT EXISTS idx_organization_intelligence_current ON organization_intelligence(organization_id, is_current) WHERE is_current = TRUE;'
    ];
    
    for (const indexSql of indexes) {
      try {
        await db.query(indexSql);
        console.log('✅ Index created successfully');
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log('✅ Index already exists');
        } else {
          console.log('⚠️ Index creation failed:', error.message);
        }
      }
    }
    
    // Final verification
    console.log('🔍 Verifying migration results...');
    
    const intelColumns = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'organization_intelligence' 
      ORDER BY column_name
    `);
    
    console.log('📋 Organization intelligence columns:', intelColumns.rows.map(r => r.column_name));
    
    if (intelColumns.rows.some(r => r.column_name === 'competitive_intelligence')) {
      console.log('✅ CRITICAL: competitive_intelligence column successfully created!');
    } else {
      console.log('❌ CRITICAL: competitive_intelligence column not found!');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Full error:', error);
  } finally {
    await db.close();
  }
}

runEssentialMigration();