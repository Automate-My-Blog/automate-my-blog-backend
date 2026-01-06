import { execSync } from 'child_process';

// Extract recent production logs to analyze registration and GET endpoint behavior
async function extractRecentLogs() {
  console.log('🔍 Extracting recent production logs...\n');
  
  try {
    // Get recent logs from the latest deployment
    const logs = execSync('vercel logs https://automate-my-blog-backend-hl4zakoi0-automate-my-blog.vercel.app --json', {
      encoding: 'utf-8',
      timeout: 30000, // 30 second timeout
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });
    
    const logLines = logs.trim().split('\n').map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return { message: line };
      }
    });
    
    console.log(`📊 Total log entries: ${logLines.length}`);
    
    // Filter for registration-related logs
    const registrationLogs = logLines.filter(log => 
      log.message && (
        log.message.includes('Database registration') ||
        log.message.includes('🔄 Attempting') ||
        log.message.includes('✅ Database registration successful') ||
        log.message.includes('❌ Database registration failed') ||
        log.message.includes('⚠️ Using memory fallback')
      )
    );
    
    console.log('\n📝 Registration-related logs:');
    registrationLogs.forEach(log => {
      console.log(`   ${log.timestamp || 'No timestamp'}: ${log.message}`);
    });
    
    // Filter for GET audiences logs with debugging
    const getAudiencesLogs = logLines.filter(log => 
      log.message && (
        log.message.includes('📖 Getting audiences') ||
        log.message.includes('🔍 Checking adoption conditions') ||
        log.message.includes('🚀 Starting session adoption') ||
        log.message.includes('🗃️ Executing query') ||
        log.message.includes('📊 Database query returned') ||
        log.message.includes('🔍 DEBUG: Adoption result')
      )
    );
    
    console.log('\n📖 GET /audiences debugging logs:');
    getAudiencesLogs.forEach(log => {
      console.log(`   ${log.timestamp || 'No timestamp'}: ${log.message}`);
    });
    
    // Filter for session adoption logs
    const adoptionLogs = logLines.filter(log => 
      log.message && (
        log.message.includes('Session adoption completed') ||
        log.message.includes('🔄 Adopting session') ||
        log.message.includes('✅ Session adoption completed')
      )
    );
    
    console.log('\n🔄 Session adoption logs:');
    adoptionLogs.forEach(log => {
      console.log(`   ${log.timestamp || 'No timestamp'}: ${log.message}`);
    });
    
    // Check for any errors
    const errorLogs = logLines.filter(log => 
      log.message && (
        log.message.includes('💥') ||
        log.message.includes('❌') ||
        log.message.includes('ERROR') ||
        log.message.includes('error')
      )
    );
    
    console.log('\n💥 Error logs:');
    errorLogs.forEach(log => {
      console.log(`   ${log.timestamp || 'No timestamp'}: ${log.message}`);
    });
    
    // Summary
    console.log('\n📋 Log Summary:');
    console.log(`   Registration logs: ${registrationLogs.length}`);
    console.log(`   GET audiences logs: ${getAudiencesLogs.length}`);
    console.log(`   Session adoption logs: ${adoptionLogs.length}`);
    console.log(`   Error logs: ${errorLogs.length}`);
    
    if (registrationLogs.length === 0) {
      console.log('\n❌ No registration logs found - registration might still be using memory fallback');
    }
    
    if (getAudiencesLogs.length === 0) {
      console.log('\n❌ No GET debugging logs found - might be hitting cached responses');
    }

  } catch (error) {
    console.error('💥 Failed to extract logs:', error.message);
    console.log('\n🔍 Trying alternative log extraction...');
    
    // Alternative: Get logs using inspect
    try {
      const inspectLogs = execSync('vercel inspect https://automate-my-blog-backend-hl4zakoi0-automate-my-blog.vercel.app --logs', {
        encoding: 'utf-8',
        timeout: 15000,
        maxBuffer: 5 * 1024 * 1024
      });
      
      const lines = inspectLogs.split('\n');
      const recentLines = lines.slice(-50); // Last 50 lines
      
      console.log('📄 Recent log lines:');
      recentLines.forEach(line => {
        if (line.trim()) {
          console.log(`   ${line}`);
        }
      });
      
    } catch (inspectError) {
      console.error('💥 Alternative log extraction also failed:', inspectError.message);
    }
  }
}

extractRecentLogs().catch(error => {
  console.error('💥 Log extraction failed:', error);
});