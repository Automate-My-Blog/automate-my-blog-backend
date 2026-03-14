import projectsService from './services/projects.js';
import db from './services/database.js';

// Simple test data
const simpleAnalysisData = {
  businessName: "Test Business",
  businessType: "Service",
  targetAudience: "Test audience",
  contentFocus: "Test focus",
  brandVoice: "Professional",
  brandColors: { primary: "#000000" },
  scenarios: [],
  keywords: ["test", "business"],
  description: "A test business",
  decisionMakers: "Business owners",
  endUsers: "Customers",
  businessModel: "Service-based",
  websiteGoals: "Generate leads",
  blogStrategy: "Educational content",
  searchBehavior: "Online research",
  connectionMessage: "We help test businesses"
};

async function debugProjects() {
  console.log('🔍 Debugging projects service...\n');
  
  try {
    // Step 1: Check initial service status
    console.log('1️⃣ Initial service status:');
    console.log(projectsService.getStorageStatus());
    
    // Step 2: Force database reconnection
    console.log('\n2️⃣ Testing database connection...');
    await projectsService.testDatabaseConnection();
    console.log('Service status after connection test:');
    console.log(projectsService.getStorageStatus());
    
    // Step 3: Test direct database access
    console.log('\n3️⃣ Testing direct database access...');
    try {
      const dbTest = await db.query('SELECT NOW() as current_time');
      console.log('✅ Direct database access works:', dbTest.rows[0].current_time);
    } catch (dbError) {
      console.log('❌ Direct database access failed:', dbError.message);
    }
    
    // Step 4: Try to create a project
    console.log('\n4️⃣ Creating test project...');
    const createResult = await projectsService.createProject(
      'debug-user-123',
      'https://debug.test.com',
      simpleAnalysisData,
      'Debug Test Project'
    );
    
    console.log('Create result:', createResult);
    
    if (createResult.success) {
      // Step 5: Try to retrieve the project
      console.log('\n5️⃣ Retrieving test project...');
      const retrieved = await projectsService.getProjectByUserAndUrl(
        'debug-user-123',
        'https://debug.test.com'
      );
      
      console.log('Retrieved project:');
      if (retrieved) {
        console.log(`- ID: ${retrieved.id}`);
        console.log(`- Website: ${retrieved.websiteUrl}`);
        console.log(`- Keywords: ${JSON.stringify(retrieved.keywords)}`);
        console.log(`- Business Model: ${retrieved.businessModel}`);
        console.log(`- Description: ${retrieved.description}`);
      } else {
        console.log('❌ Project not found after creation');
      }
    }
    
  } catch (error) {
    console.error('❌ Debug error:', error.message);
    console.error('Stack:', error.stack);
  }
  
  // Clean close
  try {
    await db.close();
  } catch (e) {
    // Ignore close errors
  }
  
  console.log('\n🏁 Debug completed');
  process.exit(0);
}

debugProjects();