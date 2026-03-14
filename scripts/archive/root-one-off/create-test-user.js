#!/usr/bin/env node

import pg from 'pg';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

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

async function createTestUser() {
  const client = await pool.connect();
  
  try {
    console.log('👤 CREATING/UPDATING TEST USER');
    console.log('===============================\n');
    
    const testEmail = 'james+test@frankel.tv';
    const testPassword = 'test123';
    const orgId = '9d297834-b620-49a1-b597-02a6b815b7de';
    
    // 1. Check if user already exists
    console.log('1️⃣ Checking for existing user');
    console.log('-----------------------------');
    
    const existingUser = await client.query(
      'SELECT id, email, password_hash, first_name, last_name FROM users WHERE email = $1',
      [testEmail]
    );
    
    if (existingUser.rows.length > 0) {
      console.log(`✅ User exists: ${testEmail}`);
      console.log(`   User ID: ${existingUser.rows[0].id}`);
      console.log(`   Name: ${existingUser.rows[0].first_name} ${existingUser.rows[0].last_name}`);
      
      // Update password to known value
      const hashedPassword = await bcrypt.hash(testPassword, 10);
      await client.query(
        'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2',
        [hashedPassword, testEmail]
      );
      console.log(`✅ Updated password for ${testEmail}`);
      
    } else {
      console.log('❌ User does not exist, creating new user...');
      
      // Create new user
      const hashedPassword = await bcrypt.hash(testPassword, 10);
      const userId = uuidv4();
      
      await client.query(`
        INSERT INTO users (
          id, email, password_hash, first_name, last_name, 
          role, email_verified, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      `, [
        userId,
        testEmail,
        hashedPassword,
        'James',
        'Test User',
        'user',
        true
      ]);
      
      console.log(`✅ Created new user: ${testEmail}`);
      console.log(`   User ID: ${userId}`);
      
      // Update organization ownership
      await client.query(
        'UPDATE organizations SET owner_user_id = $1 WHERE id = $2',
        [userId, orgId]
      );
      console.log('✅ Updated organization ownership');
    }
    
    // 2. Verify login credentials
    console.log('\n2️⃣ Verifying Login Credentials');
    console.log('-------------------------------');
    
    const loginUser = await client.query(
      'SELECT id, email, password_hash, first_name, last_name FROM users WHERE email = $1',
      [testEmail]
    );
    
    const user = loginUser.rows[0];
    const passwordValid = await bcrypt.compare(testPassword, user.password_hash);
    
    console.log(`Email: ${user.email}`);
    console.log(`Password Valid: ${passwordValid ? '✅' : '❌'}`);
    console.log(`User ID: ${user.id}`);
    
    // 3. Check organization ownership
    console.log('\n3️⃣ Verifying Organization Ownership');
    console.log('------------------------------------');
    
    const orgCheck = await client.query(`
      SELECT 
        o.id, o.name, o.website_url, o.owner_user_id,
        u.email as owner_email, u.first_name, u.last_name
      FROM organizations o
      LEFT JOIN users u ON o.owner_user_id = u.id
      WHERE o.id = $1
    `, [orgId]);
    
    const org = orgCheck.rows[0];
    console.log(`Organization: ${org.name}`);
    console.log(`Owner: ${org.first_name} ${org.last_name} (${org.owner_email})`);
    console.log(`Owner ID: ${org.owner_user_id}`);
    console.log(`Match: ${org.owner_user_id === user.id ? '✅' : '❌'}`);
    
    if (org.owner_user_id !== user.id) {
      console.log('🔧 Fixing organization ownership...');
      await client.query(
        'UPDATE organizations SET owner_user_id = $1 WHERE id = $2',
        [user.id, orgId]
      );
      console.log('✅ Organization ownership fixed');
    }
    
    console.log('\n🎉 Test User Setup Complete!');
    console.log('=============================');
    console.log(`✅ Email: ${testEmail}`);
    console.log(`✅ Password: ${testPassword}`);
    console.log(`✅ User ID: ${user.id}`);
    console.log(`✅ Organization: ${org.name} (${orgId})`);
    console.log('\n📋 Next: Try logging in with these credentials in the browser');
    
  } catch (error) {
    console.error('❌ Test user creation failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

createTestUser()
  .then(() => {
    console.log('\n🚀 Test user setup completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Test user setup failed:', error.message);
    process.exit(1);
  });