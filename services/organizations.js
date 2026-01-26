import { v4 as uuidv4 } from 'uuid';
import db from './database.js';

/**
 * Organization Management Service
 * Handles organization creation, business intelligence storage, and contact management
 */
class OrganizationService {
  constructor() {
    this.businessSizeMapping = {
      'enterprise': '500+',
      'large': '100-499', 
      'medium': '50-99',
      'small': '10-49',
      'startup': '1-9',
      'unknown': 'Unknown'
    };
  }

  /**
   * Create or update organization from website analysis data
   */
  async createOrUpdateOrganization(websiteUrl, analysisData, sessionInfo = {}) {
    try {
      const websiteDomain = new URL(websiteUrl).hostname;

      // Extract organization data from OpenAI analysis
      const orgData = {
        name: analysisData.businessName || this.extractBusinessNameFromDomain(websiteDomain),
        business_type: analysisData.businessType || 'Unknown',
        industry_category: analysisData.businessType || 'Unknown', // Map to industry
        business_model: analysisData.businessModel || analysisData.description || null,
        company_size: this.mapCompanySize(analysisData.companySize),
        description: analysisData.description || null,
        target_audience: analysisData.targetAudience || null,
        brand_voice: analysisData.brandVoice || null,
        website_goals: analysisData.websiteGoals || null,
        website_url: websiteUrl,
        last_analyzed_at: new Date()
      };

      // Check if organization already exists by exact URL first, then by domain
      let existingOrg = await db.query(`
        SELECT id FROM organizations WHERE website_url = $1
      `, [websiteUrl]);

      // If not found by exact URL, try to find by domain (handles http vs https)
      if (existingOrg.rows.length === 0) {
        existingOrg = await db.query(`
          SELECT id FROM organizations
          WHERE website_url LIKE $1 OR website_url LIKE $2
          LIMIT 1
        `, [`http://${websiteDomain}`, `https://${websiteDomain}`]);
      }

      let organizationId;

      if (existingOrg.rows.length > 0) {
        // Update existing organization
        organizationId = existingOrg.rows[0].id;
        
        await db.query(`
          UPDATE organizations
          SET business_type = $2, industry_category = $3, business_model = $4,
              company_size = $5, description = $6, target_audience = $7,
              brand_voice = $8, website_goals = $9, session_id = COALESCE($10, session_id),
              last_analyzed_at = NOW(), updated_at = NOW()
          WHERE id = $1
        `, [
          organizationId, orgData.business_type, orgData.industry_category,
          orgData.business_model, orgData.company_size, orgData.description,
          orgData.target_audience, orgData.brand_voice, orgData.website_goals,
          sessionInfo.sessionId || null
        ]);

        console.log(`📊 Updated existing organization: ${orgData.name}`);
      } else {
        // Create new organization
        organizationId = uuidv4();

        // Generate unique slug
        let slug = await this.generateUniqueSlug(orgData.name);

        try {
          await db.query(`
            INSERT INTO organizations (
              id, name, slug, business_type, industry_category, business_model,
              company_size, description, target_audience, brand_voice,
              website_goals, website_url, session_id, last_analyzed_at, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW(), NOW())
          `, [
            organizationId, orgData.name, slug, orgData.business_type,
            orgData.industry_category, orgData.business_model, orgData.company_size,
            orgData.description, orgData.target_audience, orgData.brand_voice,
            orgData.website_goals, orgData.website_url, sessionInfo.sessionId || null
          ]);

          console.log(`🏢 Created new organization: ${orgData.name} (${organizationId})`);
        } catch (insertError) {
          // Handle duplicate slug error (race condition)
          if (insertError.code === '23505' && insertError.constraint === 'organizations_slug_key') {
            console.log(`⚠️ Duplicate slug detected for ${orgData.name}, adding timestamp suffix`);

            // Retry with timestamp-suffixed slug
            slug = `${slug}-${Date.now()}`;

            await db.query(`
              INSERT INTO organizations (
                id, name, slug, business_type, industry_category, business_model,
                company_size, description, target_audience, brand_voice,
                website_goals, website_url, session_id, last_analyzed_at, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW(), NOW())
            `, [
              organizationId, orgData.name, slug, orgData.business_type,
              orgData.industry_category, orgData.business_model, orgData.company_size,
              orgData.description, orgData.target_audience, orgData.brand_voice,
              orgData.website_goals, orgData.website_url, sessionInfo.sessionId || null
            ]);

            console.log(`🏢 Created organization with unique slug: ${orgData.name} (${slug})`);
          } else {
            // Re-throw other errors
            throw insertError;
          }
        }
      }

      return organizationId;
    } catch (error) {
      console.error('Error creating/updating organization:', error);
      throw error;
    }
  }

