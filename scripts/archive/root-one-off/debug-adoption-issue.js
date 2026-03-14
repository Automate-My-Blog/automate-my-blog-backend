import db from './services/database.js';

// Direct database test to understand the adoption issue
async function debugAdoptionIssue() {
  console.log('🔍 Debugging session adoption issue...\n');

  const testSessionId = `debug-session-${Date.now()}`;
  const mockUserId = '12345678-1234-4234-8234-' + Date.now().toString().slice(-12);

  try {
    // Step 1: Create test data directly in database
    console.log('📝 Creating test audience with session_id...');
    
    const testAudience = {
      session_id: testSessionId,
      target_segment: JSON.stringify({
        demographics: 'Debug users',
        psychographics: 'Problem solvers',
        searchBehavior: 'Systematic debugging'
      }),
      customer_problem: 'Need to understand why adoption is not working'
    };

    const insertResult = await db.query(`
      INSERT INTO audiences (session_id, target_segment, customer_problem)
      VALUES ($1, $2, $3)
      RETURNING id, session_id
    `, [testAudience.session_id, testAudience.target_segment, testAudience.customer_problem]);

    console.log(`✅ Created audience with ID: ${insertResult.rows[0].id}`);

    // Step 2: Check session data exists
    console.log('\n📊 Checking session data in database...');
    const sessionCheck = await db.query(`
      SELECT id, session_id, user_id, target_segment
      FROM audiences 
      WHERE session_id = $1
    `, [testSessionId]);

    console.log(`Found ${sessionCheck.rows.length} audience(s) for session ${testSessionId}`);
    if (sessionCheck.rows.length > 0) {
      console.log('Session data:', {
        id: sessionCheck.rows[0].id,
        session_id: sessionCheck.rows[0].session_id,
        user_id: sessionCheck.rows[0].user_id
      });
    }

    // Step 3: Test the adoption logic directly
    console.log('\n🔄 Testing adoption logic directly...');
    
    const userContext = {
      isAuthenticated: true,
      userId: mockUserId,
      sessionId: testSessionId
    };

    console.log('User context:', userContext);

    // Check if there's any session data to adopt
    const sessionDataCheck = await db.query(`
      SELECT COUNT(*) as audience_count
      FROM audiences 
      WHERE session_id = $1
    `, [userContext.sessionId]);

    const sessionAudienceCount = parseInt(sessionDataCheck.rows[0].audience_count);
    console.log(`📊 Found ${sessionAudienceCount} audience(s) for session ${userContext.sessionId}`);

    // Check if user already has data
    const userDataCheck = await db.query(`
      SELECT COUNT(*) as user_audience_count
      FROM audiences 
      WHERE user_id = $1
    `, [userContext.userId]);

    const userAudienceCount = parseInt(userDataCheck.rows[0].user_audience_count);
    console.log(`📊 User ${userContext.userId} currently has ${userAudienceCount} audience(s)`);

    // Step 4: Perform the adoption if conditions are met
    if (sessionAudienceCount > 0 && userAudienceCount === 0) {
      console.log('\n✅ Adoption conditions met! Performing adoption...');
      
      const adoptionResult = await db.query(`
        UPDATE audiences 
        SET user_id = $1, session_id = NULL, updated_at = NOW()
        WHERE session_id = $2
        RETURNING id, target_segment, customer_problem, priority
      `, [userContext.userId, userContext.sessionId]);

      console.log(`🎉 Adoption completed: ${adoptionResult.rows.length} audiences adopted`);
      
      // Verify the adoption worked
      console.log('\n🔍 Verifying adoption results...');
      
      const userDataAfterAdoption = await db.query(`
        SELECT id, user_id, session_id
        FROM audiences 
        WHERE user_id = $1
      `, [userContext.userId]);

      const sessionDataAfterAdoption = await db.query(`
        SELECT id, user_id, session_id
        FROM audiences 
        WHERE session_id = $1
      `, [testSessionId]);

      console.log(`User now has ${userDataAfterAdoption.rows.length} audience(s)`);
      console.log(`Session now has ${sessionDataAfterAdoption.rows.length} audience(s)`);
      
      if (userDataAfterAdoption.rows.length > 0) {
        console.log('✅ SUCCESS: Data successfully adopted to user');
      } else {
        console.log('❌ FAILURE: Data was not adopted to user');
      }
      
    } else {
      console.log('❌ Adoption conditions not met:');
      console.log(`   Session data count: ${sessionAudienceCount}`);
      console.log(`   User data count: ${userAudienceCount}`);
    }

  } catch (error) {
    console.error('💥 Debug test failed:', error);
  } finally {
    console.log('\n🧹 Cleaning up test data...');
    try {
      await db.query(`DELETE FROM audiences WHERE session_id = $1 OR user_id = $2`, [testSessionId, mockUserId]);
      console.log('✅ Cleanup completed');
    } catch (cleanupError) {
      console.error('⚠️ Cleanup failed:', cleanupError);
    }
  }
}

debugAdoptionIssue().catch(error => {
  console.error('💥 Debug execution failed:', error);
});