import db from './services/database.js';

async function addConstraints() {
  const constraints = [
    {
      name: 'check_target_segment_valid_json',
      sql: `ALTER TABLE audiences 
            ADD CONSTRAINT check_target_segment_valid_json 
            CHECK (
              target_segment IS NULL 
              OR (
                jsonb_typeof(target_segment) = 'object'
                AND target_segment ? 'demographics'
                AND target_segment ? 'psychographics'
                AND target_segment ? 'searchBehavior'
              )
            )`
    },
    {
      name: 'check_target_segment_not_corrupted',
      sql: `ALTER TABLE audiences 
            ADD CONSTRAINT check_target_segment_not_corrupted 
            CHECK (
              target_segment IS NULL 
              OR target_segment::text !~* '\\[object Object\\]'
            )`
    },
    {
      name: 'check_target_segment_not_generic',
      sql: `ALTER TABLE audiences 
            ADD CONSTRAINT check_target_segment_not_generic 
            CHECK (
              target_segment IS NULL 
              OR (
                target_segment::text !~* 'General Audience'
                AND target_segment::text !~* 'generic'
                AND target_segment::text !~* 'placeholder'
              )
            )`
    },
    {
      name: 'check_customer_language_valid_json',
      sql: `ALTER TABLE audiences 
            ADD CONSTRAINT check_customer_language_valid_json 
            CHECK (
              customer_language IS NULL 
              OR (
                jsonb_typeof(customer_language) = 'object'
                AND customer_language::text !~* '\\[object Object\\]'
              )
            )`
    },
    {
      name: 'check_business_value_valid_json',
      sql: `ALTER TABLE audiences 
            ADD CONSTRAINT check_business_value_valid_json 
            CHECK (
              business_value IS NULL 
              OR (
                jsonb_typeof(business_value) = 'object'
                AND business_value::text !~* '\\[object Object\\]'
              )
            )`
    }
  ];

  console.log('📋 Adding database constraints to prevent corruption...');
  
  for (const constraint of constraints) {
    try {
      console.log(`Adding constraint: ${constraint.name}...`);
      await db.query(constraint.sql);
      console.log('✅ Success');
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('⚠️ Constraint already exists, skipping');
      } else {
        console.error(`❌ Error adding ${constraint.name}:`, error.message);
      }
    }
  }
  
  // Add indexes for performance
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_audiences_target_segment_gin ON audiences USING GIN (target_segment)',
    'CREATE INDEX IF NOT EXISTS idx_audiences_customer_language_gin ON audiences USING GIN (customer_language)',
    'CREATE INDEX IF NOT EXISTS idx_audiences_business_value_gin ON audiences USING GIN (business_value)'
  ];

  console.log('\n📊 Adding performance indexes...');
  for (const indexSql of indexes) {
    try {
      await db.query(indexSql);
      console.log('✅ Index created/exists');
    } catch (error) {
      console.error('❌ Index error:', error.message);
    }
  }
  
  console.log('\n🎉 Database constraints setup completed');
  process.exit(0);
}

addConstraints().catch(error => {
  console.error('💥 Failed to add constraints:', error);
  process.exit(1);
});