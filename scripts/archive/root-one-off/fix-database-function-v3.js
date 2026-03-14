import db from './services/database.js';

async function fixDatabaseFunctionV3() {
  try {
    console.log('🔧 Fixing get_organization_decision_makers function (v3)...');
    
    // Drop and recreate the function with correct aggregation
    await db.query(`
      CREATE OR REPLACE FUNCTION get_organization_decision_makers(p_organization_id UUID)
      RETURNS JSONB AS $$
      DECLARE
          decision_makers JSONB;
      BEGIN
          SELECT COALESCE(
            json_agg(
              json_build_object(
                  'name', oc.name,
                  'title', oc.title,
                  'role_type', oc.role_type
              ) ORDER BY oc.role_type DESC
            ),
            '[]'::json
          )::jsonb INTO decision_makers
          FROM organization_contacts oc
          WHERE oc.organization_id = p_organization_id 
            AND oc.role_type IN ('decision_maker', 'executive');
          
          RETURN decision_makers;
      END;
      $$ LANGUAGE plpgsql;
    `);
    
    console.log('✅ Fixed get_organization_decision_makers function (v3)');
    
    // Test the function
    const testResult = await db.query(`
      SELECT get_organization_decision_makers('9f6ffbb9-90d1-4ab7-9255-819a3ff989cc') as test_result
    `);
    
    console.log('📋 Function test result:', JSON.stringify(testResult.rows[0].test_result, null, 2));
    
  } catch (error) {
    console.error('❌ Error fixing function:', error.message);
  } finally {
    await db.close();
  }
}

fixDatabaseFunctionV3();