#!/usr/bin/env node

import db from './services/database.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function fixDiscoveryConfidenceType() {
  try {
    console.log('🔧 Fixing discovery_confidence column type');
    console.log('========================================\n');
    
    // Check current type
    console.log('1️⃣ Checking current column type');
    const typeCheckQuery = `
      SELECT column_name, data_type, numeric_precision, numeric_scale 
      FROM information_schema.columns 
      WHERE table_name = 'website_pages' 
      AND column_name = 'discovery_confidence'
    `;
    
    const currentType = await db.query(typeCheckQuery);
    console.log('Current type:');
    console.table(currentType.rows);
    
    // Fix the type if it's wrong
    if (currentType.rows[0]?.data_type === 'integer') {
      console.log('\n2️⃣ Converting column type from integer to decimal');
      
      const alterQuery = `
        ALTER TABLE website_pages 
        ALTER COLUMN discovery_confidence TYPE DECIMAL(3,2) 
        USING discovery_confidence::DECIMAL(3,2)
      `;
      
      await db.query(alterQuery);
      console.log('✅ Column type updated successfully');
      
      // Verify the change
      const verifyType = await db.query(typeCheckQuery);
      console.log('\nUpdated type:');
      console.table(verifyType.rows);
    } else {
      console.log('✅ Column type is already correct');
    }
    
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
  }
}

// Run the fix
fixDiscoveryConfidenceType()
  .then(() => {
    console.log('\n🚀 Fix completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Fix failed:', error.message);
    process.exit(1);
  });