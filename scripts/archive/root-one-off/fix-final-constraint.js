import db from './services/database.js';

async function addFinalConstraint() {
  try {
    console.log('📋 Adding final customer_language constraint...');
    
    // More flexible constraint that allows both objects and arrays
    const sql = `ALTER TABLE audiences 
                 ADD CONSTRAINT check_customer_language_valid_json 
                 CHECK (
                   customer_language IS NULL 
                   OR (
                     jsonb_typeof(customer_language) IN ('object', 'array')
                     AND customer_language::text !~* '\\[object Object\\]'
                   )
                 )`;
    
    await db.query(sql);
    console.log('✅ Success: customer_language constraint added');
    
    // Verify all constraints are in place
    const result = await db.query(`
      SELECT conname
      FROM pg_constraint 
      WHERE conrelid = 'audiences'::regclass
      AND contype = 'c'
      AND conname LIKE 'check_%'
      ORDER BY conname
    `);
    
    console.log('\n📋 Current CHECK constraints on audiences table:');
    result.rows.forEach(row => {
      console.log(`✅ ${row.conname}`);
    });
    
    console.log('\n🎉 All corruption prevention constraints are now in place!');
    process.exit(0);
  } catch (error) {
    if (error.message.includes('already exists')) {
      console.log('⚠️ Constraint already exists');
      process.exit(0);
    } else {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  }
}

addFinalConstraint();