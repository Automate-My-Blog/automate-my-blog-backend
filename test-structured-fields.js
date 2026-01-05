import projectsService from './services/projects.js';

// Test data with structured fields
const testAnalysisData = {
  businessName: "Tech Solutions Inc",
  businessType: "Software Development",
  targetAudience: "Small business owners",
  contentFocus: "Business automation solutions",
  brandVoice: "Professional and approachable", 
  brandColors: {
    primary: "#2563eb",
    secondary: "#f8fafc",
    accent: "#10b981"
  },
  scenarios: [
    {
      customerProblem: "Managing business operations manually",
      targetSegment: {
        demographics: "Small business owners aged 30-50",
        psychographics: "Overwhelmed by manual processes",
        searchBehavior: "Search for automation tools during business hours"
      },
      businessValue: {
        searchVolume: "5,400/month",
        conversionPotential: "High",
        priority: 1,
        competition: "Medium"
      },
      customerLanguage: ["business automation software", "workflow management"],
      seoKeywords: ["business automation", "workflow optimization"],
      conversionPath: "Educational content about automation benefits",
      contentIdeas: [{
        title: "5 Ways to Automate Your Small Business",
        searchIntent: "Learning about automation benefits",
        businessAlignment: "Demonstrates value of automation services"
      }]
    }
  ],
  // NEW STRUCTURED FIELDS
  keywords: ["automation", "workflow", "efficiency", "small business"],
  description: "Helps small businesses automate their operations and improve efficiency",
  decisionMakers: "Business owners and operations managers",
  endUsers: "Business employees and administrative staff", 
  businessModel: "SaaS subscription with consulting services",
  websiteGoals: "Generate leads for consulting and software subscriptions",
  blogStrategy: "Educational content that demonstrates automation ROI and builds trust",
  searchBehavior: "Business owners research solutions during work hours when pain points arise",
  connectionMessage: "We understand the daily struggle of manual processes and provide practical automation solutions that give you time back to focus on growing your business."
};

async function testStructuredFields() {
  console.log('🧪 Testing structured fields implementation...\n');
  
  try {
    // Test project creation with structured fields
    console.log('1️⃣ Creating test project with structured fields...');
    const result = await projectsService.createProject(
      'test-user-id',
      'https://techsolutions.example.com', 
      testAnalysisData,
      'Test Project with Structured Fields'
    );
    
    if (result.success) {
      console.log(`✅ Project created: ${result.projectId}`);
      
      // Test retrieving project to verify structured fields are saved
      console.log('\n2️⃣ Retrieving project to verify structured fields...');
      const retrieved = await projectsService.getProjectByUserAndUrl(
        'test-user-id',
        'https://techsolutions.example.com'
      );
      
      if (retrieved) {
        console.log('\n📊 Structured Fields Retrieved:');
        console.log(`Keywords: ${JSON.stringify(retrieved.keywords)}`);
        console.log(`Description: ${retrieved.description}`);
        console.log(`Decision Makers: ${retrieved.decisionMakers}`);
        console.log(`End Users: ${retrieved.endUsers}`);
        console.log(`Business Model: ${retrieved.businessModel}`);
        console.log(`Website Goals: ${retrieved.websiteGoals}`);
        console.log(`Blog Strategy: ${retrieved.blogStrategy}`);
        console.log(`Search Behavior: ${retrieved.searchBehavior}`);
        console.log(`Connection Message: ${retrieved.connectionMessage}`);
        
        // Verify scenarios are also saved
        console.log(`\n🎯 Scenarios: ${retrieved.scenarios?.length || 0} found`);
        
        console.log('\n✅ All structured fields successfully saved and retrieved!');
      } else {
        console.log('❌ Project not found after creation');
      }
      
      // Test most recent analysis retrieval
      console.log('\n3️⃣ Testing most recent analysis retrieval...');
      const recentAnalysis = await projectsService.getUserMostRecentAnalysis('test-user-id');
      
      if (recentAnalysis) {
        console.log(`✅ Most recent analysis found: ${recentAnalysis.websiteUrl}`);
        console.log(`Business Model: ${recentAnalysis.businessModel}`);
        console.log(`Keywords: ${JSON.stringify(recentAnalysis.keywords)}`);
      } else {
        console.log('❌ No recent analysis found');
      }
      
    } else {
      console.log('❌ Project creation failed:', result.message);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
  
  console.log('\n🏁 Test completed');
  process.exit(0);
}

testStructuredFields();