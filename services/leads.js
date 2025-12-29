import { v4 as uuidv4 } from 'uuid';
import db from './database.js';

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
   * Capture a new lead from website analysis
   */
  async captureLead(websiteUrl, analysisData, sessionInfo = {}) {
    try {
      const leadId = uuidv4();
      const ipAddress = sessionInfo.ipAddress || 'unknown';
      const userAgent = sessionInfo.userAgent || 'unknown';
      const referrer = sessionInfo.referrer || null;

      // Determine lead source
      let leadSource = 'website_analysis';
      if (referrer) {
        if (referrer.includes('google.com') || referrer.includes('bing.com')) {
          leadSource = 'organic_search';
        } else if (referrer.includes('facebook.com') || referrer.includes('linkedin.com')) {
          leadSource = 'social';
        } else if (referrer !== window.location.origin) {
          leadSource = 'referral';
        }
      }

      // Extract lead scoring data from analysis
      const leadScore = this.calculateLeadScore(analysisData);
      const businessType = analysisData.businessType || 'unknown';
      const estimatedSize = analysisData.companySize || 'unknown';
      const industry = analysisData.industry || 'unknown';

      // Create lead record
      const leadResult = await db.query(`
        INSERT INTO website_leads (
          id, website_url, business_name, business_type, industry, 
          estimated_company_size, lead_source, lead_score, status,
          ip_address, user_agent, referrer_url, analysis_data,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
        RETURNING *
      `, [
        leadId,
        websiteUrl,
        analysisData.businessName || 'Unknown Business',
        businessType,
        industry,
        estimatedSize,
        leadSource,
        leadScore,
        'new',
        ipAddress,
        userAgent,
        referrer,
        JSON.stringify(analysisData)
      ]);

      const lead = leadResult.rows[0];

      // Create initial conversion tracking entry
      await db.query(`
        INSERT INTO conversion_tracking (
          website_lead_id, conversion_step, step_completed_at, step_data
        ) VALUES ($1, $2, NOW(), $3)
      `, [
        leadId,
        'website_analysis',
        JSON.stringify({
          website_url: websiteUrl,
          analysis_quality: leadScore,
          session_info: sessionInfo
        })
      ]);

      console.log(`📊 Captured new lead: ${lead.business_name} (${websiteUrl}) - Score: ${leadScore}`);

      return {
        leadId: lead.id,
        leadScore,
        businessName: lead.business_name,
        source: leadSource,
        status: 'new'
      };
    } catch (error) {
      console.error('Error capturing lead:', error);
      throw error;
    }
  }

  /**
   * Calculate lead score based on website analysis quality
   */
  calculateLeadScore(analysisData) {
    let score = 50; // Base score

    // Business size scoring
    if (analysisData.companySize === 'large') score += 30;
    else if (analysisData.companySize === 'medium') score += 20;
    else if (analysisData.companySize === 'small') score += 10;

    // Industry scoring (higher value industries)
    const highValueIndustries = ['technology', 'finance', 'healthcare', 'consulting'];
    if (highValueIndustries.includes(analysisData.industry?.toLowerCase())) {
      score += 20;
    }

    // Website quality indicators
    if (analysisData.hasContactInfo) score += 10;
    if (analysisData.hasAboutPage) score += 5;
    if (analysisData.hasBlog) score += 15; // They already create content
    if (analysisData.isEcommerce) score += 10;

    // Business maturity
    if (analysisData.businessName && analysisData.businessName !== 'Unknown Business') score += 10;
    if (analysisData.description && analysisData.description.length > 100) score += 10;

    return Math.min(100, Math.max(0, score)); // Clamp between 0-100
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

      let whereConditions = [`lead_score BETWEEN $${1} AND $${2}`];
      let queryParams = [minScore, maxScore];
      let paramIndex = 3;

      // Status filter
      if (status !== 'all') {
        whereConditions.push(`status = $${paramIndex}`);
        queryParams.push(status);
        paramIndex++;
      }

      // Source filter
      if (source !== 'all') {
        whereConditions.push(`lead_source = $${paramIndex}`);
        queryParams.push(source);
        paramIndex++;
      }

      // Date range filter
      if (dateRange !== 'all') {
        const days = dateRange === 'today' ? 1 : dateRange === 'week' ? 7 : dateRange === 'month' ? 30 : 90;
        whereConditions.push(`created_at > NOW() - INTERVAL '${days} days'`);
      }

      // Search filter
      if (search && search.length > 0) {
        whereConditions.push(`(
          LOWER(business_name) LIKE $${paramIndex} OR 
          LOWER(website_url) LIKE $${paramIndex} OR
          LOWER(industry) LIKE $${paramIndex}
        )`);
        queryParams.push(`%${search.toLowerCase()}%`);
        paramIndex++;
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
      
      // Validate sort parameters
      const allowedSortFields = ['created_at', 'lead_score', 'business_name', 'status', 'updated_at'];
      const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
      const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      // Get leads with conversion info
      const leadsResult = await db.query(`
        SELECT 
          wl.*,
          CASE WHEN wl.converted_to_user_id IS NOT NULL THEN TRUE ELSE FALSE END as is_converted,
          wl.converted_at,
          u.email as converted_user_email,
          COUNT(ct.id) as conversion_steps_count,
          EXTRACT(EPOCH FROM (COALESCE(wl.converted_at, NOW()) - wl.created_at)) / 86400 as days_in_funnel
        FROM website_leads wl
        LEFT JOIN users u ON wl.converted_to_user_id = u.id
        LEFT JOIN conversion_tracking ct ON wl.id = ct.website_lead_id
        ${whereClause}
        GROUP BY wl.id, u.email
        ORDER BY wl.${safeSortBy} ${safeSortOrder}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `, [...queryParams, limit, offset]);

      // Get total count for pagination
      const countResult = await db.query(`
        SELECT COUNT(*) as total
        FROM website_leads wl
        ${whereClause}
      `, queryParams);

      const total = parseInt(countResult.rows[0]?.total || 0);

      return {
        leads: leadsResult.rows.map(lead => ({
          id: lead.id,
          websiteUrl: lead.website_url,
          businessName: lead.business_name,
          businessType: lead.business_type,
          industry: lead.industry,
          estimatedCompanySize: lead.estimated_company_size,
          leadSource: lead.lead_source,
          leadScore: parseInt(lead.lead_score),
          status: lead.status,
          isConverted: lead.is_converted,
          convertedAt: lead.converted_at,
          convertedUserEmail: lead.converted_user_email,
          conversionStepsCount: parseInt(lead.conversion_steps_count),
          daysInFunnel: parseFloat(lead.days_in_funnel).toFixed(1),
          createdAt: lead.created_at,
          updatedAt: lead.updated_at,
          ipAddress: lead.ip_address,
          userAgent: lead.user_agent,
          referrerUrl: lead.referrer_url,
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

      // Overall metrics
      const metricsResult = await db.query(`
        SELECT 
          COUNT(*) as total_leads,
          COUNT(CASE WHEN converted_to_user_id IS NOT NULL THEN 1 END) as converted_leads,
          ROUND(AVG(lead_score), 1) as avg_lead_score,
          COUNT(CASE WHEN lead_score >= 80 THEN 1 END) as high_quality_leads,
          COUNT(CASE WHEN status = 'new' THEN 1 END) as new_leads,
          COUNT(CASE WHEN created_at > NOW() - INTERVAL '${days} days' THEN 1 END) as recent_leads
        FROM website_leads
      `);

      const metrics = metricsResult.rows[0];
      const conversionRate = metrics.total_leads > 0 
        ? ((metrics.converted_leads / metrics.total_leads) * 100).toFixed(1)
        : '0.0';

      // Lead sources breakdown
      const sourcesResult = await db.query(`
        SELECT 
          lead_source,
          COUNT(*) as count,
          COUNT(CASE WHEN converted_to_user_id IS NOT NULL THEN 1 END) as converted,
          ROUND(AVG(lead_score), 1) as avg_score
        FROM website_leads
        WHERE created_at > NOW() - INTERVAL '${days} days'
        GROUP BY lead_source
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
          industry,
          COUNT(*) as count,
          ROUND(AVG(lead_score), 1) as avg_score
        FROM website_leads
        WHERE created_at > NOW() - INTERVAL '${days} days' AND industry IS NOT NULL
        GROUP BY industry
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
      // Get lead info
      const leadResult = await db.query(`
        SELECT 
          wl.*,
          u.email as converted_user_email,
          u.first_name as converted_user_first_name,
          u.last_name as converted_user_last_name
        FROM website_leads wl
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
        id: lead.id,
        websiteUrl: lead.website_url,
        businessName: lead.business_name,
        businessType: lead.business_type,
        industry: lead.industry,
        estimatedCompanySize: lead.estimated_company_size,
        leadSource: lead.lead_source,
        leadSourceDisplay: this.leadSources[lead.lead_source] || lead.lead_source,
        leadScore: parseInt(lead.lead_score),
        status: lead.status,
        statusDisplay: this.leadStatuses[lead.status] || lead.status,
        isConverted: !!lead.converted_to_user_id,
        convertedAt: lead.converted_at,
        convertedUser: lead.converted_to_user_id ? {
          email: lead.converted_user_email,
          firstName: lead.converted_user_first_name,
          lastName: lead.converted_user_last_name
        } : null,
        createdAt: lead.created_at,
        updatedAt: lead.updated_at,
        ipAddress: lead.ip_address,
        userAgent: lead.user_agent,
        referrerUrl: lead.referrer_url,
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
}

export default new LeadService();