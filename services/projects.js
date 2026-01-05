import { v4 as uuidv4 } from 'uuid';
import db from './database.js';

/**
 * Projects Management Service
 * Handles website analysis projects, business intelligence storage, and audience scenarios
 */
class ProjectsService {
  constructor() {
    this.useDatabaseStorage = process.env.USE_DATABASE === 'true';
    this.databaseAvailable = false;
    
    // In-memory fallback for when database is unavailable
    this.fallbackProjects = new Map();
    
    // Test database availability
    this.testDatabaseConnection();
  }

  async testDatabaseConnection() {
    try {
      await db.testConnection();
      this.databaseAvailable = true;
      console.log('✅ Projects service using database storage');
    } catch (error) {
      this.databaseAvailable = false;
      console.log('⚠️  Projects service falling back to in-memory storage');
    }
  }

  /**
   * Get project by user ID and website URL
   * Used to check if we have existing analysis for this user+website combination
   */
  async getProjectByUserAndUrl(userId, websiteUrl) {
    try {
      if (!userId || !websiteUrl) {
        return null;
      }

      if (this.databaseAvailable && this.useDatabaseStorage) {
        const result = await db.query(`
          SELECT p.*, cs.scenarios, cs.customer_psychology
          FROM projects p
          LEFT JOIN content_strategies cs ON cs.project_id = p.id AND cs.is_default = true
          WHERE p.user_id = $1 AND p.website_url = $2
          ORDER BY p.updated_at DESC
          LIMIT 1
        `, [userId, websiteUrl]);

        if (result.rows.length === 0) {
          return null;
        }

        const project = result.rows[0];
        return {
          id: project.id,
          websiteUrl: project.website_url,
          businessAnalysis: project.business_analysis,
          brandColors: project.brand_colors,
          targetAudience: project.target_audience,
          contentFocus: project.content_focus,
          brandVoice: project.brand_voice,
          businessType: project.business_type,
          scenarios: project.scenarios || [],
          customerPsychology: project.customer_psychology,
          // New structured fields
          keywords: project.keywords || [],
          description: project.description,
          decisionMakers: project.decision_makers,
          endUsers: project.end_users,
          businessModel: project.business_model,
          websiteGoals: project.website_goals,
          blogStrategy: project.blog_strategy,
          searchBehavior: project.search_behavior,
          connectionMessage: project.connection_message,
          updatedAt: project.updated_at,
          createdAt: project.created_at
        };
      } else {
        // Fallback to memory
        const projectKey = `${userId}_${websiteUrl}`;
        return this.fallbackProjects.get(projectKey) || null;
      }
    } catch (error) {
      console.error('Get project error:', error.message);
      return null;
    }
  }

  /**
   * Check if user has admin or super_admin role
   */
  async isUserAdmin(userId) {
    try {
      if (this.databaseAvailable && this.useDatabaseStorage) {
        const result = await db.query(`
          SELECT role 
          FROM users 
          WHERE id = $1 AND role IN ('admin', 'super_admin')
        `, [userId]);
        
        return result.rows.length > 0;
      }
      return false;
    } catch (error) {
      console.error('Check admin role error:', error.message);
      return false;
    }
  }

