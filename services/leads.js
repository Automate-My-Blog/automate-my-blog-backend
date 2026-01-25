import { v4 as uuidv4 } from 'uuid';
import db from './database.js';
import organizationService from './organizations.js';
import projectsService from './projects.js';

/**
 * Website Lead Management Service
 * Handles lead capture, tracking, and conversion analytics
 * Only accessible to super admins
 */
class LeadService {
  constructor() {
    this.leadSources = {
      'website_analysis': 'Website Analysis Tool',
      'organic_search': 'Organic Search',
      'referral': 'Referral Link',
      'direct': 'Direct Visit',
      'social': 'Social Media'
    };

    this.leadStatuses = {
      'new': 'New Lead',
      'qualified': 'Qualified',
      'nurturing': 'In Nurturing',
      'converted': 'Converted to User',
      'lost': 'Lost/Cold'
    };
  }

  /**
   * Capture a new lead from website analysis - Organization-Centric Approach
   */
  async captureLead(websiteUrl, analysisData, sessionInfo = {}) {
    const requestId = sessionInfo.requestId || `lead_${Date.now()}`;
    
    try {
      console.log(`🔄 [${requestId}] LeadService.captureLead() - Starting organization-centric lead capture...`);
      console.log(`   📍 URL: ${websiteUrl}`);
      console.log(`   📊 Analysis Data Keys: ${analysisData ? Object.keys(analysisData).join(', ') : 'None'}`);
      console.log(`   👤 Session Info Keys: ${Object.keys(sessionInfo).join(', ')}`);
      
      // Step 1: Create or update organization with business intelligence
      console.log(`🏢 [${requestId}] Step 1: Creating/updating organization...`);
      const orgStart = Date.now();
      const organizationId = await organizationService.createOrUpdateOrganization(websiteUrl, analysisData, sessionInfo);
      const orgTime = Date.now() - orgStart;
      console.log(`✅ [${requestId}] Organization created/updated in ${orgTime}ms: ${organizationId}`);
      
      // Step 2: Save organization intelligence data  
      console.log(`🧠 [${requestId}] Step 2: Saving organization intelligence...`);
      const intelStart = Date.now();
      await organizationService.saveOrganizationIntelligence(organizationId, analysisData);
      const intelTime = Date.now() - intelStart;
      console.log(`✅ [${requestId}] Organization intelligence saved in ${intelTime}ms`);
      
      // Step 3: Extract and save contact information
      console.log(`👥 [${requestId}] Step 3: Extracting and saving contacts...`);
      const contactStart = Date.now();
      await organizationService.extractAndSaveContacts(organizationId, analysisData);
      const contactTime = Date.now() - contactStart;
      console.log(`✅ [${requestId}] Contacts extracted and saved in ${contactTime}ms`);
      
      // Step 3.5: Create anonymous project with structured fields to preserve OpenAI analysis
      console.log(`📝 [${requestId}] Step 3.5: Creating anonymous project with structured fields...`);
      const projectStart = Date.now();
      let anonymousUserId = null;
      let anonymousProjectId = null;
      
      try {
        // Create temporary anonymous user ID for the project
        anonymousUserId = uuidv4();
        
        // Create user record for the anonymous analysis
        await db.query(`
          INSERT INTO users (id, email, first_name, last_name, password_hash, role, status) 
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (email) DO NOTHING
        `, [
          anonymousUserId, 
          `anonymous-${anonymousUserId}@temp.local`, 
          'Anonymous', 
          'User', 
          'no-password-required',
          'user',
          'active'
        ]);
        
        // Create project with structured OpenAI fields
        const projectResult = await projectsService.createProject(
          anonymousUserId,
          websiteUrl,
          analysisData,
          `Anonymous Analysis: ${analysisData.businessName || 'Website Analysis'}`
        );
        
        if (projectResult.success) {
          anonymousProjectId = projectResult.projectId;
          console.log(`✅ [${requestId}] Anonymous project created: ${anonymousProjectId}`);
        } else {
          console.warn(`⚠️ [${requestId}] Failed to create anonymous project: ${projectResult.message}`);
        }
        
        const projectTime = Date.now() - projectStart;
        console.log(`✅ [${requestId}] Anonymous project processing completed in ${projectTime}ms`);
        
      } catch (projectError) {
        console.error(`❌ [${requestId}] Anonymous project creation failed:`, projectError.message);
        // Don't fail the entire lead capture if project creation fails
      }
      
      // Step 4: Create lead record linked to organization
      console.log(`📝 [${requestId}] Step 4: Creating lead record...`);
      const leadRecordStart = Date.now();
      const leadId = uuidv4();
      const ipAddress = sessionInfo.ipAddress || null; // Use NULL instead of 'unknown' for inet type
      const userAgent = sessionInfo.userAgent || 'unknown';
      const referrer = sessionInfo.referrer || null;

      // Determine lead source
      let leadSource = 'website_analysis';
      if (referrer) {
        if (referrer.includes('google.com') || referrer.includes('bing.com')) {
          leadSource = 'organic_search';
        } else if (referrer.includes('facebook.com') || referrer.includes('linkedin.com')) {
          leadSource = 'social';
        } else if (referrer.includes('automatemyblog.com')) {
          // Check for actual referral parameters
          if (referrer.includes('?ref=') || referrer.includes('&ref=')) {
            leadSource = 'referral';
          } else {
            leadSource = 'direct'; // From own domain without ref parameter
          }
        } else {
          leadSource = 'referral'; // External domain
        }
      }

      const websiteDomain = new URL(websiteUrl).hostname;
      
      console.log(`   📊 [${requestId}] Lead details:`);
      console.log(`      Lead ID: ${leadId}`);
      console.log(`      Organization ID: ${organizationId}`);
      console.log(`      Website URL: ${websiteUrl}`);
      console.log(`      Domain: ${websiteDomain}`);
      console.log(`      Business Name: ${analysisData.businessName || 'Unknown Business'}`);
      console.log(`      Lead Source: ${leadSource}`);
      console.log(`      IP Address: ${ipAddress}`);

      // Create simplified lead record that references organization
      console.log(`   💾 [${requestId}] Inserting lead into website_leads table...`);
      const leadResult = await db.query(`
        INSERT INTO website_leads (
          id, organization_id, session_id, website_url, website_domain, business_name, business_type,
          industry_category, estimated_company_size, lead_source, status, ip_address,
          user_agent, referrer, analysis_data, target_audience, content_focus,
          brand_voice, project_id, anonymous_user_id, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW(), NOW())
        RETURNING *
      `, [
        leadId,
        organizationId, // Link to organization
        sessionInfo.sessionId || null, // Track session ID for anonymous users
        websiteUrl,
        websiteDomain,
        analysisData.businessName || 'Unknown Business',
        analysisData.businessType || 'unknown',
        analysisData.businessType || 'unknown',
        analysisData.companySize || 'unknown',
        leadSource,
        'new',
        ipAddress,
        userAgent,
        referrer,
        JSON.stringify(analysisData), // Keep for backward compatibility
        analysisData.targetAudience || null,
        analysisData.contentFocus || null,
        analysisData.brandVoice || null,
        anonymousProjectId || null, // Link to anonymous project
        anonymousUserId || null // Link to anonymous user
      ]);

      const lead = leadResult.rows[0];
      const leadRecordTime = Date.now() - leadRecordStart;
      console.log(`✅ [${requestId}] Lead record created in ${leadRecordTime}ms - Lead ID: ${lead.id}`);
      
      // Log project linkage if successful
      if (anonymousProjectId && anonymousUserId) {
        console.log(`🔗 [${requestId}] Anonymous project linked to lead:`);
        console.log(`      Project ID: ${anonymousProjectId}`);
        console.log(`      Anonymous User ID: ${anonymousUserId}`);
        console.log(`      ✅ OpenAI structured data preserved for logged-out user`);
      }

      // Step 5: Use database function to automatically score the lead
      console.log(`🎯 [${requestId}] Step 5: Scoring lead...`);
      const scoringStart = Date.now();
      const scoringResult = await db.query(`
        SELECT auto_score_lead($1) as lead_score
      `, [leadId]);
      
      const leadScore = scoringResult.rows[0]?.lead_score || 0;
      const scoringTime = Date.now() - scoringStart;
      console.log(`✅ [${requestId}] Lead scored in ${scoringTime}ms - Score: ${leadScore}`);

      // Step 6: Track conversion step
      console.log(`📈 [${requestId}] Step 6: Tracking conversion step...`);
      const conversionStart = Date.now();
      await db.query(`
        SELECT track_conversion_step($1, $2, $3, $4)
      `, [
        leadId,
        'website_analysis',
        JSON.stringify({
          organization_id: organizationId,
          website_url: websiteUrl,
          analysis_data: analysisData,
          session_info: sessionInfo,
          lead_score: leadScore
        }),
        sessionInfo.sessionId || null
      ]);
      
      const conversionTime = Date.now() - conversionStart;
      console.log(`✅ [${requestId}] Conversion step tracked in ${conversionTime}ms`);
      
      const totalTime = Date.now() - orgStart;
      console.log(`\n🎉 [${requestId}] LEAD CAPTURE COMPLETED SUCCESSFULLY in ${totalTime}ms`);
      console.log(`✅ Captured new lead: ${lead.business_name} (${websiteUrl})`);
      console.log(`🏢 Organization: ${organizationId}`);
      console.log(`📊 Lead Score: ${leadScore}`);

      return {
        leadId: lead.id,
        organizationId,
        leadScore,
        businessName: lead.business_name,
        source: leadSource,
        status: 'new',
        // Include anonymous project information if created
        anonymousProject: anonymousProjectId ? {
          projectId: anonymousProjectId,
          userId: anonymousUserId,
          structuredDataSaved: true
        } : null
      };
    } catch (error) {
      console.error(`❌ [${requestId}] LEAD CAPTURE FAILED:`, error);
      console.error(`   Error Type: ${error.name || 'Unknown'}`);
      console.error(`   Error Message: ${error.message || 'No message'}`);
      console.error(`   Stack: ${error.stack || 'No stack trace'}`);
      
      // Log the current state for debugging
      console.error(`   🔍 Debug Info:`);
      console.error(`      Website URL: ${websiteUrl}`);
      console.error(`      Has Analysis Data: ${!!analysisData}`);
      console.error(`      Session Info Keys: ${Object.keys(sessionInfo).join(', ')}`);
      
      throw error;
    }
  }

