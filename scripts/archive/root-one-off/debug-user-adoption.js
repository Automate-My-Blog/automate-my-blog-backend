import db from './services/database.js';
import jwt from 'jsonwebtoken';

// Debug the user adoption by checking what's actually in the database
async function debugUserAdoption() {
  console.log('🔍 Debugging user adoption data in database...\n');
  
  try {
    // Decode the JWT token to see the user ID
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJlNDEyODc4Yy1lODE5LTRlODEtODVhZS01OGQ4ZWQ5OGE0NjMiLCJlbWFpbCI6InRlc3QxNzY3NjY5ODM1NzgzQGV4YW1wbGUuY29tIiwiaWF0IjoxNzY3NjY5ODM3LCJleHAiOjE3Njg0NDk4Mzd9.ufVStv_LctJHy-iTSqBIZe2n5QHZDS5HA8oTqrcJaUU';
    const decoded = jwt.decode(token);
    
    console.log('👤 User from JWT token:');
    console.log('   User ID:', decoded?.userId);
    console.log('   Email:', decoded?.email);
    
    const sessionId = 'session_1767660567746_rbo6j7qye';
    const userId = decoded?.userId;
    
    // Check if user exists in database
    console.log('\n🗂️ Checking if user exists in database...');
    const userCheck = await db.query(`
      SELECT id, email, created_at 
      FROM users 
      WHERE id = $1
    `, [userId]);
    
    if (userCheck.rows.length === 0) {
      console.log('❌ USER NOT FOUND in database - this explains the issue!');
      console.log('   The user_id from JWT does not exist in the users table');
      console.log('   This would cause foreign key constraint failures during adoption');
      return;
    } else {
      console.log('✅ User exists in database:', userCheck.rows[0]);
    }
    
    // Check for audiences with this session_id
    console.log('\n📊 Checking for session data...');
    const sessionData = await db.query(`
      SELECT id, session_id, user_id, customer_problem, created_at
      FROM audiences 
      WHERE session_id = $1 OR session_id IS NULL AND user_id = $2
      ORDER BY created_at DESC
    `, [sessionId, userId]);
    
    console.log(`Found ${sessionData.rows.length} audience record(s):`);
    sessionData.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. ID: ${row.id}`);
      console.log(`      Session ID: ${row.session_id || 'NULL'}`);
      console.log(`      User ID: ${row.user_id || 'NULL'}`);
      console.log(`      Problem: ${row.customer_problem?.substring(0, 50)}...`);
      console.log(`      Created: ${row.created_at}`);
    });
    
    // Check specifically for user's data
    console.log('\n👤 Checking data assigned to user...');
    const userData = await db.query(`
      SELECT id, session_id, user_id, customer_problem, created_at
      FROM audiences 
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);
    
    console.log(`User has ${userData.rows.length} audience(s) assigned:`);
    userData.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. ID: ${row.id}`);
      console.log(`      User ID: ${row.user_id}`);
      console.log(`      Session ID: ${row.session_id || 'NULL (adopted)'}`);
      console.log(`      Problem: ${row.customer_problem?.substring(0, 50)}...`);
    });
    
    // Summary
    console.log('\n📋 SUMMARY:');
    console.log(`   Session "${sessionId}" has: ${sessionData.rows.filter(r => r.session_id === sessionId).length} audience(s)`);
    console.log(`   User "${userId}" has: ${userData.rows.length} audience(s)`);
    
    if (sessionData.rows.filter(r => r.session_id === sessionId).length > 0) {
      console.log('❌ PROBLEM: Session data still exists - adoption did not complete!');
    } else if (userData.rows.length === 0) {
      console.log('❌ PROBLEM: No data found for either session or user');
    } else {
      console.log('✅ SUCCESS: Data was properly adopted to user');
    }

  } catch (error) {
    console.error('💥 Database check failed:', error);
    console.error('Error details:', error.message);
  }
}

debugUserAdoption().catch(error => {
  console.error('💥 Debug execution failed:', error);
});