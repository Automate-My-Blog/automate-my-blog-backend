import leadService from './services/leads.js';

async function testLeadCapture() {
  try {
    console.log('🔬 Testing organization-centric lead capture...');
    
    // Mock OpenAI analysis data (similar to what would come from website analysis)
    const mockAnalysisData = {
      businessName: "Test Health Clinic",
      businessType: "Healthcare/Medical Practice", 
      businessModel: "Primary care medical practice serving local community",
      companySize: "small",
      description: "Family medicine practice providing comprehensive healthcare services",
      targetAudience: "Families and individuals seeking primary healthcare",
      decisionMakers: "Practice manager, Lead physician",
      endUsers: "Patients and their families",
      brandVoice: "Professional and caring",
      websiteGoals: "Patient appointment bookings and health education",
      searchBehavior: "Health-conscious individuals searching for local doctors",
      scenarios: [
        {
          customerProblem: "Finding a reliable family doctor for routine checkups",
          businessValue: {
            searchVolume: "Medium - 1,200/month",
            priority: 1,
            conversionPotential: "High"
          },
          customerLanguage: ["family doctor near me", "primary care physician"],
          seoKeywords: ["family medicine", "primary care", "medical checkup"]
        }
      ],
      webSearchStatus: {
        enhancementComplete: true
      }
    };
    
    const sessionInfo = {
      ipAddress: "192.168.1.100",
      userAgent: "Test Browser",
      referrer: "https://google.com"
    };
    
    // Test lead capture
    const result = await leadService.captureLead(
      "https://testhealthclinic.com",
      mockAnalysisData,
      sessionInfo
    );
    
    console.log('✅ Lead capture successful:', result);
    
    // Test getting leads with new organization data
    console.log('📊 Testing enhanced lead retrieval...');
    const leadsData = await leadService.getLeads({ limit: 5 });
    
    console.log('📋 Retrieved leads count:', leadsData.leads.length);
    if (leadsData.leads.length > 0) {
      const firstLead = leadsData.leads[0];
      console.log('🏢 First lead organization data:');
      console.log('  - Organization ID:', firstLead.organizationId);
      console.log('  - Organization Name:', firstLead.organizationName); 
      console.log('  - Business Model:', firstLead.businessModel);
      console.log('  - Decision Makers:', firstLead.decisionMakers);
      console.log('  - Customer Scenarios:', firstLead.customerScenarios?.length || 0);
      console.log('  - Analysis Confidence:', firstLead.analysisConfidenceScore);
    }
    
    console.log('🎉 Organization-centric lead capture is working!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testLeadCapture();