  /**
   * Save organization intelligence data from OpenAI analysis
   */
  async saveOrganizationIntelligence(organizationId, analysisData) {
    try {
      // Mark any existing intelligence as not current
      await db.query(`
        UPDATE organization_intelligence 
        SET is_current = FALSE 
        WHERE organization_id = $1 AND is_current = TRUE
      `, [organizationId]);

      // Extract and structure the intelligence data
      const intelligenceData = {
        customer_scenarios: JSON.stringify(analysisData.scenarios || []),
        business_value_assessment: JSON.stringify(this.extractBusinessValue(analysisData)),
        customer_language_patterns: JSON.stringify(this.extractCustomerLanguage(analysisData)),
        search_behavior_insights: JSON.stringify({
          search_behavior: analysisData.searchBehavior || null,
          connection_message: analysisData.connectionMessage || null
        }),
        seo_opportunities: JSON.stringify(this.extractSEOData(analysisData)),
        content_strategy_recommendations: JSON.stringify({
          content_focus: analysisData.contentFocus,
          blog_strategy: analysisData.blogStrategy,
          brand_colors: analysisData.brandColors
        }),
        analysis_confidence_score: analysisData.webSearchStatus?.enhancementComplete ? 0.85 : 0.65,
        raw_openai_response: JSON.stringify(analysisData)
      };

      // Insert new intelligence record
      const result = await db.query(`
        INSERT INTO organization_intelligence (
          organization_id, customer_scenarios, business_value_assessment,
          customer_language_patterns, search_behavior_insights, seo_opportunities,
          content_strategy_recommendations, analysis_confidence_score, 
          raw_openai_response, is_current, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, NOW(), NOW())
        RETURNING id
      `, [
        organizationId, intelligenceData.customer_scenarios, intelligenceData.business_value_assessment,
        intelligenceData.customer_language_patterns, intelligenceData.search_behavior_insights,
        intelligenceData.seo_opportunities, intelligenceData.content_strategy_recommendations,
        intelligenceData.analysis_confidence_score, intelligenceData.raw_openai_response
      ]);

      console.log(`🧠 Saved organization intelligence: ${result.rows[0].id}`);
      return result.rows[0].id;
    } catch (error) {
      console.error('Error saving organization intelligence:', error);
      throw error;
    }
  }

  /**
   * Extract and save contact information from analysis data
   */
  async extractAndSaveContacts(organizationId, analysisData) {
    try {
      // Extract decision makers from analysis
      const decisionMakers = analysisData.decisionMakers || '';
      const endUsers = analysisData.endUsers || '';

      const contacts = [];

      // Parse decision makers (this is basic - could be enhanced with more sophisticated parsing)
      if (decisionMakers && decisionMakers.trim().length > 0) {
        const roles = decisionMakers.split(/[,;]/).map(role => role.trim()).filter(r => r.length > 0);
        
        for (const role of roles) {
          contacts.push({
            title: role,
            role_type: 'decision_maker',
            confidence_level: 0.6 // Medium confidence since extracted from general description
          });
        }
      }

      // Parse end users if different
      if (endUsers && endUsers.trim() !== decisionMakers.trim()) {
        const roles = endUsers.split(/[,;]/).map(role => role.trim()).filter(r => r.length > 0);
        
        for (const role of roles) {
          contacts.push({
            title: role,
            role_type: 'end_user',
            confidence_level: 0.6
          });
        }
      }

      // Save contacts to database
      for (const contact of contacts) {
        await db.query(`
          INSERT INTO organization_contacts (
            organization_id, title, role_type, data_source, 
            confidence_level, created_at, updated_at
          ) VALUES ($1, $2, $3, 'website_analysis', $4, NOW(), NOW())
        `, [
          organizationId, contact.title, contact.role_type, contact.confidence_level
        ]);
      }

      console.log(`👥 Saved ${contacts.length} contacts for organization ${organizationId}`);
      return contacts.length;
    } catch (error) {
      console.error('Error extracting contacts:', error);
      return 0; // Don't fail lead capture if contact extraction fails
    }
  }

