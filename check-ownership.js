#!/usr/bin/env node

import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const { Pool } = pg;

// Database configuration
const getDatabaseConfig = () => {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
      } : false
    };
  }
  
  return {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'automate_my_blog',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
    ssl: process.env.NODE_ENV === 'production' ? {
      rejectUnauthorized: false
    } : false
  };
};

const pool = new Pool(getDatabaseConfig());

async function checkOwnership() {
  const client = await pool.connect();
  try {
    console.log('🔍 CHECKING ORGANIZATION OWNERSHIP');
    console.log('==================================\n');
    
    const lumibearOrgId = '9d297834-b620-49a1-b597-02a6b815b7de';
    
    // Check organization ownership details
    const orgQuery = `
      SELECT 
        id, name, website_url, owner_user_id, created_at,
        (SELECT email FROM users WHERE id = owner_user_id) as owner_email
      FROM organizations 
      WHERE id = $1
    `;
    
    const orgResult = await client.query(orgQuery, [lumibearOrgId]);
    
    if (orgResult.rows.length === 0) {
      console.log('❌ Organization not found');
      return;
    }
    
    const org = orgResult.rows[0];
    console.log(`Organization: ${org.name}`);
    console.log(`Website: ${org.website_url}`);
    console.log(`Owner User ID: ${org.owner_user_id || 'NULL - THIS IS THE PROBLEM!'}`);
    console.log(`Owner Email: ${org.owner_email || 'No owner found'}`);
    console.log(`Created: ${org.created_at}`);
    console.log('');
    
    if (!org.owner_user_id) {
      console.log('🔧 SOLUTION: Need to assign an owner to this organization');
      console.log('');
      
      // Show available users
      const userQuery = `SELECT id, email, first_name, last_name, created_at FROM users ORDER BY created_at DESC LIMIT 5`;
      const userResult = await client.query(userQuery);
      
      console.log('Available users to assign as owner:');
      userResult.rows.forEach((user, index) => {
        console.log(`  ${index + 1}. ${user.first_name} ${user.last_name} (${user.email}) - ID: ${user.id}`);
        console.log(`     Created: ${user.created_at}`);
      });
      
      console.log('');
      console.log('💡 FIX: Let me assign the most recent user as owner...');
      
      if (userResult.rows.length > 0) {
        const latestUser = userResult.rows[0];
        
        try {
          await client.query(
            'UPDATE organizations SET owner_user_id = $1 WHERE id = $2',
            [latestUser.id, lumibearOrgId]
          );
          
          console.log(`✅ Successfully assigned ${latestUser.email} as owner of ${org.name}`);
          
          // Verify the fix
          const verifyQuery = await client.query(
            'SELECT owner_user_id, (SELECT email FROM users WHERE id = owner_user_id) as owner_email FROM organizations WHERE id = $1',
            [lumibearOrgId]
          );
          
          const updatedOrg = verifyQuery.rows[0];
          console.log(`✅ Verification: Owner is now ${updatedOrg.owner_email}`);
          
        } catch (error) {
          console.log(`❌ Failed to assign owner: ${error.message}`);
        }
      }
    } else {
      console.log('✅ Organization has proper ownership assigned');
    }
    
    console.log('');
    console.log('🔍 CHECKING FRONTEND AUTHENTICATION');
    console.log('-----------------------------------');
    console.log('Next, check if frontend is sending proper auth headers...');
    console.log('The API call should include:');
    console.log('  - Authorization: Bearer <jwt-token>');
    console.log('  - Or x-session-id header for anonymous users');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
  }
}

checkOwnership()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('💥 Failed:', error.message);
    process.exit(1);
  });