  /**
   * Score a lead using the database's intelligent scoring function
   * This leverages the built-in auto_score_lead() database function
   */
  async scoreLeadWithDatabase(leadId) {
    try {
      const result = await db.query(`
        SELECT auto_score_lead($1) as score
      `, [leadId]);
      
      return result.rows[0]?.score || 0;
    } catch (error) {
      console.error('Error scoring lead:', error);
      return 0;
    }
  }

  /**
   * Get all leads with filtering and pagination (Super Admin Only)
   */
  async getLeads(options = {}) {
    try {
      const {
        limit = 50,
        offset = 0,
        status = 'all',
        source = 'all',
        minScore = 0,
        maxScore = 100,
        dateRange = 'all',
        search = '',
        sortBy = 'created_at',
        sortOrder = 'DESC'
      } = options;

      let whereConditions = [];
      let queryParams = [];
      let paramIndex = 1;

      // Status filter
      if (status !== 'all') {
        whereConditions.push(`wl.status = $${paramIndex}`);
        queryParams.push(status);
        paramIndex++;
      }

      // Source filter
      if (source !== 'all') {
        whereConditions.push(`wl.lead_source = $${paramIndex}`);
        queryParams.push(source);
        paramIndex++;
      }

      // Date range filter
      if (dateRange !== 'all') {
        const days = dateRange === 'today' ? 1 : dateRange === 'week' ? 7 : dateRange === 'month' ? 30 : 90;
        whereConditions.push(`wl.created_at > NOW() - INTERVAL '${days} days'`);
      }

      // Search filter
      if (search && search.length > 0) {
        whereConditions.push(`(
          LOWER(wl.business_name) LIKE $${paramIndex} OR 
          LOWER(wl.website_url) LIKE $${paramIndex} OR
          LOWER(wl.industry_category) LIKE $${paramIndex}
        )`);
        queryParams.push(`%${search.toLowerCase()}%`);
        paramIndex++;
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
      
      // Validate sort parameters - update to use proper table aliases
      const allowedSortFields = ['created_at', 'lead_score', 'business_name', 'status', 'updated_at'];
      let safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
      const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      
      // Map lead_score to the proper column from lead_scoring table
      if (safeSortBy === 'lead_score') {
        safeSortBy = 'ls.overall_score';
      } else {
        safeSortBy = `wl.${safeSortBy}`;
      }

      // Get leads with organization data, scoring, and conversion info
      const leadsResult = await db.query(`
        SELECT 
          wl.*,
          -- Organization data
          o.id as organization_id,
          o.name as organization_name,
          o.business_model,
          o.company_size as org_company_size,
          o.target_audience as org_target_audience,
          o.brand_voice as org_brand_voice,
          -- Lead scoring data
          ls.overall_score as lead_score,
          ls.business_size_score,
          ls.industry_fit_score,
          ls.engagement_score,
          ls.content_quality_score,
          ls.scoring_factors,
          -- Organization intelligence summary
          oi.customer_scenarios,
          oi.business_value_assessment,
          oi.analysis_confidence_score,
          -- Decision makers
          get_organization_decision_makers(o.id) as decision_makers,
          -- Conversion data
          CASE WHEN wl.converted_to_user_id IS NOT NULL THEN TRUE ELSE FALSE END as is_converted,
          wl.converted_at,
          u.email as converted_user_email,
          COUNT(ct.id) as conversion_steps_count,
          EXTRACT(EPOCH FROM (COALESCE(wl.converted_at, NOW()) - wl.created_at)) / 86400 as days_in_funnel
        FROM website_leads wl
        LEFT JOIN organizations o ON wl.organization_id = o.id
        LEFT JOIN lead_scoring ls ON wl.id = ls.website_lead_id
        LEFT JOIN organization_intelligence oi ON o.id = oi.organization_id AND oi.is_current = TRUE
        LEFT JOIN users u ON wl.converted_to_user_id = u.id
        LEFT JOIN conversion_tracking ct ON wl.id = ct.website_lead_id
        ${whereClause}
        GROUP BY wl.id, o.id, o.name, o.business_model, o.company_size, o.target_audience, o.brand_voice,
                 ls.overall_score, ls.business_size_score, ls.industry_fit_score, 
                 ls.engagement_score, ls.content_quality_score, ls.scoring_factors, 
                 oi.customer_scenarios, oi.business_value_assessment, oi.analysis_confidence_score,
                 u.email
        ORDER BY ${safeSortBy} ${safeSortOrder}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `, [...queryParams, limit, offset]);

      // Get total count for pagination
      const countResult = await db.query(`
        SELECT COUNT(DISTINCT wl.id) as total
        FROM website_leads wl
        LEFT JOIN lead_scoring ls ON wl.id = ls.website_lead_id
        ${whereClause}
      `, queryParams);

      const total = parseInt(countResult.rows[0]?.total || 0);

      return {
        leads: leadsResult.rows.map(lead => ({
          // Lead information
          id: lead.id,
          websiteUrl: lead.website_url,
          businessName: lead.business_name,
          businessType: lead.business_type,
          industry: lead.industry_category,
          estimatedCompanySize: lead.estimated_company_size,
          leadSource: lead.lead_source,
          leadScore: parseInt(lead.lead_score || 0),
          status: lead.status,
          isConverted: lead.is_converted,
          convertedAt: lead.converted_at,
          convertedUserEmail: lead.converted_user_email,
          conversionStepsCount: parseInt(lead.conversion_steps_count || 0),
          daysInFunnel: parseFloat(lead.days_in_funnel || 0).toFixed(1),
          createdAt: lead.created_at,
          updatedAt: lead.updated_at,
          ipAddress: lead.ip_address,
          userAgent: lead.user_agent,
          referrerUrl: lead.referrer_url,
          
          // Organization data
          organizationId: lead.organization_id,
          organizationName: lead.organization_name,
          businessModel: lead.business_model,
          companySize: lead.org_company_size,
          targetAudience: lead.org_target_audience,
          brandVoice: lead.org_brand_voice,
          
          // Business intelligence
          decisionMakers: lead.decision_makers || [],
          customerScenarios: lead.customer_scenarios || [],
          businessValueAssessment: lead.business_value_assessment || {},
          analysisConfidenceScore: parseFloat(lead.analysis_confidence_score || 0),
          
          // Backward compatibility
          analysisData: lead.analysis_data
        })),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
          totalPages: Math.ceil(total / limit),
          currentPage: Math.floor(offset / limit) + 1
        },
        filters: {
          status,
          source,
          minScore,
          maxScore,
          dateRange,
          search,
          sortBy: safeSortBy,
          sortOrder: safeSortOrder
        }
      };
    } catch (error) {
      console.error('Error getting leads:', error);
      throw error;
    }
  }

