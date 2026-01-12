#!/usr/bin/env node

/**
 * Debug script to check frontend authentication state and token validity
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://automate-my-blog-backend.vercel.app';

async function debugFrontendAuth() {
  console.log('🔍 DEBUGGING FRONTEND AUTHENTICATION');
  console.log('=====================================\n');
  
  const lumibearOrgId = '9d297834-b620-49a1-b597-02a6b815b7de';
  
  // Test 1: Check if we can access the comprehensive analysis endpoint WITHOUT auth
  console.log('1️⃣ Testing API Endpoint WITHOUT Authentication');
  console.log('------------------------------------------------');
  
  const endpointUrl = `${API_BASE_URL}/api/v1/analysis/comprehensive-summary/${lumibearOrgId}`;
  console.log(`Testing: ${endpointUrl}`);
  
  try {
    const response = await fetch(endpointUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Response: ${response.status} ${response.statusText}`);
    const responseText = await response.text();
    console.log(`Body: ${responseText}`);
    
    if (responseText.includes('Either authentication or session ID is required')) {
      console.log('✅ Endpoint requires authentication as expected');
    }
    
  } catch (error) {
    console.log(`❌ Request failed: ${error.message}`);
  }
  
  console.log('\n2️⃣ Testing Authentication Endpoints');
  console.log('------------------------------------');
  
  // Test 2: Try to create a test user/login for debugging
  console.log('\n🔐 Testing login with test credentials...');
  
  const testCredentials = {
    email: 'james+test@frankel.tv',
    password: 'test123'
  };
  
  try {
    const loginResponse = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testCredentials)
    });
    
    console.log(`Login Response: ${loginResponse.status} ${loginResponse.statusText}`);
    const loginData = await loginResponse.json();
    console.log('Login Data:', JSON.stringify(loginData, null, 2));
    
    if (loginData.success && loginData.accessToken) {
      console.log('✅ Login successful, got access token');
      
      // Test 3: Try the comprehensive analysis endpoint WITH the token
      console.log('\n3️⃣ Testing API Endpoint WITH Authentication');
      console.log('---------------------------------------------');
      
      const authedResponse = await fetch(endpointUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${loginData.accessToken}`
        }
      });
      
      console.log(`Authenticated Response: ${authedResponse.status} ${authedResponse.statusText}`);
      const authedData = await authedResponse.text();
      console.log('Authenticated Data:', authedData);
      
      if (authedResponse.ok) {
        console.log('✅ Authentication works! Frontend needs to pass token correctly.');
      } else {
        console.log('❌ Even with valid token, API still fails');
      }
      
    } else {
      console.log('❌ Login failed');
      
      // Try to check if user exists
      console.log('\n🔍 Checking if test user exists...');
      
      try {
        // Check available users endpoint (if exists)
        const usersResponse = await fetch(`${API_BASE_URL}/api/v1/users`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (usersResponse.ok) {
          const usersData = await usersResponse.json();
          console.log('Users found:', usersData);
        }
      } catch (userError) {
        console.log('Could not fetch users:', userError.message);
      }
    }
    
  } catch (loginError) {
    console.log(`❌ Login request failed: ${loginError.message}`);
  }
  
  console.log('\n4️⃣ Frontend Debugging Instructions');
  console.log('------------------------------------');
  console.log('To debug in the browser:');
  console.log('1. Open browser dev tools');
  console.log('2. Go to Application/Storage tab');
  console.log('3. Check Local Storage for "accessToken"');
  console.log('4. In Console, run:');
  console.log('   localStorage.getItem("accessToken")');
  console.log('5. If token exists, decode it:');
  console.log('   JSON.parse(atob(localStorage.getItem("accessToken").split(".")[1]))');
  console.log('\n📋 Next Steps:');
  console.log('- If no token: User needs to log in');
  console.log('- If token expired: User needs to re-authenticate');
  console.log('- If token invalid: Clear localStorage and log in again');
}

debugFrontendAuth()
  .then(() => {
    console.log('\n🚀 Frontend authentication debugging completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Debugging failed:', error.message);
    process.exit(1);
  });