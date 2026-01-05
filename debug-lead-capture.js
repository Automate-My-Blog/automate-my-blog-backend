import db from './services/database.js';

/**
 * Debug Lead Capture Issue
 * Investigate why new leads are not being added to website_leads table
 */

async function debugLeadCapture() {
  console.log('🔍 Debugging Lead Capture Issue...\n');

  try {
    // 1. Check recent website_leads entries
    console.log('=== RECENT WEBSITE LEADS ===');
    const recentLeads = await db.query(`
      SELECT 
        id,
        website_url,
        business_name,
        lead_source,
        status,
        created_at,
        organization_id
      FROM website_leads 
      ORDER BY created_at DESC 
      LIMIT 10
    `);

    console.log(`📊 Found ${recentLeads.rows.length} recent leads:`);
    recentLeads.rows.forEach((lead, index) => {
      console.log(`  ${index + 1}. ${lead.business_name} (${lead.website_url})`);
      console.log(`     Source: ${lead.lead_source}, Status: ${lead.status}`);
      console.log(`     Created: ${lead.created_at}`);
      console.log(`     Org ID: ${lead.organization_id || 'None'}`);
      console.log('');
    });

    // 2. Check if there are any leads created today
    const todayLeads = await db.query(`
      SELECT COUNT(*) as count
      FROM website_leads 
      WHERE DATE(created_at) = CURRENT_DATE
    `);

    console.log(`📅 Leads created today: ${todayLeads.rows[0].count}`);

    // 3. Check if there are any leads in the last hour
    const hourlyLeads = await db.query(`
      SELECT COUNT(*) as count
      FROM website_leads 
      WHERE created_at >= NOW() - INTERVAL '1 hour'
    `);

    console.log(`⏰ Leads created in last hour: ${hourlyLeads.rows[0].count}`);

    // 4. Check organizations created recently
    console.log('\n=== RECENT ORGANIZATIONS ===');
    const recentOrgs = await db.query(`
      SELECT 
        id,
        name,
        website_url,
        business_type,
        created_at,
        last_analyzed_at
      FROM organizations 
      ORDER BY created_at DESC 
      LIMIT 5
    `);

    console.log(`🏢 Found ${recentOrgs.rows.length} recent organizations:`);
    recentOrgs.rows.forEach((org, index) => {
      console.log(`  ${index + 1}. ${org.name} (${org.website_url})`);
      console.log(`     Type: ${org.business_type}`);
      console.log(`     Created: ${org.created_at}`);
      console.log(`     Last Analyzed: ${org.last_analyzed_at}`);
      console.log('');
    });

    // 5. Check conversion tracking for recent activity
    console.log('=== RECENT CONVERSION TRACKING ===');
    const recentTracking = await db.query(`
      SELECT 
        ct.*,
        wl.website_url,
        wl.business_name
      FROM conversion_tracking ct
      JOIN website_leads wl ON ct.website_lead_id = wl.id
      ORDER BY ct.step_completed_at DESC 
      LIMIT 5
    `);

    console.log(`📈 Found ${recentTracking.rows.length} recent conversion tracking events:`);
    recentTracking.rows.forEach((event, index) => {
      console.log(`  ${index + 1}. ${event.business_name} - ${event.conversion_step}`);
      console.log(`     URL: ${event.website_url}`);
      console.log(`     Completed: ${event.step_completed_at}`);
      console.log('');
    });

    // 6. Check if there are any errors in the system
    console.log('=== DATABASE HEALTH CHECK ===');
    
    // Check table constraints and structure
    const tableCheck = await db.query(`
      SELECT 
        table_name,
        column_name,
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'website_leads' 
      AND column_name IN ('id', 'website_url', 'business_name', 'organization_id', 'created_at')
      ORDER BY ordinal_position
    `);

    console.log('✅ website_leads table structure:');
    tableCheck.rows.forEach(col => {
      console.log(`  - ${col.column_name}: nullable=${col.is_nullable}, default=${col.column_default || 'none'}`);
    });

    // 7. Test lead service functionality
    console.log('\n=== LEAD SERVICE TEST ===');
    try {
      const { default: leadService } = await import('./services/leads.js');
      console.log('✅ Lead service imported successfully');
      
      // Test if we can call the capture method (without actually capturing)
      console.log('🔧 Lead service methods available:');
      console.log(`  - captureLead: ${typeof leadService.captureLead}`);
      console.log(`  - getLeads: ${typeof leadService.getLeads}`);
      console.log(`  - getLeadDetails: ${typeof leadService.getLeadDetails}`);
      
    } catch (error) {
      console.log('❌ Lead service import error:', error.message);
    }

    // 8. Look for any recent API activity in logs
    console.log('\n=== ANALYSIS SUMMARY ===');
    console.log('🎯 Lead capture analysis:');
    console.log(`  - Total recent leads: ${recentLeads.rows.length}`);
    console.log(`  - Today's leads: ${todayLeads.rows[0].count}`);
    console.log(`  - Last hour leads: ${hourlyLeads.rows[0].count}`);
    console.log(`  - Recent organizations: ${recentOrgs.rows.length}`);
    console.log(`  - Recent tracking events: ${recentTracking.rows.length}`);

    if (todayLeads.rows[0].count == 0) {
      console.log('\n⚠️  NO LEADS CAPTURED TODAY');
      console.log('Possible issues:');
      console.log('1. Lead capture endpoint not being called');
      console.log('2. API authentication issues');
      console.log('3. Database connection problems');
      console.log('4. Lead capture service errors');
      console.log('5. Frontend not triggering lead capture');
    }

    console.log('\n✅ Lead capture debug completed!');

  } catch (error) {
    console.error('❌ Debug error:', error);
    throw error;
  }
}

// Run debug
debugLeadCapture()
  .then(() => {
    console.log('\n🎉 Lead capture debugging complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Debug failed:', error);
    process.exit(1);
  });