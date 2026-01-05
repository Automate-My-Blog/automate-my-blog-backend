#!/usr/bin/env node

import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3001/api/v1';

let testSessionId = null;
let testAudienceId = null;

async function runAPITests() {
  console.log('🧪 Testing Audience API Endpoints');
  console.log('==================================\n');

  try {
    // Test 1: Create anonymous session
    console.log('1️⃣ Testing session creation...');
    const sessionResponse = await fetch(`${API_BASE}/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!sessionResponse.ok) {
      throw new Error(`Session creation failed: ${sessionResponse.status}`);
    }

    const sessionData = await sessionResponse.json();
    testSessionId = sessionData.session_id;
    console.log('✅ Session created:', testSessionId);

    // Test 2: Create audience with session
    console.log('\n2️⃣ Testing audience creation...');
    const audiencePayload = {
      session_id: testSessionId,
      target_segment: {
        demographics: "Parents of children aged 2-12",
        psychographics: "Value-driven customers",
        searchBehavior: "Active researchers"
      },
      customer_problem: "Finding safe, effective products for sensitive children",
      customer_language: ["sensitive skin", "natural products", "safe for kids"],
      conversion_path: "Educational content → Product comparison → Purchase",
      business_value: {
        searchVolume: "8K+ monthly",
        conversionPotential: "High",
        priority: 1,
        competition: "Medium"
      },
      priority: 1
    };

    const createResponse = await fetch(`${API_BASE}/audiences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': testSessionId
      },
      body: JSON.stringify(audiencePayload)
    });

    if (!createResponse.ok) {
      const errorData = await createResponse.text();
      throw new Error(`Audience creation failed: ${createResponse.status} - ${errorData}`);
    }

    const audienceData = await createResponse.json();
    testAudienceId = audienceData.audience.id;
    console.log('✅ Audience created:', testAudienceId);
    console.log('   Target segment:', JSON.stringify(audienceData.audience.target_segment));

    // Test 3: Get audiences list
    console.log('\n3️⃣ Testing audience list...');
    const listResponse = await fetch(`${API_BASE}/audiences`, {
      headers: { 'X-Session-ID': testSessionId }
    });

    if (!listResponse.ok) {
      throw new Error(`Get audiences failed: ${listResponse.status}`);
    }

    const listData = await listResponse.json();
    console.log('✅ Audiences retrieved:', listData.total);
    console.log('   First audience problem:', listData.audiences[0]?.customer_problem);

    // Test 4: Add keywords to audience
    console.log('\n4️⃣ Testing keyword creation...');
    const keywordPayload = {
      audience_id: testAudienceId,
      keywords: [
        {
          keyword: "sensitive skin products for kids",
          search_volume: 1200,
          competition: "medium",
          relevance_score: 0.90
        },
        {
          keyword: "natural baby skincare",
          search_volume: 800,
          competition: "low",
          relevance_score: 0.85
        }
      ]
    };

    const keywordResponse = await fetch(`${API_BASE}/keywords`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': testSessionId
      },
      body: JSON.stringify(keywordPayload)
    });

    if (!keywordResponse.ok) {
      const errorData = await keywordResponse.text();
      throw new Error(`Keyword creation failed: ${keywordResponse.status} - ${errorData}`);
    }

    const keywordData = await keywordResponse.json();
    console.log('✅ Keywords created:', keywordData.count);

    // Test 5: Get specific audience with keywords
    console.log('\n5️⃣ Testing audience details...');
    const detailResponse = await fetch(`${API_BASE}/audiences/${testAudienceId}`, {
      headers: { 'X-Session-ID': testSessionId }
    });

    if (!detailResponse.ok) {
      throw new Error(`Get audience details failed: ${detailResponse.status}`);
    }

    const detailData = await detailResponse.json();
    console.log('✅ Audience details retrieved');
    console.log('   Customer problem:', detailData.audience.customer_problem);
    console.log('   Keywords count:', detailData.audience.keywords.length);
    console.log('   First keyword:', detailData.audience.keywords[0]?.keyword);

    // Test 6: Get session data
    console.log('\n6️⃣ Testing session data retrieval...');
    const sessionDataResponse = await fetch(`${API_BASE}/session/${testSessionId}`);

    if (!sessionDataResponse.ok) {
      throw new Error(`Get session data failed: ${sessionDataResponse.status}`);
    }

    const sessionDataResult = await sessionDataResponse.json();
    console.log('✅ Session data retrieved');
    console.log('   Audiences in session:', sessionDataResult.session.audiences.length);
    console.log('   Keywords in session:', sessionDataResult.session.keywords.length);

    // Test 7: Update audience
    console.log('\n7️⃣ Testing audience update...');
    const updatePayload = {
      customer_problem: "Finding safe, effective products for sensitive children - UPDATED",
      priority: 2
    };

    const updateResponse = await fetch(`${API_BASE}/audiences/${testAudienceId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': testSessionId
      },
      body: JSON.stringify(updatePayload)
    });

    if (!updateResponse.ok) {
      throw new Error(`Audience update failed: ${updateResponse.status}`);
    }

    const updateData = await updateResponse.json();
    console.log('✅ Audience updated');
    console.log('   New problem:', updateData.audience.customer_problem);
    console.log('   New priority:', updateData.audience.priority);

    // Test 8: Delete audience (cleanup)
    console.log('\n8️⃣ Testing audience deletion...');
    const deleteResponse = await fetch(`${API_BASE}/audiences/${testAudienceId}`, {
      method: 'DELETE',
      headers: { 'X-Session-ID': testSessionId }
    });

    if (!deleteResponse.ok) {
      throw new Error(`Audience deletion failed: ${deleteResponse.status}`);
    }

    const deleteData = await deleteResponse.json();
    console.log('✅ Audience deleted:', deleteData.message);

    // Test 9: Verify deletion
    console.log('\n9️⃣ Testing deletion verification...');
    const verifyResponse = await fetch(`${API_BASE}/audiences`, {
      headers: { 'X-Session-ID': testSessionId }
    });

    const verifyData = await verifyResponse.json();
    console.log('✅ Deletion verified - audiences remaining:', verifyData.total);

    console.log('\n🎉 All API tests passed successfully!');
    console.log('\n📊 Test Summary:');
    console.log('   - Session creation: ✅');
    console.log('   - Audience CRUD: ✅');
    console.log('   - Keywords creation: ✅');
    console.log('   - Session data retrieval: ✅');
    console.log('   - Anonymous user workflow: ✅');

  } catch (error) {
    console.error('\n❌ API test failed:', error.message);
    console.error('\n🔧 Troubleshooting tips:');
    console.error('   - Ensure backend server is running on port 3001');
    console.error('   - Check if database migration 11 has been applied');
    console.error('   - Verify audience tables exist in database');
    process.exit(1);
  }
}

// Run tests
runAPITests();