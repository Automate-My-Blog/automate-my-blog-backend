import db from './services/database.js';
import jwt from 'jsonwebtoken';

// Check if the latest user registration created a database record
async function checkLatestUser() {
  console.log('🔍 Checking latest user registration...\n');
  
  try {
    // Decode the latest JWT token from the frontend logs
    const latestToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI5NjJhMjBkZi00NTc5LTRlYjAtOWRhYy1lYjFiNGI5OGMxZGYiLCJlbWFpbCI6InRlc3QxNzY3NjcwMjU1OTQ2QGV4YW1wbGUuY29tIiwiaWF0IjoxNzY3NjcwMjU2LCJleHAiOjE3Njg0NTAyNTZ9.CyOV6F1cAgkNhk6r2CjxMy9HwEOdMOV5rmlI3SJc6dw';
    const decoded = jwt.decode(latestToken);
    
    console.log('👤 Latest user from JWT:');
    console.log('   User ID:', decoded?.userId);
    console.log('   Email:', decoded?.email);
    console.log('   Issued at:', new Date(decoded?.iat * 1000).toISOString());
    console.log('   Expires at:', new Date(decoded?.exp * 1000).toISOString());
    
    const userId = decoded?.userId;
    const sessionId = 'session_1767660567746_rbo6j7qye';
    
    // Check if this user exists in the database
    console.log('\n🗂️ Checking if user exists in database...');
    const userCheck = await db.query(`
      SELECT id, email, created_at, updated_at
      FROM users 
      WHERE id = $1
    `, [userId]);
    
    if (userCheck.rows.length === 0) {
      console.log('❌ USER NOT FOUND in database!');
      console.log('   This confirms the database registration is still failing');
      console.log('   The auth service is still using memory fallback');
      
      // Check the latest few users to see what's actually in the database
      console.log('\n📊 Latest users in database:');
      const latestUsers = await db.query(`
        SELECT id, email, created_at 
        FROM users 
        ORDER BY created_at DESC 
        LIMIT 5
      `);
      
      if (latestUsers.rows.length === 0) {
        console.log('   No users found in database at all!');
      } else {
        latestUsers.rows.forEach((user, index) => {
          console.log(`   ${index + 1}. ID: ${user.id}`);
          console.log(`      Email: ${user.email}`);
          console.log(`      Created: ${user.created_at}`);
        });
      }
    } else {
      console.log('✅ USER EXISTS in database:', userCheck.rows[0]);
    }
    
    // Check session and user data
    console.log('\n📊 Checking session and user audience data...');
    
    // Session data
    const sessionData = await db.query(`
      SELECT id, session_id, user_id, customer_problem, created_at
      FROM audiences 
      WHERE session_id = $1
      ORDER BY created_at DESC
    `, [sessionId]);
    
    console.log(`Session "${sessionId}" has ${sessionData.rows.length} audience(s):`);
    sessionData.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. ID: ${row.id}, Problem: ${row.customer_problem?.substring(0, 50)}...`);
    });
    
    // User data (if user exists)
    if (userId) {
      const userData = await db.query(`
        SELECT id, session_id, user_id, customer_problem, created_at
        FROM audiences 
        WHERE user_id = $1
        ORDER BY created_at DESC
      `, [userId]);
      
      console.log(`User "${userId}" has ${userData.rows.length} audience(s):`);
      userData.rows.forEach((row, index) => {
        console.log(`   ${index + 1}. ID: ${row.id}, Problem: ${row.customer_problem?.substring(0, 50)}...`);
      });
    }
    
    // Check all recent audiences to see what's happening
    console.log('\n📋 All recent audiences (last 10):');
    const recentAudiences = await db.query(`
      SELECT id, session_id, user_id, customer_problem, created_at
      FROM audiences 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    
    recentAudiences.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. ID: ${row.id}`);
      console.log(`      Session: ${row.session_id || 'NULL'}`);
      console.log(`      User: ${row.user_id || 'NULL'}`);
      console.log(`      Problem: ${row.customer_problem?.substring(0, 40)}...`);
      console.log(`      Created: ${row.created_at}`);
    });
    
    // Final diagnosis
    console.log('\n🔍 DIAGNOSIS:');
    if (userCheck.rows.length === 0) {
      console.log('❌ ROOT CAUSE: Database registration is still failing');
      console.log('   - User registration falls back to memory storage');
      console.log('   - JWT contains user_id that doesn\'t exist in database');
      console.log('   - Session adoption fails due to foreign key constraint');
      console.log('   - GET /audiences returns 0 results');
    } else {
      console.log('✅ User exists, checking adoption logic...');
      if (userData.rows.length > 0) {
        console.log('✅ Adoption successful - user has audience data');
      } else {
        console.log('❌ Adoption failed - user exists but has no data');
      }
    }

  } catch (error) {
    console.error('💥 Database check failed:', error);
    console.error('Error details:', error.message);
  }
}

checkLatestUser().catch(error => {
  console.error('💥 Check execution failed:', error);
});