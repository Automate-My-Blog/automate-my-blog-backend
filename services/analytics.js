import db from './database.js';
import openaiService from './openai.js';

/**
 * Analytics Service
 * Centralized service for product analytics data operations
 */
class AnalyticsService {
  /**
   * Track a single event
   * @param {String} userId - User ID (null for anonymous users)
   * @param {String} sessionId - Session ID
   * @param {String} eventType - Type of event (page_view, click, form_submit, etc.)
   * @param {Object} eventData - Event-specific data
   * @param {Object} metadata - Additional metadata (conversionFunnelStep, revenueAttributed, etc.)
   * @returns {Promise<Object>} Created event
   */
  async trackEvent(userId, sessionId, eventType, eventData = {}, metadata = {}) {
    try {
      console.log(`📊 Analytics: Tracking event ${eventType} for user ${userId || 'anonymous'}`);

      const result = await db.query(`
        INSERT INTO user_activity_events (
          user_id,
          session_id,
          event_type,
          event_data,
          page_url,
          referrer,
          conversion_funnel_step,
          revenue_attributed,
          timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING *
      `, [
        userId,
        sessionId,
        eventType,
        JSON.stringify(eventData),
        metadata.pageUrl || null,
        metadata.referrer || null,
        metadata.conversionFunnelStep || null,
        metadata.revenueAttributed || null
      ]);

      return result.rows[0];
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to track event - ${error.message}`);
      // Don't throw - analytics failure shouldn't block main app
      return null;
    }
  }

  /**
   * Track multiple events in bulk (for batch processing)
   * @param {Array} events - Array of event objects
   * @returns {Promise<Number>} Number of events tracked
   */
  async bulkTrackEvents(events) {
    try {
      console.log(`📊 Analytics: Bulk tracking ${events.length} events`);

      let trackedCount = 0;

      for (const event of events) {
        const result = await this.trackEvent(
          event.userId,
          event.sessionId,
          event.eventType,
          event.eventData,
          event.metadata || {}
        );

        if (result) trackedCount++;
      }

      console.log(`✅ Analytics: Successfully tracked ${trackedCount}/${events.length} events`);
      return trackedCount;
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to bulk track events - ${error.message}`);
      return 0;
    }
  }

  /**
   * Get funnel data with conversion rates between steps
   * @param {String} startDate - Start date (YYYY-MM-DD)
   * @param {String} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<Object>} Funnel data with steps and conversions
   */
  async getFunnelData(startDate, endDate) {
    try {
      console.log(`📈 Analytics: Getting MERGED funnel data (leads + users) from ${startDate} to ${endDate}`);

      // MERGED FUNNEL: Anonymous Visitors → Leads → Registered Users → Paying Customers
      const result = await db.query(`
        WITH
        -- LEAD FUNNEL (Anonymous Visitors)
        total_leads AS (
          SELECT COUNT(DISTINCT id) as count
          FROM website_leads
          WHERE DATE(created_at) >= DATE($1)
            AND DATE(created_at) <= DATE($2)
        ),
        analysis_started AS (
          SELECT COUNT(DISTINCT session_id) as count
          FROM user_activity_events
          WHERE event_type = 'analysis_started'
            AND DATE(timestamp) >= DATE($1)
            AND DATE(timestamp) <= DATE($2)
        ),
        analysis_completed AS (
          SELECT COUNT(DISTINCT session_id) as count
          FROM user_activity_events
          WHERE event_type = 'analysis_completed'
            AND DATE(timestamp) >= DATE($1)
            AND DATE(timestamp) <= DATE($2)
        ),
        topic_selected AS (
          SELECT COUNT(DISTINCT COALESCE(user_id::text, session_id)) as count
          FROM user_activity_events
          WHERE event_type = 'topic_selected'
            AND DATE(timestamp) >= DATE($1)
            AND DATE(timestamp) <= DATE($2)
        ),
        signup_started AS (
          SELECT COUNT(DISTINCT session_id) as count
          FROM user_activity_events
          WHERE event_type = 'signup_started'
            AND DATE(timestamp) >= DATE($1)
            AND DATE(timestamp) <= DATE($2)
        ),
        -- USER FUNNEL (Registered Users)
        user_base AS (
          SELECT DISTINCT u.id, u.email, u.created_at, u.email_verified_at
          FROM users u
          WHERE DATE(u.created_at) >= DATE($1)
            AND DATE(u.created_at) <= DATE($2)
        ),
        user_logins AS (
          SELECT DISTINCT user_id
          FROM user_activity_events
          WHERE event_type IN ('login', 'user_login', 'session_start', 'login_completed')
            AND DATE(timestamp) >= DATE($1)
        ),
        user_generations AS (
          SELECT DISTINCT user_id
          FROM blog_posts
          WHERE DATE(created_at) >= DATE($1)
        ),
        user_payments AS (
          SELECT DISTINCT user_id
          FROM pay_per_use_charges
          WHERE DATE(charged_at) >= DATE($1)
        ),
        user_subscriptions AS (
          SELECT DISTINCT user_id, plan_name
          FROM subscriptions
          WHERE status = 'active'
            AND DATE(created_at) >= DATE($1)
        )
        SELECT
          -- Lead funnel counts
          (SELECT count FROM total_leads) as total_leads,
          (SELECT count FROM analysis_started) as analysis_started,
          (SELECT count FROM analysis_completed) as analysis_completed,
          (SELECT count FROM topic_selected) as topic_selected,
          (SELECT count FROM signup_started) as signup_started,
          -- User funnel counts
          (SELECT COUNT(*) FROM user_base) as signed_up,
          (SELECT COUNT(*) FROM user_base WHERE email_verified_at IS NOT NULL) as email_verified,
          (SELECT COUNT(DISTINCT ul.user_id) FROM user_logins ul INNER JOIN user_base ub ON ul.user_id = ub.id) as first_login,
          (SELECT COUNT(DISTINCT ug.user_id) FROM user_generations ug INNER JOIN user_base ub ON ug.user_id = ub.id) as first_generation,
          (SELECT COUNT(DISTINCT up.user_id) FROM user_payments up INNER JOIN user_base ub ON up.user_id = ub.id) as payment_success,
          (SELECT COUNT(DISTINCT us.user_id) FROM user_subscriptions us INNER JOIN user_base ub ON us.user_id = ub.id) as active_subscriber,
          (SELECT COUNT(DISTINCT us.user_id) FROM user_subscriptions us INNER JOIN user_base ub ON us.user_id = ub.id WHERE us.plan_name = 'Professional') as upsell
      `, [startDate, endDate]);

      const counts = result.rows[0];

      console.log(`📊 Analytics: MERGED Funnel counts - total_leads: ${counts.total_leads}, analysis_started: ${counts.analysis_started}, signed_up: ${counts.signed_up}, first_generation: ${counts.first_generation}`);

      // Build MERGED steps array (anonymous → registered → paying)
      const steps = [
        // LEAD STAGE (Anonymous Visitors)
        { step: 'total_leads', name: 'Website Visitors', count: parseInt(counts.total_leads) || 0, conversion_rate: 100, stage: 'lead' },
        { step: 'analysis_started', name: 'Started Analysis', count: parseInt(counts.analysis_started) || 0, conversion_rate: 0, stage: 'lead' },
        { step: 'analysis_completed', name: 'Completed Analysis', count: parseInt(counts.analysis_completed) || 0, conversion_rate: 0, stage: 'lead' },
        { step: 'topic_selected', name: 'Selected Topic', count: parseInt(counts.topic_selected) || 0, conversion_rate: 0, stage: 'lead' },
        { step: 'signup_started', name: 'Started Signup', count: parseInt(counts.signup_started) || 0, conversion_rate: 0, stage: 'lead' },
        // USER STAGE (Registered Users)
        { step: 'signed_up', name: 'Registered', count: parseInt(counts.signed_up) || 0, conversion_rate: 0, stage: 'user' },
        { step: 'email_verified', name: 'Email Verified', count: parseInt(counts.email_verified) || 0, conversion_rate: 0, stage: 'user' },
        { step: 'first_login', name: 'First Login', count: parseInt(counts.first_login) || 0, conversion_rate: 0, stage: 'user' },
        { step: 'first_generation', name: 'Generated Content', count: parseInt(counts.first_generation) || 0, conversion_rate: 0, stage: 'user' },
        // REVENUE STAGE (Paying Customers)
        { step: 'payment_success', name: 'First Payment', count: parseInt(counts.payment_success) || 0, conversion_rate: 0, stage: 'revenue' },
        { step: 'active_subscriber', name: 'Active Subscriber', count: parseInt(counts.active_subscriber) || 0, conversion_rate: 0, stage: 'revenue' },
        { step: 'upsell', name: 'Upgraded to Pro', count: parseInt(counts.upsell) || 0, conversion_rate: 0, stage: 'revenue' }
      ];

      // Calculate conversion rates (percentage of previous step)
      for (let i = 1; i < steps.length; i++) {
        const prevCount = steps[i - 1].count;
        if (prevCount > 0) {
          steps[i].conversion_rate = ((steps[i].count / prevCount) * 100).toFixed(2);
        }
      }

      console.log(`✅ Analytics: Returning ${steps.length} MERGED funnel steps (${steps.filter(s => s.stage === 'lead').length} lead + ${steps.filter(s => s.stage === 'user').length} user + ${steps.filter(s => s.stage === 'revenue').length} revenue)`);
      return { steps, conversions: {}, stages: { lead: 5, user: 4, revenue: 3 } };
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get merged funnel data - ${error.message}`);
      console.error(`⚠️ Analytics: Stack trace - ${error.stack}`);
      return { steps: [], conversions: {}, stages: {} };
    }
  }

  /**
   * Get lead funnel data (backward compatibility - now merged into main funnel)
   * @param {String} startDate - Start date (YYYY-MM-DD)
   * @param {String} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<Object>} Funnel data filtered to show only lead stages
   */
  async getLeadFunnelData(startDate, endDate) {
    try {
      console.log(`📈 Analytics: Getting lead funnel data (calls merged funnel) from ${startDate} to ${endDate}`);

      // Call the merged funnel and filter to lead stages only
      const mergedFunnel = await this.getFunnelData(startDate, endDate);

      // Filter to show only lead-stage steps
      const leadSteps = mergedFunnel.steps.filter(step => step.stage === 'lead');

      console.log(`✅ Analytics: Returning ${leadSteps.length} lead funnel steps`);
      return { steps: leadSteps, conversions: mergedFunnel.conversions };
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get lead funnel data - ${error.message}`);
      return { steps: [], conversions: {} };
    }
  }

  /**
   * Get engagement metrics for navigation and interaction events (PR #28)
   * @param {String} timeRange - Time range filter (7d, 30d, 90d, all)
   * @returns {Promise<Object>} Engagement metrics
   */
  async getEngagementMetrics(timeRange = '30d') {
    try {
      console.log(`📊 Analytics: Getting engagement metrics for ${timeRange}`);

      const timeFilter = this._getTimeFilter(timeRange);

      // Page views by page
      const pageViewsResult = await db.query(`
        SELECT
          page_url,
          COUNT(*) as view_count,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(DISTINCT session_id) as unique_sessions
        FROM user_activity_events
        WHERE event_type = 'page_view'
          ${timeFilter}
        GROUP BY page_url
        ORDER BY view_count DESC
        LIMIT 20
      `);

      // Tab switches (dashboard navigation)
      const tabSwitchesResult = await db.query(`
        SELECT
          event_data->>'tab' as tab_name,
          COUNT(*) as switch_count,
          COUNT(DISTINCT user_id) as unique_users
        FROM user_activity_events
        WHERE event_type = 'tab_switched'
          ${timeFilter}
        GROUP BY event_data->>'tab'
        ORDER BY switch_count DESC
      `);

      // Topic selection distribution
      const topicSelectionResult = await db.query(`
        SELECT
          event_data->>'topic' as topic,
          COUNT(*) as selection_count,
          COUNT(DISTINCT user_id) as unique_users
        FROM user_activity_events
        WHERE event_type = 'topic_selected'
          ${timeFilter}
        GROUP BY event_data->>'topic'
        ORDER BY selection_count DESC
        LIMIT 10
      `);

      // Export activity
      const exportActivityResult = await db.query(`
        SELECT
          event_data->>'format' as export_format,
          COUNT(*) as export_count,
          COUNT(DISTINCT user_id) as unique_users
        FROM user_activity_events
        WHERE event_type IN ('export_initiated', 'content_exported')
          ${timeFilter}
        GROUP BY event_data->>'format'
        ORDER BY export_count DESC
      `);

      // User session metrics
      const sessionMetricsResult = await db.query(`
        SELECT
          AVG(event_count) as avg_events_per_session,
          AVG(session_duration_minutes) as avg_session_duration
        FROM (
          SELECT
            session_id,
            COUNT(*) as event_count,
            EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp)))/60 as session_duration_minutes
          FROM user_activity_events
          WHERE timestamp > NOW() - INTERVAL '${timeRange === 'all' ? '1 year' : timeRange}'
          GROUP BY session_id
          HAVING COUNT(*) > 1
        ) sessions
      `);

      // Logout tracking
      const logoutResult = await db.query(`
        SELECT
          COUNT(*) as logout_count,
          COUNT(DISTINCT user_id) as users_who_logged_out
        FROM user_activity_events
        WHERE event_type = 'logout'
          ${timeFilter}
      `);

      const pageViewTotal = pageViewsResult.rows.reduce((sum, row) => sum + parseInt(row.view_count || 0), 0);
      const tabSwitchTotal = tabSwitchesResult.rows.reduce((sum, row) => sum + parseInt(row.switch_count || 0), 0);
      const topicSelTotal = topicSelectionResult.rows.reduce((sum, row) => sum + parseInt(row.selection_count || 0), 0);
      const exportTotal = exportActivityResult.rows.reduce((sum, row) => sum + parseInt(row.export_count || 0), 0);

      console.log(`✅ Analytics: Engagement metrics - ${pageViewTotal} page views, ${tabSwitchTotal} tab switches, ${topicSelTotal} topics selected, ${exportTotal} exports`);

      return {
        pageViews: {
          byPage: pageViewsResult.rows,
          total: pageViewTotal
        },
        tabSwitches: {
          byTab: tabSwitchesResult.rows,
          total: tabSwitchTotal
        },
        topicSelection: {
          byTopic: topicSelectionResult.rows,
          total: topicSelTotal
        },
        exportActivity: {
          byFormat: exportActivityResult.rows,
          total: exportTotal
        },
        sessionMetrics: sessionMetricsResult.rows[0] || { avg_events_per_session: 0, avg_session_duration: 0 },
        logout: logoutResult.rows[0] || { logout_count: 0, users_who_logged_out: 0 }
      };
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get engagement metrics - ${error.message}`);
      return {
        pageViews: { byPage: [], total: 0 },
        tabSwitches: { byTab: [], total: 0 },
        topicSelection: { byTopic: [], total: 0 },
        exportActivity: { byFormat: [], total: 0 },
        sessionMetrics: { avg_events_per_session: 0, avg_session_duration: 0 },
        logout: { logout_count: 0, users_who_logged_out: 0 }
      };
    }
  }

  /**
   * Helper: Get time filter SQL clause
   * @private
   */
  _getTimeFilter(timeRange) {
    const intervals = {
      '7d': '7 days',
      '30d': '30 days',
      '90d': '90 days',
      'all': null
    };

    const interval = intervals[timeRange] || intervals['30d'];
    return interval ? `AND timestamp > NOW() - INTERVAL '${interval}'` : '';
  }

  /**
   * Get users at a specific funnel stage
   * @param {String} funnelStep - Funnel step (signed_up, email_verified, first_login, etc.)
   * @param {String} startDate - Start date
   * @param {String} endDate - End date
   * @param {Boolean} excludeAdvanced - Exclude users who have progressed to next stage
   * @returns {Promise<Array>} Users at this stage with email/website
   */
  async getUsersAtFunnelStage(funnelStep, startDate, endDate, excludeAdvanced = false) {
    try {
      console.log(`📊 Analytics: Getting users at funnel stage ${funnelStep} (excludeAdvanced: ${excludeAdvanced})`);

      let query = '';

      switch (funnelStep) {
        case 'signed_up':
          query = `
            SELECT DISTINCT u.id, u.email, u.created_at, p.website_url
            FROM users u
            LEFT JOIN projects p ON u.id = p.user_id
            WHERE DATE(u.created_at) >= DATE($1)
              AND DATE(u.created_at) <= DATE($2)
              ${excludeAdvanced ? 'AND u.email_verified_at IS NULL' : ''}
            ORDER BY u.created_at DESC
            LIMIT 100
          `;
          break;

        case 'email_verified':
          query = `
            SELECT DISTINCT u.id, u.email, u.created_at, p.website_url
            FROM users u
            LEFT JOIN projects p ON u.id = p.user_id
            WHERE DATE(u.created_at) >= DATE($1)
              AND DATE(u.created_at) <= DATE($2)
              AND u.email_verified_at IS NOT NULL
              ${excludeAdvanced ? `AND NOT EXISTS (
                SELECT 1 FROM user_activity_events uae
                WHERE uae.user_id = u.id
                  AND uae.event_type IN ('login', 'user_login', 'session_start')
                  AND DATE(uae.timestamp) >= DATE($1)
              )` : ''}
            ORDER BY u.created_at DESC
            LIMIT 100
          `;
          break;

        case 'first_login':
          query = `
            WITH user_base AS (
              SELECT DISTINCT u.id, u.email, u.created_at
              FROM users u
              WHERE DATE(u.created_at) >= DATE($1)
                AND DATE(u.created_at) <= DATE($2)
            )
            SELECT DISTINCT ub.id, ub.email, ub.created_at, p.website_url
            FROM user_base ub
            INNER JOIN user_activity_events uae ON ub.id = uae.user_id
            LEFT JOIN projects p ON ub.id = p.user_id
            WHERE uae.event_type IN ('login', 'user_login', 'session_start')
              AND DATE(uae.timestamp) >= DATE($1)
              ${excludeAdvanced ? `AND NOT EXISTS (
                SELECT 1 FROM blog_posts bp
                WHERE bp.user_id = ub.id AND DATE(bp.created_at) >= DATE($1)
              )` : ''}
            ORDER BY ub.created_at DESC
            LIMIT 100
          `;
          break;

        case 'first_generation':
          query = `
            WITH user_base AS (
              SELECT DISTINCT u.id, u.email, u.created_at
              FROM users u
              WHERE DATE(u.created_at) >= DATE($1)
                AND DATE(u.created_at) <= DATE($2)
            )
            SELECT DISTINCT ub.id, ub.email, ub.created_at, p.website_url
            FROM user_base ub
            INNER JOIN blog_posts bp ON ub.id = bp.user_id
            LEFT JOIN projects p ON ub.id = p.user_id
            WHERE DATE(bp.created_at) >= DATE($1)
              ${excludeAdvanced ? `AND NOT EXISTS (
                SELECT 1 FROM pay_per_use_charges ppu
                WHERE ppu.user_id = ub.id AND DATE(ppu.charged_at) >= DATE($1)
              )` : ''}
            ORDER BY ub.created_at DESC
            LIMIT 100
          `;
          break;

        case 'payment_success':
          query = `
            WITH user_base AS (
              SELECT DISTINCT u.id, u.email, u.created_at
              FROM users u
              WHERE DATE(u.created_at) >= DATE($1)
                AND DATE(u.created_at) <= DATE($2)
            )
            SELECT DISTINCT ub.id, ub.email, ub.created_at, p.website_url
            FROM user_base ub
            INNER JOIN pay_per_use_charges ppu ON ub.id = ppu.user_id
            LEFT JOIN projects p ON ub.id = p.user_id
            WHERE DATE(ppu.charged_at) >= DATE($1)
              ${excludeAdvanced ? `AND NOT EXISTS (
                SELECT 1 FROM subscriptions s
                WHERE s.user_id = ub.id AND s.status = 'active' AND DATE(s.created_at) >= DATE($1)
              )` : ''}
            ORDER BY ub.created_at DESC
            LIMIT 100
          `;
          break;

        case 'active_subscriber':
          query = `
            WITH user_base AS (
              SELECT DISTINCT u.id, u.email, u.created_at
              FROM users u
              WHERE DATE(u.created_at) >= DATE($1)
                AND DATE(u.created_at) <= DATE($2)
            )
            SELECT DISTINCT ub.id, ub.email, ub.created_at, p.website_url, s.plan_name
            FROM user_base ub
            INNER JOIN subscriptions s ON ub.id = s.user_id
            LEFT JOIN projects p ON ub.id = p.user_id
            WHERE s.status = 'active'
              AND DATE(s.created_at) >= DATE($1)
              ${excludeAdvanced ? `AND s.plan_name != 'Professional'` : ''}
            ORDER BY ub.created_at DESC
            LIMIT 100
          `;
          break;

        case 'upsell':
          query = `
            WITH user_base AS (
              SELECT DISTINCT u.id, u.email, u.created_at
              FROM users u
              WHERE DATE(u.created_at) >= DATE($1)
                AND DATE(u.created_at) <= DATE($2)
            )
            SELECT DISTINCT ub.id, ub.email, ub.created_at, p.website_url, s.plan_name
            FROM user_base ub
            INNER JOIN subscriptions s ON ub.id = s.user_id
            LEFT JOIN projects p ON ub.id = p.user_id
            WHERE s.status = 'active'
              AND s.plan_name = 'Professional'
              AND DATE(s.created_at) >= DATE($1)
            ORDER BY ub.created_at DESC
            LIMIT 100
          `;
          break;

        default:
          return [];
      }

      const result = await db.query(query, [startDate, endDate]);
      console.log(`✅ Analytics: Found ${result.rows.length} users at stage ${funnelStep}`);
      return result.rows;
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get users at funnel stage ${funnelStep} - ${error.message}`);
      console.error(`⚠️ Analytics: Stack trace - ${error.stack}`);
      return [];
    }
  }

  /**
   * Get conversion rates for a specific funnel step
   * @param {String} funnelStep - Funnel step name
   * @returns {Promise<Number>} Conversion rate percentage
   */
  async getConversionRates(funnelStep) {
    try {
      const result = await db.query(`
        SELECT
          COUNT(DISTINCT user_id) as total,
          COUNT(DISTINCT CASE WHEN conversion_funnel_step = $1 THEN user_id END) as converted
        FROM user_activity_events
        WHERE timestamp >= NOW() - INTERVAL '30 days'
      `, [funnelStep]);

      const { total, converted } = result.rows[0];
      const rate = total > 0 ? ((converted / total) * 100).toFixed(2) : 0;

      return parseFloat(rate);
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get conversion rates - ${error.message}`);
      return 0;
    }
  }

  /**
   * Get user journey (timeline of events for a specific user)
   * @param {String} userId - User ID
   * @param {Number} limit - Maximum number of events to return
   * @returns {Promise<Array>} User's event timeline
   */
  async getUserJourney(userId, limit = 100) {
    try {
      console.log(`📊 Analytics: Getting user journey for user ${userId}`);

      const result = await db.query(`
        SELECT
          id,
          event_type,
          event_data,
          page_url,
          conversion_funnel_step,
          revenue_attributed,
          timestamp
        FROM user_activity_events
        WHERE user_id = $1
        ORDER BY timestamp DESC
        LIMIT $2
      `, [userId, limit]);

      const events = result.rows;

      // Categorize events by type for better visualization
      const categorizedEvents = {
        authentication: events.filter(e =>
          ['signup_started', 'signup_completed', 'login_completed', 'logout'].includes(e.event_type)
        ),
        navigation: events.filter(e =>
          ['page_view', 'tab_switched'].includes(e.event_type)
        ),
        workflow: events.filter(e =>
          ['analysis_started', 'analysis_completed', 'topic_selected', 'content_generated', 'export_initiated', 'content_exported'].includes(e.event_type)
        ),
        business: events.filter(e =>
          ['revenue', 'purchase', 'payment_success'].includes(e.event_type)
        ),
        other: events.filter(e =>
          !['signup_started', 'signup_completed', 'login_completed', 'logout',
            'page_view', 'tab_switched',
            'analysis_started', 'analysis_completed', 'topic_selected', 'content_generated', 'export_initiated', 'content_exported',
            'revenue', 'purchase', 'payment_success'].includes(e.event_type)
        )
      };

      return {
        userId,
        totalEvents: events.length,
        events, // Raw chronological events
        categorizedEvents // Grouped by category for frontend display
      };
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get user journey - ${error.message}`);
      return {
        userId,
        totalEvents: 0,
        events: [],
        categorizedEvents: {
          authentication: [],
          navigation: [],
          workflow: [],
          business: [],
          other: []
        }
      };
    }
  }

  /**
   * Get cohort retention data
   * @param {String} cohortDate - Cohort start date (YYYY-MM-DD)
   * @param {Number} periods - Number of periods to analyze
   * @returns {Promise<Array>} Cohort retention data
   */
  async getCohortRetention(cohortDate, periods = 12) {
    try {
      console.log(`📊 Analytics: Getting cohort retention for ${cohortDate}`);

      const result = await db.query(`
        WITH cohort_users AS (
          SELECT DISTINCT user_id
          FROM users
          WHERE DATE(created_at) = $1
        ),
        period_activity AS (
          SELECT
            cu.user_id,
            DATE_TRUNC('week', uae.timestamp) as activity_week
          FROM cohort_users cu
          LEFT JOIN user_activity_events uae ON cu.user_id = uae.user_id
          WHERE uae.timestamp >= $1
          GROUP BY cu.user_id, DATE_TRUNC('week', uae.timestamp)
        )
        SELECT
          activity_week,
          COUNT(DISTINCT user_id) as active_users
        FROM period_activity
        GROUP BY activity_week
        ORDER BY activity_week
        LIMIT $2
      `, [cohortDate, periods]);

      return result.rows;
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get cohort retention - ${error.message}`);
      return [];
    }
  }

  /**
   * Segment users by criteria
   * @param {Object} criteria - Segmentation criteria
   * @returns {Promise<Array>} Segmented users
   */
  async segmentUsers(criteria = {}) {
    try {
      const { segment, startDate, endDate } = criteria;

      let query = `
        SELECT DISTINCT u.id, u.email, u.created_at
        FROM users u
      `;

      const conditions = [];
      const params = [];

      if (segment === 'paying') {
        query += ` INNER JOIN subscriptions s ON u.id = s.user_id`;
        conditions.push(`s.status = 'active'`);
      }

      if (startDate) {
        params.push(startDate);
        conditions.push(`u.created_at >= $${params.length}`);
      }

      if (endDate) {
        params.push(endDate);
        conditions.push(`u.created_at <= $${params.length}`);
      }

      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }

      query += ` ORDER BY u.created_at DESC LIMIT 1000`;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to segment users - ${error.message}`);
      return [];
    }
  }

  /**
   * Get session metrics
   * @param {String} sessionId - Session ID
   * @returns {Promise<Object>} Session metrics
   */
  async getSessionMetrics(sessionId) {
    try {
      const result = await db.query(`
        SELECT
          session_id,
          started_at,
          ended_at,
          duration_seconds,
          pages_viewed,
          device_type,
          browser,
          ip_address
        FROM user_sessions
        WHERE session_id = $1
      `, [sessionId]);

      return result.rows[0] || null;
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get session metrics - ${error.message}`);
      return null;
    }
  }

  /**
   * Get average session duration for a date range
   * @param {Object} dateRange - Date range object with start and end
   * @returns {Promise<Number>} Average duration in seconds
   */
  async getAverageSessionDuration(dateRange) {
    try {
      const { startDate, endDate } = dateRange;

      const result = await db.query(`
        SELECT AVG(duration_seconds) as avg_duration
        FROM user_sessions
        WHERE started_at >= $1 AND started_at <= $2
          AND duration_seconds > 0
      `, [startDate, endDate]);

      return parseFloat(result.rows[0].avg_duration || 0);
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get average session duration - ${error.message}`);
      return 0;
    }
  }

  /**
   * Get revenue attribution for a user
   * @param {String} userId - User ID
   * @returns {Promise<Object>} Revenue data
   */
  async getRevenueAttribution(userId) {
    try {
      const result = await db.query(`
        SELECT
          COALESCE(SUM(ppu.total_amount), 0) as one_time_revenue,
          COALESCE(COUNT(DISTINCT s.id), 0) as active_subscriptions,
          COALESCE(SUM(uc.value_usd), 0) as lifetime_value
        FROM users u
        LEFT JOIN pay_per_use_charges ppu ON u.id = ppu.user_id
        LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
        LEFT JOIN user_credits uc ON u.id = uc.user_id
        WHERE u.id = $1
        GROUP BY u.id
      `, [userId]);

      return result.rows[0] || { one_time_revenue: 0, active_subscriptions: 0, lifetime_value: 0 };
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get revenue attribution - ${error.message}`);
      return { one_time_revenue: 0, active_subscriptions: 0, lifetime_value: 0 };
    }
  }

  /**
   * Get LTV (Lifetime Value) by segment
   * @param {String} segment - User segment
   * @returns {Promise<Number>} Average LTV
   */
  async getLTVBySegment(segment) {
    try {
      const result = await db.query(`
        SELECT AVG(total_revenue) as avg_ltv
        FROM (
          SELECT
            u.id,
            COALESCE(SUM(ppu.total_amount), 0) +
            COALESCE(SUM(uc.value_usd), 0) as total_revenue
          FROM users u
          LEFT JOIN pay_per_use_charges ppu ON u.id = ppu.user_id
          LEFT JOIN user_credits uc ON u.id = uc.user_id
          LEFT JOIN subscriptions s ON u.id = s.user_id
          WHERE s.status = 'active' OR ppu.id IS NOT NULL
          GROUP BY u.id
        ) revenue_by_user
      `);

      return parseFloat(result.rows[0].avg_ltv || 0);
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get LTV by segment - ${error.message}`);
      return 0;
    }
  }

  /**
   * Generate LLM-powered insights from analytics data
   * @param {Object} analyticsData - Analytics data (funnel, cohorts, sessions, revenue)
   * @param {String} context - Analysis context (funnel, retention, revenue)
   * @returns {Promise<Object>} Insights and recommendations
   */
  async generateInsights(analyticsData, context) {
    try {
      console.log(`📈 Analytics: Generating insights for ${context}`);

      // Use OpenAI service to generate insights
      const result = await openaiService.generateAnalyticsInsights(analyticsData, context);

      return result;
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to generate insights - ${error.message}`);
      return {
        insights: [],
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Get platform-wide metrics
   * @param {String} period - Time period (7d, 30d, 90d)
   * @returns {Promise<Object>} Platform metrics
   */
  async getPlatformMetrics(period = '30d') {
    try {
      const days = parseInt(period.replace('d', ''));

      const result = await db.query(`
        WITH date_range AS (
          SELECT NOW() - INTERVAL '${days} days' as start_date, NOW() as end_date
        ),
        current_period AS (
          SELECT
            COUNT(DISTINCT u.id) as total_users,
            COUNT(DISTINCT CASE
              WHEN s.status = 'active'
              AND s.stripe_subscription_id IS NOT NULL
              AND s.plan_name != 'Free'
              THEN u.id
            END) as paying_users,
            COALESCE(SUM(
              CASE
                WHEN ppu.charged_at >= (SELECT start_date FROM date_range)
                THEN ppu.total_amount
                ELSE 0
              END
            ), 0) as revenue
          FROM users u
          LEFT JOIN subscriptions s ON u.id = s.user_id
          LEFT JOIN pay_per_use_charges ppu ON u.id = ppu.user_id
        ),
        previous_period AS (
          SELECT COUNT(DISTINCT u.id) as total_users
          FROM users u
          WHERE u.created_at >= NOW() - INTERVAL '${days * 2} days'
            AND u.created_at < NOW() - INTERVAL '${days} days'
        ),
        current_period_new_users AS (
          SELECT COUNT(DISTINCT u.id) as new_users
          FROM users u
          WHERE u.created_at >= (SELECT start_date FROM date_range)
        )
        SELECT
          cp.total_users,
          cp.paying_users,
          cp.revenue,
          CASE
            WHEN pp.total_users > 0
            THEN ROUND(((cpn.new_users - pp.total_users) * 100.0 / pp.total_users)::numeric, 2)
            ELSE 0
          END as growth_rate
        FROM current_period cp, previous_period pp, current_period_new_users cpn
      `);

      return result.rows[0];
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get platform metrics - ${error.message}`);
      return {
        total_users: 0,
        paying_users: 0,
        revenue: 0,
        growth_rate: 0
      };
    }
  }

  /**
   * Get comprehensive analytics metrics including referrals, subscriptions, revenue
   * @param {String} period - Time period (7d, 30d, 90d)
   * @returns {Promise<Object>} Comprehensive metrics
   */
  async getComprehensiveMetrics(period = '30d') {
    try {
      console.log(`📊 Analytics: Getting comprehensive metrics for period ${period}`);
      const days = parseInt(period.replace('d', ''));

      if (isNaN(days) || days <= 0) {
        throw new Error(`Invalid period: ${period}`);
      }

      console.log(`📊 Analytics: Calculated days: ${days}`);

      const result = await db.query(`
        WITH date_range AS (
          SELECT
            NOW() - INTERVAL '${days} days' as start_date,
            NOW() as end_date,
            NOW() - INTERVAL '${days * 2} days' as prev_start,
            NOW() - INTERVAL '${days} days' as prev_end
        ),

        -- User metrics
        user_metrics AS (
          SELECT
            COUNT(DISTINCT u.id) as total_users,
            COUNT(DISTINCT CASE
              WHEN u.created_at >= (SELECT start_date FROM date_range)
              THEN u.id
            END) as new_users,
            COUNT(DISTINCT CASE
              WHEN u.created_at BETWEEN (SELECT prev_start FROM date_range)
              AND (SELECT prev_end FROM date_range)
              THEN u.id
            END) as prev_new_users
          FROM users u
        ),

        -- Subscription metrics
        subscription_metrics AS (
          SELECT
            COUNT(DISTINCT CASE
              WHEN s.status = 'active'
              AND s.stripe_subscription_id IS NOT NULL
              AND s.plan_name = 'Starter'
              THEN s.id
            END) as starter_count,
            COUNT(DISTINCT CASE
              WHEN s.status = 'active'
              AND s.stripe_subscription_id IS NOT NULL
              AND s.plan_name = 'Professional'
              THEN s.id
            END) as professional_count,
            -- Calculate MRR
            (COUNT(DISTINCT CASE WHEN s.status = 'active' AND s.plan_name = 'Starter' THEN s.id END) * 20 +
             COUNT(DISTINCT CASE WHEN s.status = 'active' AND s.plan_name = 'Professional' THEN s.id END) * 50) as subscription_mrr
          FROM subscriptions s
          WHERE s.status = 'active'
            AND s.current_period_end > NOW()
        ),

        -- Revenue metrics
        revenue_metrics AS (
          SELECT
            COALESCE(SUM(
              CASE WHEN ppu.charged_at >= (SELECT start_date FROM date_range)
              THEN ppu.total_amount ELSE 0 END
            ), 0) as pay_per_use_revenue,
            COALESCE(SUM(
              CASE WHEN ppu.charged_at BETWEEN (SELECT prev_start FROM date_range)
              AND (SELECT prev_end FROM date_range)
              THEN ppu.total_amount ELSE 0 END
            ), 0) as prev_revenue
          FROM pay_per_use_charges ppu
        ),

        -- Referral metrics
        referral_metrics AS (
          SELECT
            COUNT(DISTINCT r.id) as total_referrals,
            COUNT(DISTINCT CASE
              WHEN r.status = 'completed'
              THEN r.id
            END) as successful_referrals,
            COUNT(DISTINCT CASE
              WHEN rr.reward_type = 'free_post'
              AND rr.status = 'granted'
              THEN rr.id
            END) as referral_posts_granted,
            COUNT(DISTINCT CASE
              WHEN uc.source_type = 'referral'
              AND uc.status = 'used'
              THEN uc.id
            END) as referral_posts_used
          FROM referrals r
          LEFT JOIN referral_rewards rr ON r.invite_id = rr.earned_from_invite_id
          LEFT JOIN user_credits uc ON rr.user_id = uc.user_id
            AND uc.source_type = 'referral'
        ),

        -- Activity metrics
        activity_metrics AS (
          SELECT
            COUNT(DISTINCT uae.user_id) as active_users
          FROM user_activity_events uae
          WHERE uae.event_type = 'post_generated'
            AND uae.timestamp >= (SELECT start_date FROM date_range)
        )

        SELECT
          -- User metrics
          um.total_users,
          um.new_users,
          CASE
            WHEN um.prev_new_users > 0
            THEN ROUND(((um.new_users - um.prev_new_users) * 100.0 / um.prev_new_users)::numeric, 2)
            ELSE 0
          END as user_growth_rate,

          -- Subscription metrics
          sm.starter_count,
          sm.professional_count,
          (sm.starter_count + sm.professional_count) as total_paying_users,
          sm.subscription_mrr,

          -- Revenue metrics
          rm.pay_per_use_revenue,
          sm.subscription_mrr as subscription_revenue,
          (rm.pay_per_use_revenue + sm.subscription_mrr) as total_revenue,
          CASE
            WHEN rm.prev_revenue > 0
            THEN ROUND(((rm.pay_per_use_revenue - rm.prev_revenue) * 100.0 / rm.prev_revenue)::numeric, 2)
            ELSE 0
          END as revenue_growth_rate,

          -- Referral metrics
          rfm.total_referrals,
          rfm.successful_referrals,
          CASE
            WHEN rfm.total_referrals > 0
            THEN ROUND((rfm.successful_referrals * 100.0 / rfm.total_referrals)::numeric, 2)
            ELSE 0
          END as referral_conversion_rate,
          rfm.referral_posts_granted,
          rfm.referral_posts_used,

          -- Activity metrics
          am.active_users

        FROM user_metrics um, subscription_metrics sm,
             revenue_metrics rm, referral_metrics rfm, activity_metrics am
      `);

      console.log(`📊 Analytics: Query executed successfully, rows returned: ${result.rows.length}`);
      const metrics = result.rows[0];
      console.log(`📊 Analytics: Metrics data:`, JSON.stringify(metrics).substring(0, 200));
      return metrics;
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get comprehensive metrics`);
      console.error(`⚠️ Error details: ${error.message}`);
      console.error(`⚠️ Error stack: ${error.stack}`);
      return {
        total_users: 0,
        new_users: 0,
        user_growth_rate: 0,
        starter_count: 0,
        professional_count: 0,
        total_paying_users: 0,
        subscription_mrr: 0,
        pay_per_use_revenue: 0,
        subscription_revenue: 0,
        total_revenue: 0,
        revenue_growth_rate: 0,
        total_referrals: 0,
        successful_referrals: 0,
        referral_conversion_rate: 0,
        referral_posts_granted: 0,
        referral_posts_used: 0,
        active_users: 0
      };
    }
  }

  /**
   * Get user opportunities for actionable insights
   * @returns {Promise<Array>} User opportunities with recommended actions
   */
  async getUserOpportunities() {
    try {
      console.log(`📊 Analytics: Getting user opportunities`);

      const result = await db.query(`
        WITH user_activity AS (
          SELECT
            u.id as user_id,
            u.email,
            u.first_name || ' ' || u.last_name as full_name,
            s.plan_name,
            s.status as subscription_status,

            -- Credit analysis
            COALESCE(SUM(CASE WHEN uc.status = 'active' THEN uc.quantity ELSE 0 END), 0) as available_credits,
            COALESCE(SUM(CASE WHEN uc.status = 'used' THEN uc.quantity ELSE 0 END), 0) as used_credits,

            -- Activity analysis
            COUNT(DISTINCT CASE
              WHEN uae.event_type = 'post_generated'
              AND uae.timestamp >= NOW() - INTERVAL '30 days'
              THEN uae.id
            END) as posts_last_30_days,

            MAX(uae.timestamp) as last_activity,

            -- Referral analysis
            r.referral_code,
            COUNT(DISTINCT ref.id) as referrals_sent,
            COUNT(DISTINCT CASE WHEN ref.status = 'completed' THEN ref.id END) as referrals_completed

          FROM users u
          LEFT JOIN subscriptions s ON u.id = s.user_id
          LEFT JOIN user_credits uc ON u.id = uc.user_id
          LEFT JOIN user_activity_events uae ON u.id = uae.user_id
          LEFT JOIN referrals r ON u.id = r.referrer_user_id
          LEFT JOIN referrals ref ON u.id = ref.referrer_user_id
          GROUP BY u.id, u.email, u.first_name, u.last_name, s.plan_name, s.status, r.referral_code
        ),

        opportunities AS (
          -- Opportunity 1: Out of credits
          SELECT
            user_id,
            email,
            full_name,
            plan_name,
            'out_of_credits' as opportunity_type,
            'User ran out of free posts and is likely ready to purchase' as opportunity_reason,
            CONCAT(
              'Reach out to ', full_name, ' (', email, ') - ',
              'They used all ', used_credits, ' free posts and haven''t upgraded yet. ',
              'Offer them a starter plan ($20/mo for 4 posts) or pay-per-use option.'
            ) as recommended_action
          FROM user_activity
          WHERE available_credits = 0 AND used_credits > 0
            AND (subscription_status IS NULL OR subscription_status = 'cancelled')

          UNION ALL

          -- Opportunity 2: Has referral code but never shared it
          SELECT
            user_id,
            email,
            full_name,
            plan_name,
            'unused_referral' as opportunity_type,
            'User has referral code but hasn''t shared it' as opportunity_reason,
            CONCAT(
              'Reach out to ', full_name, ' (', email, ') - ',
              'They have a referral code but haven''t sent any referrals. ',
              'Remind them they get 1 free post ($15 value) for each friend who signs up.'
            ) as recommended_action
          FROM user_activity
          WHERE referral_code IS NOT NULL
            AND referrals_sent = 0
            AND last_activity >= NOW() - INTERVAL '60 days'

          UNION ALL

          -- Opportunity 3: Active free users (good upgrade candidates)
          SELECT
            user_id,
            email,
            full_name,
            plan_name,
            'active_free_user' as opportunity_type,
            'High engagement but still on free plan' as opportunity_reason,
            CONCAT(
              'Reach out to ', full_name, ' (', email, ') - ',
              'They generated ', posts_last_30_days, ' posts in the last 30 days but are still on a free plan. ',
              'Strong upgrade candidate - offer Professional plan for unlimited posts.'
            ) as recommended_action
          FROM user_activity
          WHERE (plan_name = 'Free' OR plan_name IS NULL)
            AND posts_last_30_days >= 3

          UNION ALL

          -- Opportunity 4: Inactive paying users (churn risk)
          SELECT
            user_id,
            email,
            full_name,
            plan_name,
            'churn_risk' as opportunity_type,
            'Paying customer hasn''t been active recently' as opportunity_reason,
            CONCAT(
              'Reach out to ', full_name, ' (', email, ') - ',
              'They have a ', plan_name, ' subscription but haven''t generated posts in 30+ days. ',
              'Check in to see if they need help or are considering cancellation.'
            ) as recommended_action
          FROM user_activity
          WHERE plan_name IN ('Starter', 'Professional')
            AND subscription_status = 'active'
            AND (last_activity < NOW() - INTERVAL '30 days' OR last_activity IS NULL)

          UNION ALL

          -- Opportunity 5: Starter plan power users (upsell candidates)
          SELECT
            user_id,
            email,
            full_name,
            plan_name,
            'upsell_to_pro' as opportunity_type,
            'Starter plan user generating many posts' as opportunity_reason,
            CONCAT(
              'Reach out to ', full_name, ' (', email, ') - ',
              'They generated ', posts_last_30_days, ' posts on Starter plan (4 posts/mo included). ',
              'Great candidate for Professional plan upgrade (8 posts/mo for $50).'
            ) as recommended_action
          FROM user_activity
          WHERE plan_name = 'Starter'
            AND posts_last_30_days >= 4
        )

        SELECT * FROM opportunities
        ORDER BY
          CASE opportunity_type
            WHEN 'out_of_credits' THEN 1
            WHEN 'active_free_user' THEN 2
            WHEN 'upsell_to_pro' THEN 3
            WHEN 'churn_risk' THEN 4
            WHEN 'unused_referral' THEN 5
          END
        LIMIT 50
      `);

      return result.rows;
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get user opportunities - ${error.message}`);
      return [];
    }
  }

  /**
   * Get clicks over time for usage metrics
   * @param {String} startDate - Start date (ISO format)
   * @param {String} endDate - End date (ISO format)
   * @param {String} interval - Time interval ('hour' or 'day')
   * @returns {Promise<Array>} Time-series click data
   */
  async getClicksOverTime(startDate, endDate, interval = 'day') {
    try {
      console.log(`📊 Analytics: Getting clicks over time from ${startDate} to ${endDate} (interval: ${interval})`);

      const truncFunc = interval === 'hour' ? 'hour' : 'day';

      const result = await db.query(`
        SELECT
          DATE_TRUNC('${truncFunc}', timestamp) as period,
          COUNT(*) as click_count,
          COUNT(DISTINCT user_id) as unique_users,
          event_type
        FROM user_activity_events
        WHERE timestamp >= $1 AND timestamp <= $2
          AND event_type IN (
            'click', 'page_view', 'button_click', 'post_generated', 'payment_success',
            'signup_started', 'signup_completed', 'login_completed', 'logout',
            'tab_switched', 'topic_selected', 'export_initiated', 'funnel_progress',
            'analysis_started', 'analysis_completed', 'content_generated'
          )
        GROUP BY DATE_TRUNC('${truncFunc}', timestamp), event_type
        ORDER BY period ASC
      `, [startDate, endDate]);

      return result.rows;
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get clicks over time - ${error.message}`);
      return [];
    }
  }

  /**
   * Get actions over time for usage metrics
   * @param {String} startDate - Start date (ISO format)
   * @param {String} endDate - End date (ISO format)
   * @param {String} interval - Time interval ('hour' or 'day')
   * @returns {Promise<Array>} Time-series action data
   */
  async getActionsOverTime(startDate, endDate, interval = 'hour') {
    try {
      console.log(`📊 Analytics: Getting actions over time from ${startDate} to ${endDate} (interval: ${interval})`);

      const truncFunc = interval === 'hour' ? 'hour' : 'day';

      const result = await db.query(`
        SELECT
          DATE_TRUNC('${truncFunc}', timestamp) as period,
          event_type,
          COUNT(*) as action_count,
          COUNT(DISTINCT user_id) as unique_users
        FROM user_activity_events
        WHERE timestamp >= $1 AND timestamp <= $2
          AND event_type NOT IN ('page_view')
        GROUP BY DATE_TRUNC('${truncFunc}', timestamp), event_type
        ORDER BY period ASC, action_count DESC
      `, [startDate, endDate]);

      return result.rows;
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get actions over time - ${error.message}`);
      return [];
    }
  }

  /**
   * Get active users over time for usage metrics
   * @param {String} startDate - Start date (ISO format)
   * @param {String} endDate - End date (ISO format)
   * @param {String} interval - Time interval ('hour' or 'day')
   * @returns {Promise<Array>} Time-series active user data
   */
  async getActiveUsersOverTime(startDate, endDate, interval = 'day') {
    try {
      console.log(`📊 Analytics: Getting active users over time from ${startDate} to ${endDate} (interval: ${interval})`);

      const truncFunc = interval === 'hour' ? 'hour' : 'day';

      const result = await db.query(`
        SELECT
          DATE_TRUNC('${truncFunc}', uae.timestamp) as period,
          COUNT(DISTINCT uae.user_id) as active_users,
          COUNT(DISTINCT CASE
            WHEN s.status = 'active' AND s.stripe_subscription_id IS NOT NULL
            THEN uae.user_id
          END) as active_paying_users,
          COUNT(DISTINCT CASE
            WHEN s.status IS NULL OR s.stripe_subscription_id IS NULL
            THEN uae.user_id
          END) as active_free_users
        FROM user_activity_events uae
        LEFT JOIN subscriptions s ON uae.user_id = s.user_id
        WHERE uae.timestamp >= $1 AND uae.timestamp <= $2
        GROUP BY DATE_TRUNC('${truncFunc}', uae.timestamp)
        ORDER BY period ASC
      `, [startDate, endDate]);

      return result.rows;
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get active users over time - ${error.message}`);
      return [];
    }
  }

  /**
   * Get clicks by page/tab for usage metrics
   * @param {String} startDate - Start date (ISO format)
   * @param {String} endDate - End date (ISO format)
   * @returns {Promise<Array>} Page-level click data
   */
  async getClicksByPage(startDate, endDate) {
    try {
      console.log(`📊 Analytics: Getting clicks by page from ${startDate} to ${endDate}`);

      const result = await db.query(`
        SELECT
          page_url,
          COUNT(*) as click_count,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(DISTINCT session_id) as unique_sessions,
          DATE_TRUNC('day', timestamp) as date
        FROM user_activity_events
        WHERE timestamp >= $1 AND timestamp <= $2
          AND page_url IS NOT NULL
        GROUP BY page_url, DATE_TRUNC('day', timestamp)
        ORDER BY date DESC, click_count DESC
      `, [startDate, endDate]);

      return result.rows;
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get clicks by page - ${error.message}`);
      return [];
    }
  }

  /**
   * Get revenue over time for revenue section visualization
   * @param {String} startDate - Start date (ISO format)
   * @param {String} endDate - End date (ISO format)
   * @param {String} interval - Time interval ('day' or 'week' or 'month')
   * @returns {Promise<Array>} Time-series revenue data
   */
  async getRevenueOverTime(startDate, endDate, interval = 'day') {
    try {
      console.log(`📊 Analytics: Getting revenue over time from ${startDate} to ${endDate} (interval: ${interval})`);

      const truncFunc = interval === 'month' ? 'month' : interval === 'week' ? 'week' : 'day';

      const result = await db.query(`
        WITH pay_per_use_revenue AS (
          SELECT
            DATE_TRUNC('${truncFunc}', charged_at) as period,
            SUM(total_amount) as pay_per_use_revenue,
            COUNT(*) as transaction_count
          FROM pay_per_use_charges
          WHERE charged_at >= $1 AND charged_at <= $2
          GROUP BY DATE_TRUNC('${truncFunc}', charged_at)
        ),
        subscription_revenue AS (
          SELECT
            DATE_TRUNC('${truncFunc}', s.created_at) as period,
            COUNT(DISTINCT CASE WHEN s.plan_name = 'Starter' THEN s.id END) * 20 as starter_mrr,
            COUNT(DISTINCT CASE WHEN s.plan_name = 'Professional' THEN s.id END) * 50 as professional_mrr
          FROM subscriptions s
          WHERE s.status = 'active'
            AND s.created_at >= $1 AND s.created_at <= $2
          GROUP BY DATE_TRUNC('${truncFunc}', s.created_at)
        )
        SELECT
          COALESCE(ppu.period, sub.period) as period,
          COALESCE(ppu.pay_per_use_revenue, 0) as pay_per_use_revenue,
          COALESCE(ppu.transaction_count, 0) as transaction_count,
          COALESCE(sub.starter_mrr, 0) as starter_mrr,
          COALESCE(sub.professional_mrr, 0) as professional_mrr,
          COALESCE(ppu.pay_per_use_revenue, 0) + COALESCE(sub.starter_mrr, 0) + COALESCE(sub.professional_mrr, 0) as total_revenue
        FROM pay_per_use_revenue ppu
        FULL OUTER JOIN subscription_revenue sub ON ppu.period = sub.period
        ORDER BY period ASC
      `, [startDate, endDate]);

      return result.rows;
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get revenue over time - ${error.message}`);
      return [];
    }
  }

  async getLeadFunnelData(startDate, endDate) {
    try {
      console.log(`📈 Analytics: Getting lead funnel data from ${startDate} to ${endDate}`);

      const result = await db.query(`
        WITH lead_base AS (
          SELECT DISTINCT wl.id, wl.session_id, wl.created_at
          FROM website_leads wl
          WHERE DATE(wl.created_at) >= DATE($1)
            AND DATE(wl.created_at) <= DATE($2)
        ),
        conversion_steps AS (
          SELECT
            lb.id as lead_id,
            MAX(CASE WHEN ct.conversion_step = 'analysis_started' THEN 1 ELSE 0 END) as analysis_started,
            MAX(CASE WHEN ct.conversion_step = 'analysis_completed' THEN 1 ELSE 0 END) as analysis_completed,
            MAX(CASE WHEN ct.conversion_step = 'previews_viewed' THEN 1 ELSE 0 END) as previews_viewed,
            MAX(CASE WHEN ct.conversion_step = 'audience_selected' THEN 1 ELSE 0 END) as audience_selected,
            MAX(CASE WHEN ct.conversion_step = 'registration' THEN 1 ELSE 0 END) as registered,
            MAX(CASE WHEN ct.conversion_step = 'content_generated' THEN 1 ELSE 0 END) as content_generated,
            MAX(CASE WHEN ct.conversion_step = 'project_saved' THEN 1 ELSE 0 END) as project_saved,
            MAX(CASE WHEN ct.conversion_step = 'content_exported' THEN 1 ELSE 0 END) as content_exported,
            MAX(CASE WHEN ct.conversion_step = 'first_payment' THEN 1 ELSE 0 END) as first_payment
          FROM lead_base lb
          LEFT JOIN conversion_tracking ct ON lb.id = ct.website_lead_id
          GROUP BY lb.id
        )
        SELECT
          (SELECT COUNT(*) FROM lead_base) as total_leads,
          (SELECT SUM(analysis_started) FROM conversion_steps) as analysis_started,
          (SELECT SUM(analysis_completed) FROM conversion_steps) as analysis_completed,
          (SELECT SUM(previews_viewed) FROM conversion_steps) as previews_viewed,
          (SELECT SUM(audience_selected) FROM conversion_steps) as audience_selected,
          (SELECT SUM(registered) FROM conversion_steps) as registered,
          (SELECT SUM(content_generated) FROM conversion_steps) as content_generated,
          (SELECT SUM(project_saved) FROM conversion_steps) as project_saved,
          (SELECT SUM(content_exported) FROM conversion_steps) as content_exported,
          (SELECT SUM(first_payment) FROM conversion_steps) as first_payment
      `, [startDate, endDate]);

      const counts = result.rows[0] || {};

      // Build funnel steps array
      const steps = [
        {
          step: 'total_leads',
          name: 'Website Visitors',
          count: parseInt(counts.total_leads) || 0,
          conversion_rate: 100
        },
        {
          step: 'analysis_started',
          name: 'Started Analysis',
          count: parseInt(counts.analysis_started) || 0,
          conversion_rate: 0
        },
        {
          step: 'analysis_completed',
          name: 'Completed Analysis',
          count: parseInt(counts.analysis_completed) || 0,
          conversion_rate: 0
        },
        {
          step: 'previews_viewed',
          name: 'Viewed Audience Options',
          count: parseInt(counts.previews_viewed) || 0,
          conversion_rate: 0
        },
        {
          step: 'audience_selected',
          name: 'Selected Target Audience',
          count: parseInt(counts.audience_selected) || 0,
          conversion_rate: 0
        },
        {
          step: 'registered',
          name: 'Registered Account',
          count: parseInt(counts.registered) || 0,
          conversion_rate: 0
        },
        {
          step: 'content_generated',
          name: 'Generated Content',
          count: parseInt(counts.content_generated) || 0,
          conversion_rate: 0
        },
        {
          step: 'project_saved',
          name: 'Saved Project',
          count: parseInt(counts.project_saved) || 0,
          conversion_rate: 0
        },
        {
          step: 'content_exported',
          name: 'Exported Content',
          count: parseInt(counts.content_exported) || 0,
          conversion_rate: 0
        },
        {
          step: 'first_payment',
          name: 'First Payment',
          count: parseInt(counts.first_payment) || 0,
          conversion_rate: 0
        }
      ];

      // Calculate conversion rates (each step relative to previous step)
      for (let i = 1; i < steps.length; i++) {
        const prevCount = steps[i - 1].count;
        if (prevCount > 0) {
          steps[i].conversion_rate = (steps[i].count / prevCount) * 100;
        }
      }

      return {
        steps,
        conversions: counts
      };
    } catch (error) {
      console.error(`⚠️ Analytics: Failed to get lead funnel data - ${error.message}`);
      return {
        steps: [],
        conversions: {}
      };
    }
  }
}

// Create singleton instance
const analyticsService = new AnalyticsService();

export default analyticsService;
