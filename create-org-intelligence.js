import db from './services/database.js';

async function createOrganizationIntelligence() {
  try {
    console.log('🔧 Creating organization intelligence structure...');
    
    // Step 1: Add all columns to organizations table
    console.log('📊 Adding business intelligence columns to organizations...');
    await db.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'industry_category') THEN
              ALTER TABLE organizations ADD COLUMN industry_category VARCHAR(100);
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'business_model') THEN
              ALTER TABLE organizations ADD COLUMN business_model TEXT;
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'company_size') THEN
              ALTER TABLE organizations ADD COLUMN company_size VARCHAR(50);
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'description') THEN
              ALTER TABLE organizations ADD COLUMN description TEXT;
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'target_audience') THEN
              ALTER TABLE organizations ADD COLUMN target_audience TEXT;
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'brand_voice') THEN
              ALTER TABLE organizations ADD COLUMN brand_voice VARCHAR(100);
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'website_goals') THEN
              ALTER TABLE organizations ADD COLUMN website_goals TEXT;
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'last_analyzed_at') THEN
              ALTER TABLE organizations ADD COLUMN last_analyzed_at TIMESTAMP;
          END IF;
      END $$;
    `);
    
    // Step 2: Create organization_intelligence table
    console.log('🧠 Creating organization_intelligence table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS organization_intelligence (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
          customer_scenarios JSONB,
          business_value_assessment JSONB,
          customer_language_patterns JSONB,
          search_behavior_insights JSONB,
          seo_opportunities JSONB,
          content_strategy_recommendations JSONB,
          analysis_confidence_score DECIMAL(3,2) DEFAULT 0.75,
          raw_openai_response JSONB,
          is_current BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Step 3: Add organization_id to website_leads
    console.log('🔗 Adding organization reference to website_leads...');
    await db.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'website_leads' AND column_name = 'organization_id') THEN
              ALTER TABLE website_leads ADD COLUMN organization_id UUID REFERENCES organizations(id);
          END IF;
      END $$;
    `);
    
    // Step 4: Create indexes
    console.log('📇 Creating indexes...');
    await db.query(`CREATE INDEX IF NOT EXISTS idx_organizations_business_type ON organizations(business_type);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_organization_contacts_org_id ON organization_contacts(organization_id);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_organization_intelligence_org_id ON organization_intelligence(organization_id);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_website_leads_organization ON website_leads(organization_id);`);
    
    // Step 5: Create useful functions
    console.log('⚙️ Creating utility functions...');
    await db.query(`
      CREATE OR REPLACE FUNCTION get_organization_decision_makers(p_organization_id UUID)
      RETURNS JSONB AS $$
      DECLARE
          decision_makers JSONB;
      BEGIN
          SELECT json_agg(
              json_build_object(
                  'name', name,
                  'title', title,
                  'role_type', role_type
              )
          ) INTO decision_makers
          FROM organization_contacts
          WHERE organization_id = p_organization_id 
            AND role_type IN ('decision_maker', 'executive')
          ORDER BY role_type DESC;
          
          RETURN COALESCE(decision_makers, '[]'::jsonb);
      END;
      $$ LANGUAGE plpgsql;
    `);
    
    // Step 6: Verify everything was created
    console.log('✅ Verifying database structure...');
    
    const tables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('organization_contacts', 'organization_intelligence', 'organizations', 'website_leads')
    `);
    
    console.log('📋 Tables:', tables.rows.map(r => r.table_name));
    
    const orgColumns = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'organizations' 
        AND column_name IN ('business_type', 'industry_category', 'business_model', 'company_size', 'target_audience')
    `);
    
    console.log('📋 Organization columns added:', orgColumns.rows.map(r => r.column_name));
    
    const leadColumns = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'website_leads' 
        AND column_name = 'organization_id'
    `);
    
    console.log('📋 Website leads organization_id:', leadColumns.rows.length > 0 ? '✅ Added' : '❌ Missing');
    
    console.log('🎉 Organization intelligence structure created successfully!');
    
  } catch (error) {
    console.error('❌ Failed to create structure:', error.message);
  } finally {
    await db.close();
  }
}

createOrganizationIntelligence();