  /**
   * Get lead analytics and conversion metrics (Super Admin Only)
   */
  async getLeadAnalytics(dateRange = 'month') {
    try {
      const days = dateRange === 'today' ? 1 : dateRange === 'week' ? 7 : dateRange === 'month' ? 30 : 90;

      // Overall metrics - JOIN with lead_scoring table
      const metricsResult = await db.query(`
        SELECT 
          COUNT(DISTINCT wl.id) as total_leads,
          COUNT(CASE WHEN wl.converted_to_user_id IS NOT NULL THEN 1 END) as converted_leads,
          ROUND(AVG(ls.overall_score), 1) as avg_lead_score,
          COUNT(CASE WHEN ls.overall_score >= 80 THEN 1 END) as high_quality_leads,
          COUNT(CASE WHEN wl.status = 'new' THEN 1 END) as new_leads,
          COUNT(CASE WHEN wl.created_at > NOW() - INTERVAL '${days} days' THEN 1 END) as recent_leads
        FROM website_leads wl
        LEFT JOIN lead_scoring ls ON wl.id = ls.website_lead_id
      `);

      const metrics = metricsResult.rows[0];
      const conversionRate = metrics.total_leads > 0 
        ? ((metrics.converted_leads / metrics.total_leads) * 100).toFixed(1)
        : '0.0';

      // Lead sources breakdown - JOIN with lead_scoring table
      const sourcesResult = await db.query(`
        SELECT 
          wl.lead_source,
          COUNT(DISTINCT wl.id) as count,
          COUNT(CASE WHEN wl.converted_to_user_id IS NOT NULL THEN 1 END) as converted,
          ROUND(AVG(ls.overall_score), 1) as avg_score
        FROM website_leads wl
        LEFT JOIN lead_scoring ls ON wl.id = ls.website_lead_id
        WHERE wl.created_at > NOW() - INTERVAL '${days} days'
        GROUP BY wl.lead_source
        ORDER BY count DESC
      `);

      // Daily lead trend
      const trendResult = await db.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as leads_count,
          COUNT(CASE WHEN converted_to_user_id IS NOT NULL THEN 1 END) as conversions_count
        FROM website_leads
        WHERE created_at > NOW() - INTERVAL '${days} days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        LIMIT 30
      `);

      // Industry breakdown
      const industryResult = await db.query(`
        SELECT 
          wl.industry_category as industry,
          COUNT(DISTINCT wl.id) as count,
          ROUND(AVG(ls.overall_score), 1) as avg_score
        FROM website_leads wl
        LEFT JOIN lead_scoring ls ON wl.id = ls.website_lead_id
        WHERE wl.created_at > NOW() - INTERVAL '${days} days' AND wl.industry_category IS NOT NULL
        GROUP BY wl.industry_category
        ORDER BY count DESC
        LIMIT 10
      `);

      return {
        overview: {
          totalLeads: parseInt(metrics.total_leads),
          convertedLeads: parseInt(metrics.converted_leads),
          conversionRate: parseFloat(conversionRate),
          averageLeadScore: parseFloat(metrics.avg_lead_score || 0),
          highQualityLeads: parseInt(metrics.high_quality_leads),
          newLeads: parseInt(metrics.new_leads),
          recentLeads: parseInt(metrics.recent_leads)
        },
        leadSources: sourcesResult.rows.map(row => ({
          source: row.lead_source,
          displayName: this.leadSources[row.lead_source] || row.lead_source,
          count: parseInt(row.count),
          converted: parseInt(row.converted),
          conversionRate: row.count > 0 ? ((row.converted / row.count) * 100).toFixed(1) : '0.0',
          averageScore: parseFloat(row.avg_score || 0)
        })),
        dailyTrend: trendResult.rows.map(row => ({
          date: row.date,
          leads: parseInt(row.leads_count),
          conversions: parseInt(row.conversions_count),
          conversionRate: row.leads_count > 0 ? ((row.conversions_count / row.leads_count) * 100).toFixed(1) : '0.0'
        })),
        industries: industryResult.rows.map(row => ({
          industry: row.industry,
          count: parseInt(row.count),
          averageScore: parseFloat(row.avg_score || 0)
        })),
        dateRange
      };
    } catch (error) {
      console.error('Error getting lead analytics:', error);
      throw error;
    }
  }

  /**
   * Get detailed lead information (Super Admin Only)
   */
  async getLeadDetails(leadId) {
    try {
      // Get lead info with organization intelligence data (same as getLeads query but for single lead)
      const leadResult = await db.query(`
        SELECT 
          wl.*,
          -- Organization data
          o.id as organization_id,
          o.name as organization_name,
          o.business_model,
          o.company_size as org_company_size,
          o.target_audience as org_target_audience,
          o.brand_voice as org_brand_voice,
          o.description as org_description,
          o.website_goals as org_website_goals,
          -- Lead scoring data
          ls.overall_score as lead_score,
          ls.business_size_score,
          ls.industry_fit_score,
          ls.engagement_score,
          ls.content_quality_score,
          ls.technical_readiness_score,
          ls.budget_indicator_score,
          ls.urgency_score,
          ls.scoring_factors,
          -- Organization intelligence summary
          oi.customer_scenarios,
          oi.business_value_assessment,
          oi.customer_language_patterns,
          oi.search_behavior_insights,
          oi.seo_opportunities,
          oi.content_strategy_recommendations,
          oi.analysis_confidence_score,
          -- Decision makers
          get_organization_decision_makers(o.id) as decision_makers,
          -- Conversion data
          u.email as converted_user_email,
          u.first_name as converted_user_first_name,
          u.last_name as converted_user_last_name,
          EXTRACT(EPOCH FROM (COALESCE(wl.converted_at, NOW()) - wl.created_at)) / 86400 as days_in_funnel
        FROM website_leads wl
        LEFT JOIN organizations o ON wl.organization_id = o.id
        LEFT JOIN lead_scoring ls ON wl.id = ls.website_lead_id
        LEFT JOIN organization_intelligence oi ON o.id = oi.organization_id AND oi.is_current = TRUE
        LEFT JOIN users u ON wl.converted_to_user_id = u.id
        WHERE wl.id = $1
      `, [leadId]);

      if (leadResult.rows.length === 0) {
        throw new Error('Lead not found');
      }

      const lead = leadResult.rows[0];

      // Get conversion tracking steps
      const stepsResult = await db.query(`
        SELECT *
        FROM conversion_tracking
        WHERE website_lead_id = $1
        ORDER BY step_completed_at ASC
      `, [leadId]);

      return {
        // Lead information
        id: lead.id,
        websiteUrl: lead.website_url,
        businessName: lead.business_name,
        businessType: lead.business_type,
        industry: lead.industry_category,
        estimatedCompanySize: lead.estimated_company_size,
        leadSource: lead.lead_source,
        leadSourceDisplay: this.leadSources[lead.lead_source] || lead.lead_source,
        leadScore: parseInt(lead.lead_score || 0),
        status: lead.status,
        statusDisplay: this.leadStatuses[lead.status] || lead.status,
        isConverted: !!lead.converted_to_user_id,
        convertedAt: lead.converted_at,
        convertedUser: lead.converted_to_user_id ? {
          email: lead.converted_user_email,
          firstName: lead.converted_user_first_name,
          lastName: lead.converted_user_last_name
        } : null,
        daysInFunnel: parseFloat(lead.days_in_funnel || 0).toFixed(1),
        createdAt: lead.created_at,
        updatedAt: lead.updated_at,
        ipAddress: lead.ip_address,
        userAgent: lead.user_agent,
        referrerUrl: lead.referrer,
        
        // Organization data (NEW)
        organizationId: lead.organization_id,
        organizationName: lead.organization_name,
        businessModel: lead.business_model,
        companySize: lead.org_company_size,
        targetAudience: lead.org_target_audience,
        brandVoice: lead.org_brand_voice,
        organizationDescription: lead.org_description,
        websiteGoals: lead.org_website_goals,
        
        // Lead scoring breakdown (NEW)
        scoringBreakdown: {
          overall: parseInt(lead.lead_score || 0),
          businessSize: parseInt(lead.business_size_score || 0),
          industryFit: parseInt(lead.industry_fit_score || 0),
          engagement: parseInt(lead.engagement_score || 0),
          contentQuality: parseInt(lead.content_quality_score || 0),
          technicalReadiness: parseInt(lead.technical_readiness_score || 0),
          budgetIndicator: parseInt(lead.budget_indicator_score || 0),
          urgency: parseInt(lead.urgency_score || 0)
        },
        scoringFactors: lead.scoring_factors || {},
        
        // Business intelligence (NEW)
        decisionMakers: lead.decision_makers || [],
        customerScenarios: lead.customer_scenarios || [],
        businessValueAssessment: lead.business_value_assessment || {},
        customerLanguagePatterns: lead.customer_language_patterns || {},
        searchBehaviorInsights: lead.search_behavior_insights || {},
        seoOpportunities: lead.seo_opportunities || {},
        contentStrategyRecommendations: lead.content_strategy_recommendations || {},
        analysisConfidenceScore: parseFloat(lead.analysis_confidence_score || 0),
        
        // OpenAI Analysis Data (expose specific fields)
        blogStrategy: lead.analysis_data?.blogStrategy,
        searchBehavior: lead.analysis_data?.searchBehavior, 
        connectionMessage: lead.analysis_data?.connectionMessage,
        brandColors: lead.analysis_data?.brandColors,
        contentFocus: lead.analysis_data?.contentFocus,
        websiteGoals: lead.analysis_data?.websiteGoals,
        endUsers: lead.analysis_data?.endUsers,
        
        // Backward compatibility
        analysisData: lead.analysis_data,
        conversionSteps: stepsResult.rows.map(step => ({
          step: step.conversion_step,
          completedAt: step.step_completed_at,
          data: step.step_data,
          timeToComplete: step.total_time_to_conversion
        }))
      };
    } catch (error) {
      console.error('Error getting lead details:', error);
      throw error;
    }
  }

  /**
   * Update lead status (Super Admin Only)
   */
  async updateLeadStatus(leadId, newStatus, notes = '') {
    try {
      const allowedStatuses = Object.keys(this.leadStatuses);
      if (!allowedStatuses.includes(newStatus)) {
        throw new Error(`Invalid status. Allowed: ${allowedStatuses.join(', ')}`);
      }

      await db.query(`
        UPDATE website_leads 
        SET status = $1, updated_at = NOW()
        WHERE id = $2
      `, [newStatus, leadId]);

      // Log the status change
      await db.query(`
        INSERT INTO conversion_tracking (
          website_lead_id, conversion_step, step_completed_at, step_data
        ) VALUES ($1, $2, NOW(), $3)
      `, [
        leadId,
        'status_change',
        JSON.stringify({
          new_status: newStatus,
          notes: notes,
          changed_by: 'super_admin'
        })
      ]);

      return {
        success: true,
        leadId,
        newStatus,
        statusDisplay: this.leadStatuses[newStatus]
      };
    } catch (error) {
      console.error('Error updating lead status:', error);
      throw error;
    }
  }

  /**
   * Track user registration conversion (called when lead converts to user)
   */
  async trackRegistrationConversion(userId, websiteUrl, registrationData = {}) {
    try {
      // Find the matching lead based on website URL and recent creation
      const leadResult = await db.query(`
        SELECT id FROM website_leads 
        WHERE website_url = $1 
          AND converted_to_user_id IS NULL
          AND created_at > NOW() - INTERVAL '24 hours'
        ORDER BY created_at DESC 
        LIMIT 1
      `, [websiteUrl]);

      if (leadResult.rows.length > 0) {
        const leadId = leadResult.rows[0].id;
        
        // Mark lead as converted
        await db.query(`
          UPDATE website_leads 
          SET converted_to_user_id = $1, converted_at = NOW(), status = 'converted'
          WHERE id = $2
        `, [userId, leadId]);

        // Track registration conversion step using database function
        await db.query(`
          SELECT track_conversion_step($1, $2, $3, $4)
        `, [
          leadId,
          'registration',
          JSON.stringify({
            user_id: userId,
            registration_data: registrationData,
            converted_at: new Date().toISOString()
          }),
          registrationData.sessionId || null
        ]);

        console.log(`🎯 Lead ${leadId} converted to user ${userId}`);
        
        return {
          success: true,
          leadId,
          userId,
          conversionStep: 'registration'
        };
      }

      return { success: false, message: 'No matching lead found' };
    } catch (error) {
      console.error('Error tracking registration conversion:', error);
      throw error;
    }
  }

  /**
   * Get lead by session ID
   */
  async getLeadBySessionId(sessionId) {
    try {
      const result = await db.query(`
        SELECT id, website_url, business_name, status, session_id
        FROM website_leads
        WHERE session_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `, [sessionId]);

      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting lead by session ID:', error);
      throw error;
    }
  }

  /**
   * Track any conversion step for a lead
   */
  async trackConversionStep(leadId, stepName, stepData = {}, sessionId = null) {
    try {
      // Use database function to track conversion step
      const result = await db.query(`
        SELECT track_conversion_step($1, $2, $3, $4) as conversion_id
      `, [
        leadId,
        stepName,
        JSON.stringify(stepData),
        sessionId
      ]);

      return {
        success: true,
        conversionId: result.rows[0]?.conversion_id,
        step: stepName
      };
    } catch (error) {
      console.error('Error tracking conversion step:', error);
      throw error;
    }
  }
}

export default new LeadService();