  /**
   * Get organization with full intelligence data
   */
  async getOrganizationProfile(organizationId) {
    try {
      // Get organization basic data
      const orgResult = await db.query(`
        SELECT * FROM organizations WHERE id = $1
      `, [organizationId]);

      if (orgResult.rows.length === 0) {
        throw new Error('Organization not found');
      }

      const organization = orgResult.rows[0];

      // Get current intelligence
      const intelligenceResult = await db.query(`
        SELECT * FROM organization_intelligence 
        WHERE organization_id = $1 AND is_current = TRUE 
        ORDER BY created_at DESC LIMIT 1
      `, [organizationId]);

      // Get contacts
      const contactsResult = await db.query(`
        SELECT * FROM organization_contacts 
        WHERE organization_id = $1 
        ORDER BY role_type = 'decision_maker' DESC, confidence_level DESC
      `, [organizationId]);

      return {
        ...organization,
        intelligence: intelligenceResult.rows[0] || null,
        contacts: contactsResult.rows
      };
    } catch (error) {
      console.error('Error getting organization profile:', error);
      throw error;
    }
  }

  // Helper methods

  extractBusinessNameFromDomain(domain) {
    // Remove www and extract business name from domain
    const cleanDomain = domain.replace(/^www\./, '');
    const parts = cleanDomain.split('.');
    const businessName = parts[0];
    return businessName.charAt(0).toUpperCase() + businessName.slice(1);
  }

  async generateUniqueSlug(name) {
    const baseSlug = name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);

    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await db.query('SELECT id FROM organizations WHERE slug = $1', [slug]);
      if (existing.rows.length === 0) break;
      
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    return slug;
  }

  mapCompanySize(size) {
    if (!size) return 'unknown';
    const normalized = size.toLowerCase();
    
    if (normalized.includes('enterprise') || normalized.includes('500+')) return 'enterprise';
    if (normalized.includes('large') || normalized.includes('100')) return 'large';
    if (normalized.includes('medium') || normalized.includes('50')) return 'medium';
    if (normalized.includes('small') || normalized.includes('10')) return 'small';
    if (normalized.includes('startup') || normalized.includes('1-')) return 'startup';
    
    return 'unknown';
  }

  extractBusinessValue(analysisData) {
    if (!analysisData.scenarios) return {};
    
    return {
      scenario_priorities: analysisData.scenarios.map(scenario => ({
        problem: scenario.customerProblem,
        priority: scenario.businessValue?.priority || 'unknown',
        search_volume: scenario.businessValue?.searchVolume || 'unknown',
        conversion_potential: scenario.businessValue?.conversionPotential || 'unknown'
      }))
    };
  }

  extractCustomerLanguage(analysisData) {
    if (!analysisData.scenarios) return [];
    
    const allLanguage = [];
    for (const scenario of analysisData.scenarios) {
      if (scenario.customerLanguage) {
        allLanguage.push(...scenario.customerLanguage);
      }
    }
    return allLanguage;
  }

  extractSEOData(analysisData) {
    if (!analysisData.scenarios) return {};
    
    const allKeywords = [];
    for (const scenario of analysisData.scenarios) {
      if (scenario.seoKeywords) {
        allKeywords.push(...scenario.seoKeywords);
      }
    }
    
    return {
      keywords: allKeywords,
      content_focus: analysisData.contentFocus,
      brand_voice: analysisData.brandVoice
    };
  }
}

export default new OrganizationService();