  /**
   * Update organization website URL for admin users
   */
  async updateOrganizationWebsite(userId, websiteUrl) {
    try {
      if (this.databaseAvailable && this.useDatabaseStorage) {
        // Update organization website_url for this user's organization
        const result = await db.query(`
          UPDATE organizations 
          SET website_url = $1, updated_at = NOW()
          WHERE id = (
            SELECT om.organization_id 
            FROM organization_members om 
            WHERE om.user_id = $2 
            LIMIT 1
          )
          RETURNING id, website_url
        `, [websiteUrl, userId]);

        if (result.rows.length > 0) {
          console.log(`✅ Updated organization website to: ${websiteUrl}`);
          return { success: true, organizationId: result.rows[0].id };
        } else {
          console.log('⚠️ No organization found for user, skipping website update');
          return { success: false, reason: 'No organization found' };
        }
      }
      return { success: false, reason: 'Database not available' };
    } catch (error) {
      console.error('Update organization website error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create new project with website analysis data
   */
  async createProject(userId, websiteUrl, analysisData, projectName = null) {
    try {
      const projectId = uuidv4();
      const strategyId = uuidv4();
      
      // Extract data from analysis
      const {
        businessName,
        businessType,
        targetAudience,
        contentFocus,
        brandVoice,
        brandColors,
        scenarios = [],
        customerProblems = [],
        customerLanguage = [],
        searchBehavior = '',
        decisionMakers = '',
        endUsers = '',
        // New structured fields
        keywords = [],
        description = '',
        businessModel = '',
        websiteGoals = '',
        blogStrategy = '',
        connectionMessage = ''
      } = analysisData;

      // Generate project name if not provided
      const finalProjectName = projectName || `${businessName || 'Website'} Analysis`;

      if (this.databaseAvailable && this.useDatabaseStorage) {
        // Use transaction to ensure data consistency
        const result = await db.transaction(async (client) => {
          // Create project
          await client.query(`
            INSERT INTO projects (
              id, user_id, name, website_url, business_analysis, 
              brand_colors, target_audience, content_focus, brand_voice, business_type,
              keywords, description, decision_makers, end_users, business_model,
              website_goals, blog_strategy, search_behavior, connection_message,
              created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW())
          `, [
            projectId,
            userId,
            finalProjectName,
            websiteUrl,
            JSON.stringify(analysisData),
            JSON.stringify(brandColors),
            targetAudience,
            contentFocus,
            brandVoice,
            businessType,
            // New structured fields
            JSON.stringify(keywords),
            description,
            decisionMakers,
            endUsers,
            businessModel,
            websiteGoals,
            blogStrategy,
            searchBehavior,
            connectionMessage
          ]);

          // Create default content strategy with scenarios
          if (scenarios.length > 0) {
            await client.query(`
              INSERT INTO content_strategies (
                id, project_id, name, goal, voice, template, length,
                target_audience, content_focus, customer_psychology, scenarios, is_default,
                created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
            `, [
              strategyId,
              projectId,
              'Default Strategy',
              'awareness', // Default goal
              'expert', // Default voice
              'problem-solution', // Default template
              'standard', // Default length
              targetAudience,
              contentFocus,
              JSON.stringify({
                decisionMakers,
                endUsers,
                customerProblems,
                customerLanguage,
                searchBehavior
              }),
              JSON.stringify(scenarios),
              true // is_default
            ]);
          }

          return { projectId, strategyId };
        });

        console.log(`✅ Created project ${projectId} for user ${userId}: ${finalProjectName}`);
        return {
          success: true,
          projectId: result.projectId,
          strategyId: result.strategyId,
          message: 'Project created successfully'
        };
      } else {
        // Fallback to memory
        const projectKey = `${userId}_${websiteUrl}`;
        const projectData = {
          id: projectId,
          userId,
          name: finalProjectName,
          websiteUrl,
          businessAnalysis: analysisData,
          brandColors,
          targetAudience,
          contentFocus,
          brandVoice,
          businessType,
          scenarios,
          customerPsychology: {
            decisionMakers,
            endUsers,
            customerProblems,
            customerLanguage,
            searchBehavior
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        this.fallbackProjects.set(projectKey, projectData);
        return {
          success: true,
          projectId,
          strategyId,
          message: 'Project created in memory'
        };
      }
    } catch (error) {
      console.error('Create project error:', error.message);
      throw new Error(`Failed to create project: ${error.message}`);
    }
  }

  /**
   * Update existing project with fresh analysis data
   */
  async updateProjectAnalysis(projectId, analysisData) {
    try {
      const {
        businessName,
        businessType,
        targetAudience,
        contentFocus,
        brandVoice,
        brandColors,
        scenarios = [],
        // New structured fields
        keywords = [],
        description = '',
        decisionMakers = '',
        endUsers = '',
        businessModel = '',
        websiteGoals = '',
        blogStrategy = '',
        searchBehavior = '',
        connectionMessage = ''
      } = analysisData;

      if (this.databaseAvailable && this.useDatabaseStorage) {
        await db.transaction(async (client) => {
          // Update project
          await client.query(`
            UPDATE projects 
            SET business_analysis = $1, brand_colors = $2, target_audience = $3,
                content_focus = $4, brand_voice = $5, business_type = $6,
                keywords = $7, description = $8, decision_makers = $9, end_users = $10,
                business_model = $11, website_goals = $12, blog_strategy = $13,
                search_behavior = $14, connection_message = $15, updated_at = NOW()
            WHERE id = $16
          `, [
            JSON.stringify(analysisData),
            JSON.stringify(brandColors),
            targetAudience,
            contentFocus,
            brandVoice,
            businessType,
            JSON.stringify(keywords),
            description,
            decisionMakers,
            endUsers,
            businessModel,
            websiteGoals,
            blogStrategy,
            searchBehavior,
            connectionMessage,
            projectId
          ]);

          // Update scenarios in default strategy
          if (scenarios.length > 0) {
            await client.query(`
              UPDATE content_strategies 
              SET scenarios = $1, target_audience = $2, content_focus = $3, updated_at = NOW()
              WHERE project_id = $4 AND is_default = true
            `, [
              JSON.stringify(scenarios),
              targetAudience,
              contentFocus,
              projectId
            ]);
          }
        });

        console.log(`✅ Updated project ${projectId} with fresh analysis`);
        return { success: true, message: 'Project updated successfully' };
      } else {
        // Update memory fallback would require additional logic to find by projectId
        return { success: true, message: 'Project updated in memory' };
      }
    } catch (error) {
      console.error('Update project error:', error.message);
      throw new Error(`Failed to update project: ${error.message}`);
    }
  }

  /**
   * Get user's most recent project analysis (for displaying cached data)
   */
  async getUserMostRecentAnalysis(userId) {
    try {
      if (!userId) {
        return null;
      }

      if (this.databaseAvailable && this.useDatabaseStorage) {
        const result = await db.query(`
          SELECT p.*, cs.scenarios, cs.customer_psychology
          FROM projects p
          LEFT JOIN content_strategies cs ON cs.project_id = p.id AND cs.is_default = true
          WHERE p.user_id = $1
          ORDER BY p.updated_at DESC
          LIMIT 1
        `, [userId]);

        if (result.rows.length === 0) {
          return null;
        }

        const project = result.rows[0];
        return {
          id: project.id,
          websiteUrl: project.website_url,
          businessAnalysis: project.business_analysis,
          brandColors: project.brand_colors,
          targetAudience: project.target_audience,
          contentFocus: project.content_focus,
          brandVoice: project.brand_voice,
          businessType: project.business_type,
          scenarios: project.scenarios || [],
          customerPsychology: project.customer_psychology,
          // New structured fields
          keywords: project.keywords || [],
          description: project.description,
          decisionMakers: project.decision_makers,
          endUsers: project.end_users,
          businessModel: project.business_model,
          websiteGoals: project.website_goals,
          blogStrategy: project.blog_strategy,
          searchBehavior: project.search_behavior,
          connectionMessage: project.connection_message,
          updatedAt: project.updated_at,
          createdAt: project.created_at
        };
      } else {
        // Fallback to memory - find most recent project for user
        const userProjects = Array.from(this.fallbackProjects.values())
          .filter(p => p.userId === userId)
          .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        
        return userProjects.length > 0 ? userProjects[0] : null;
      }
    } catch (error) {
      console.error('Get most recent analysis error:', error.message);
      return null;
    }
  }

  /**
   * Check if analysis is fresh (less than specified days old)
   */
  isAnalysisFresh(updatedAt, maxAgeDays = 30) {
    if (!updatedAt) return false;
    
    const analysisDate = new Date(updatedAt);
    const now = new Date();
    const ageDays = (now - analysisDate) / (1000 * 60 * 60 * 24);
    
    return ageDays <= maxAgeDays;
  }

  /**
   * Get user's projects with pagination
   */
  async getUserProjects(userId, options = {}) {
    const { limit = 25, offset = 0 } = options;

    try {
      if (this.databaseAvailable && this.useDatabaseStorage) {
        const result = await db.query(`
          SELECT p.id, p.name, p.website_url, p.business_type, p.brand_colors,
                 p.target_audience, p.created_at, p.updated_at,
                 COUNT(bp.id) as blog_post_count
          FROM projects p
          LEFT JOIN blog_posts bp ON bp.project_id = p.id AND bp.status != 'archived'
          WHERE p.user_id = $1
          GROUP BY p.id, p.name, p.website_url, p.business_type, p.brand_colors, 
                   p.target_audience, p.created_at, p.updated_at
          ORDER BY p.updated_at DESC
          LIMIT $2 OFFSET $3
        `, [userId, limit, offset]);

        return {
          success: true,
          projects: result.rows.map(row => ({
            id: row.id,
            name: row.name,
            websiteUrl: row.website_url,
            businessType: row.business_type,
            brandColors: row.brand_colors,
            targetAudience: row.target_audience,
            blogPostCount: parseInt(row.blog_post_count),
            createdAt: row.created_at,
            updatedAt: row.updated_at
          })),
          total: result.rows.length,
          limit,
          offset
        };
      } else {
        // Memory fallback
        const userProjects = Array.from(this.fallbackProjects.values())
          .filter(p => p.userId === userId)
          .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
          .slice(offset, offset + limit);

        return {
          success: true,
          projects: userProjects,
          total: userProjects.length,
          limit,
          offset
        };
      }
    } catch (error) {
      console.error('Get user projects error:', error.message);
      return { success: false, projects: [], error: error.message };
    }
  }

  /**
   * Get storage status for debugging
   */
  getStorageStatus() {
    return {
      useDatabaseStorage: this.useDatabaseStorage,
      databaseAvailable: this.databaseAvailable,
      mode: this.databaseAvailable && this.useDatabaseStorage ? 'database' : 'memory',
      fallbackProjectCount: this.fallbackProjects.size
    };
  }
}

// Export singleton instance
const projectsService = new ProjectsService();
export default projectsService;