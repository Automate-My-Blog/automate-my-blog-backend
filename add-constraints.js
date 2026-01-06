import db from './services/database.js';
import fs from 'fs';

async function addConstraints() {
  try {
    const sql = fs.readFileSync('./add-corruption-prevention-constraints.sql', 'utf8');
    
    // Split by semicolons to execute each statement separately
    const statements = sql.split(';').filter(stmt => {
      const trimmed = stmt.trim();
      return trimmed && !trimmed.startsWith('/*') && !trimmed.startsWith('--');
    });
    
    console.log('📋 Adding database constraints to prevent corruption...');
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i].trim();
      if (statement) {
        console.log(`Executing statement ${i + 1}/${statements.length}...`);
        try {
          await db.query(statement);
          console.log('✅ Success');
        } catch (error) {
          if (error.message.includes('already exists')) {
            console.log('⚠️ Constraint already exists, skipping');
          } else {
            console.error('❌ Error:', error.message);
          }
        }
      }
    }
    
    console.log('🎉 Database constraints setup completed');
    process.exit(0);
  } catch (error) {
    console.error('💥 Failed to add constraints:', error);
    process.exit(1);
  }
}

addConstraints();