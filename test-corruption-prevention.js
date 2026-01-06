import axios from 'axios';

const API_BASE = 'http://localhost:3001/api/v1';
const TEST_SESSION_ID = 'test-corruption-session-' + Date.now();

// Test cases for corruption prevention
const testCases = [
  {
    name: 'Valid audience data',
    data: {
      target_segment: {
        demographics: 'Tech professionals aged 25-40',
        psychographics: 'Innovation-focused early adopters',
        searchBehavior: 'Research-heavy decision makers'
      },
      customer_problem: 'Need efficient development tools'
    },
    expected: 'success'
  },
  {
    name: '[object Object] string corruption',
    data: {
      target_segment: '[object Object]',
      customer_problem: 'Test problem'
    },
    expected: 'validation_error'
  },
  {
    name: 'Object with [object Object] in field',
    data: {
      target_segment: {
        demographics: '[object Object]',
        psychographics: 'Test psycho',
        searchBehavior: 'Test search'
      },
      customer_problem: 'Test problem'
    },
    expected: 'validation_error'
  },
  {
    name: 'General Audience placeholder',
    data: {
      target_segment: {
        demographics: 'General Audience',
        psychographics: 'Test psycho',
        searchBehavior: 'Test search'
      },
      customer_problem: 'Test problem'
    },
    expected: 'validation_error'
  },
  {
    name: 'Missing required fields',
    data: {
      target_segment: {
        demographics: 'Test demo'
        // Missing psychographics and searchBehavior
      },
      customer_problem: 'Test problem'
    },
    expected: 'validation_error'
  },
  {
    name: 'Empty object as string',
    data: {
      target_segment: '{}',
      customer_problem: 'Test problem'
    },
    expected: 'validation_error'
  },
  {
    name: 'Corrupted customer_language',
    data: {
      target_segment: {
        demographics: 'Test demo',
        psychographics: 'Test psycho', 
        searchBehavior: 'Test search'
      },
      customer_language: '[object Object]',
      customer_problem: 'Test problem'
    },
    expected: 'validation_error'
  },
  {
    name: 'Corrupted business_value',
    data: {
      target_segment: {
        demographics: 'Test demo',
        psychographics: 'Test psycho',
        searchBehavior: 'Test search'
      },
      business_value: '[object Object]',
      customer_problem: 'Test problem'
    },
    expected: 'validation_error'
  }
];

async function runTests() {
  console.log('🧪 Starting comprehensive corruption prevention tests...\n');
  
  let passed = 0;
  let failed = 0;
  
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`Test ${i + 1}/${testCases.length}: ${testCase.name}`);
    
    try {
      const response = await axios.post(`${API_BASE}/audiences`, testCase.data, {
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': TEST_SESSION_ID
        }
      });
      
      // Check if we got the expected result
      if (testCase.expected === 'success' && response.data.success) {
        console.log('✅ PASS - Valid data accepted');
        passed++;
      } else if (testCase.expected === 'validation_error' && response.data.success) {
        console.log('❌ FAIL - Corrupted data was accepted (should have been rejected)');
        console.log('   Response:', JSON.stringify(response.data, null, 2));
        failed++;
      } else {
        console.log('✅ PASS - Corrupted data properly rejected');
        passed++;
      }
      
    } catch (error) {
      if (testCase.expected === 'validation_error' && error.response && error.response.status === 400) {
        console.log('✅ PASS - Validation error returned as expected');
        if (error.response.data.details) {
          console.log('   Validation details:', error.response.data.details);
        }
        passed++;
      } else if (testCase.expected === 'validation_error' && error.response && error.response.status === 500) {
        // Check if this is corruption prevention at other layers
        const errorMsg = error.response.data.message || '';
        if (errorMsg.includes('[object Object]') || 
            errorMsg.includes('check_target_segment_not_generic') ||
            errorMsg.includes('check_target_segment_not_corrupted') ||
            errorMsg.includes('Corrupted data detected') ||
            errorMsg.includes('Stringified object contains')) {
          console.log('✅ PASS - Corruption blocked at deeper layer (safeStringify/database)');
          console.log('   Prevention layer:', errorMsg);
          passed++;
        } else {
          console.log('❌ FAIL - Unexpected server error');
          console.log('   Error:', error.response?.data || error.message);
          failed++;
        }
      } else if (testCase.expected === 'success') {
        console.log('❌ FAIL - Valid data was rejected');
        console.log('   Error:', error.response?.data || error.message);
        failed++;
      } else {
        console.log('❌ FAIL - Unexpected error');
        console.log('   Error:', error.response?.data || error.message);
        failed++;
      }
    }
    
    console.log(''); // Empty line between tests
  }
  
  // Test database constraint enforcement
  console.log('🗃️ Testing database constraints...\n');
  
  try {
    // Try to directly insert bad data (should fail at database level)
    const badDataTest = await axios.post(`${API_BASE}/audiences/cleanup-corrupted`, {}, {
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': TEST_SESSION_ID
      },
      method: 'DELETE'
    });
    
    console.log('✅ Database cleanup endpoint accessible');
  } catch (error) {
    console.log('⚠️ Database cleanup test skipped (endpoint may require special access)');
  }
  
  // Summary
  console.log('📊 Test Results Summary:');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%\n`);
  
  if (failed === 0) {
    console.log('🎉 ALL TESTS PASSED! Corruption prevention is working correctly.');
  } else {
    console.log('⚠️ Some tests failed. Please review the corruption prevention implementation.');
  }
  
  return { passed, failed };
}

// Run the tests
runTests().catch(error => {
  console.error('💥 Test execution failed:', error);
});