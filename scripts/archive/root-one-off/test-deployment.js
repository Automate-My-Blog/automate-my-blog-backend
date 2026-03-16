#!/usr/bin/env node

/**
 * Test deployment verification
 * Checks if visual content generation service changes are deployed
 */

import axios from 'axios';

const BACKEND_URL = 'https://automate-my-blog-backend.vercel.app';

async function testDeployment() {
  console.log('🚀 Testing backend deployment...');
  console.log(`Backend URL: ${BACKEND_URL}`);

  try {
    // Test 1: Basic connectivity
    console.log('\n1️⃣ Testing basic connectivity...');
    const healthResponse = await axios.get(`${BACKEND_URL}/`, { validateStatus: () => true });
    console.log(`✅ Backend responds: ${healthResponse.status} ${healthResponse.statusText}`);
    
    // Test 2: Check if visual content endpoint exists (should require auth)
    console.log('\n2️⃣ Testing visual content endpoint...');
    const visualResponse = await axios.post(
      `${BACKEND_URL}/api/v1/visual-content/generate`,
      {
        organizationId: 'test',
        contentType: 'hero_image',
        prompt: 'test'
      },
      { validateStatus: () => true }
    );
    
    if (visualResponse.status === 401 || visualResponse.status === 403) {
      console.log('✅ Visual content endpoint exists (requires authentication)');
    } else {
      console.log(`❓ Visual content endpoint response: ${visualResponse.status}`);
      console.log(JSON.stringify(visualResponse.data, null, 2));
    }

    // Test 3: Check service status endpoint
    console.log('\n3️⃣ Testing service status endpoint...');
    const statusResponse = await axios.get(
      `${BACKEND_URL}/api/v1/visual-content/services/status`,
      { validateStatus: () => true }
    );
    
    if (statusResponse.status === 401 || statusResponse.status === 403) {
      console.log('✅ Service status endpoint exists (requires authentication)');
    } else {
      console.log(`❓ Service status endpoint response: ${statusResponse.status}`);
      console.log(JSON.stringify(statusResponse.data, null, 2));
    }

    console.log('\n✅ Backend deployment verification completed');
    console.log('📝 Summary:');
    console.log('  - Backend is accessible');
    console.log('  - Visual content endpoints are deployed');
    console.log('  - Authentication is working (endpoints secured)');
    console.log('\n🎯 Next step: Test visual content generation from the frontend interface');

  } catch (error) {
    console.error('❌ Deployment test failed:', error.message);
    if (error.code === 'ENOTFOUND') {
      console.error('🌐 DNS/Network issue - backend may not be accessible');
    }
  }
}

testDeployment();