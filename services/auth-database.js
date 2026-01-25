import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import db from './database.js';

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-development';
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN && process.env.JWT_EXPIRES_IN.trim()) || '7d';

// In-memory fallback storage for when database is not available
const fallbackUsers = new Map();

/**
 * Database-backed Authentication Service
 * Falls back to in-memory storage when database is unavailable
 */
class DatabaseAuthService {
  constructor() {
    this.useDatabaseStorage = process.env.USE_DATABASE === 'true';
    this.databaseAvailable = false;
    this.connectionChecked = false;
    
    // Don't test connection in constructor to avoid race conditions
    // Connection will be tested lazily on first use
  }

  async ensureDatabaseConnection() {
    const checkId = `auth_check_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    console.log(`🔍 [${checkId}] Auth service checking database connection...`);
    
    // Only check once per instance
    if (this.connectionChecked) {
      console.log(`🔍 [${checkId}] Using cached connection status: ${this.databaseAvailable ? 'available' : 'unavailable'}`);
      return this.databaseAvailable;
    }
    
    this.connectionChecked = true;
    
    try {
      console.log(`🔍 [${checkId}] Testing database connection for auth service...`);
      const connectionSuccess = await db.testConnection();
      
      if (connectionSuccess) {
        this.databaseAvailable = true;
        console.log(`✅ [${checkId}] Auth service using database storage (connection verified)`);
      } else {
        this.databaseAvailable = false;
        console.error(`❌ [${checkId}] Database connection test returned false`);
      }
    } catch (error) {
      this.databaseAvailable = false;
      console.error(`❌ [${checkId}] Database connection test threw error:`, {
        message: error.message,
        code: error.code,
        stack: error.stack?.split('\n')[0]
      });
    }
    
    if (!this.databaseAvailable) {
      console.warn(`⚠️  [${checkId}] Auth service falling back to in-memory storage`);
      console.warn(`⚠️  [${checkId}] WARNING: Session adoption will NOT work with memory storage`);
      console.warn(`⚠️  [${checkId}] Users will exist in memory but not in database`);
      console.warn(`⚠️  [${checkId}] This will cause session adoption foreign key violations`);
    }
    
    return this.databaseAvailable;
  }

  async testDatabaseConnection() {
    // Reset connection check to force re-test
    this.connectionChecked = false;
    return await this.ensureDatabaseConnection();
  }

  /**
   * Register a new user
   */
  async register(userData) {
    const { email, password, firstName, lastName, organizationName, websiteUrl } = userData;
    const registrationId = `reg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    
    console.log(`🔍 [${registrationId}] Starting user registration process:`, {
      email: email,
      hasPassword: !!password,
      firstName: firstName,
      lastName: lastName,
      organizationName: organizationName,
      hasWebsiteUrl: !!websiteUrl
    });

    // First check if database is available
    const dbAvailable = await this.ensureDatabaseConnection();
    console.log(`🔍 [${registrationId}] Database availability check: ${dbAvailable ? 'available' : 'unavailable'}`);

    try {
      if (dbAvailable) {
        // Try database registration first for session adoption to work
        console.log(`🔄 [${registrationId}] Attempting database registration...`);
        const result = await this.registerToDatabase(userData);
        console.log(`✅ [${registrationId}] Database registration successful for user: ${result.user.id}`);
        return result;
      } else {
        console.warn(`⚠️  [${registrationId}] Skipping database registration - connection unavailable`);
        throw new Error('Database connection unavailable - cannot register to database');
      }
    } catch (databaseError) {
      console.error(`❌ [${registrationId}] Database registration failed:`, {
        message: databaseError.message,
        code: databaseError.code,
        stack: databaseError.stack?.split('\n')[0]
      });
      
      // For session adoption to work, we need database registration
      // But don't break the app - use memory fallback and log the issue
      console.warn(`🚨 [${registrationId}] CRITICAL: Using memory fallback - session adoption will NOT work`);
      console.warn(`🚨 [${registrationId}] Issue: User will exist in memory but not database`);
      console.warn(`🚨 [${registrationId}] Impact: Session data will not persist after registration`);
      console.warn(`🚨 [${registrationId}] Impact: User will be unable to access their audiences after login`);
      
      // Track this critical failure for monitoring
      const fallbackResult = await this.registerToMemory(userData);
      console.error(`🔥 [${registrationId}] PRODUCTION ISSUE: Memory fallback used for user ${fallbackResult.user.id}`);
      console.error(`🔥 [${registrationId}] This user's session data CANNOT be adopted without manual intervention`);
      
      return fallbackResult;
    }
  }

  /**
   * Register user to database with proper organization relationships
   */
  async registerToDatabase(userData) {
    const { email, password, firstName, lastName, organizationName, websiteUrl } = userData;
    const dbRegId = `db_reg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    
    console.log(`🔍 [${dbRegId}] Starting database registration for email: ${email}`);

    try {
      // Check if user already exists
      console.log(`🔍 [${dbRegId}] Checking for existing user with email: ${email}`);
      const existingUser = await db.query(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (existingUser.rows.length > 0) {
        console.warn(`⚠️  [${dbRegId}] User already exists with email: ${email}`);
        throw new Error('User already exists with this email');
      }
      
      console.log(`✅ [${dbRegId}] Email ${email} is available for registration`);
    } catch (queryError) {
      console.error(`❌ [${dbRegId}] Failed to check existing user:`, {
        message: queryError.message,
        code: queryError.code,
        query: 'SELECT id FROM users WHERE email = $1'
      });
      throw new Error(`Database query failed during user check: ${queryError.message}`);
    }

    // Hash password
    const saltRounds = 12; // Higher security for production
    console.log(`🔍 [${dbRegId}] Hashing password with ${saltRounds} salt rounds...`);
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Generate referral code
    const referralCode = this.generateReferralCode(firstName, lastName);
    const userId = uuidv4();
    
    console.log(`🔍 [${dbRegId}] Generated user data:`, {
      userId: userId,
      email: email.toLowerCase(),
      firstName: firstName,
      lastName: lastName,
      referralCode: referralCode,
      hasHashedPassword: !!hashedPassword
    });

    let user, organization, userResult, orgResult;
    
    try {
      // Insert user into database (without organization_name - use proper JOINs)
      console.log(`🔍 [${dbRegId}] Inserting user record into database...`);
      userResult = await db.query(`
        INSERT INTO users (
          id, email, first_name, last_name,
          password_hash, referral_code, plan_tier, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        RETURNING id, email, first_name, last_name, 
                 referral_code, plan_tier, status, created_at
      `, [
        userId,
        email.toLowerCase(),
        firstName,
        lastName,
        hashedPassword,
        referralCode,
        'free', // Default plan
        'active' // Default status
      ]);

      user = userResult.rows[0];
      console.log(`✅ [${dbRegId}] User record created successfully:`, {
        userId: user.id,
        email: user.email,
        createdAt: user.created_at
      });
    } catch (userInsertError) {
      console.error(`❌ [${dbRegId}] Failed to insert user record:`, {
        message: userInsertError.message,
        code: userInsertError.code,
        constraint: userInsertError.constraint,
        detail: userInsertError.detail,
        table: userInsertError.table
      });
      throw new Error(`User creation failed: ${userInsertError.message}`);
    }

    try {
      // Create default organization for user
      const organizationSlug = organizationName.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      
      console.log(`🔍 [${dbRegId}] Creating organization for user ${user.id}:`, {
        organizationName: organizationName,
        slug: organizationSlug + '-' + userId.substring(0, 8),
        ownerUserId: userId,
        hasWebsiteUrl: !!websiteUrl
      });
      
      orgResult = await db.query(`
        INSERT INTO organizations (
          id, name, slug, owner_user_id, website_url, plan_tier, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        RETURNING id, name, slug, website_url
      `, [
        uuidv4(),
        organizationName,
        organizationSlug + '-' + userId.substring(0, 8), // Ensure unique slug
        userId,
        websiteUrl || null,
        'free',
        'active'
      ]);

      organization = orgResult.rows[0];
      console.log(`✅ [${dbRegId}] Organization created successfully:`, {
        organizationId: organization.id,
        name: organization.name,
        slug: organization.slug
      });
    } catch (orgInsertError) {
      console.error(`❌ [${dbRegId}] Failed to create organization:`, {
        message: orgInsertError.message,
        code: orgInsertError.code,
        constraint: orgInsertError.constraint,
        detail: orgInsertError.detail
      });
      // Organization creation failure shouldn't block user registration
      console.warn(`⚠️  [${dbRegId}] User created but organization creation failed - continuing with default org`);
      throw new Error(`Organization creation failed: ${orgInsertError.message}`);
    }

    // Add user as owner to organization_members
    await db.query(`
      INSERT INTO organization_members (
        id, organization_id, user_id, role, status, joined_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    `, [
      uuidv4(),
      organization.id,
      userId,
      'owner',
      'active'
    ]);

    // Create free plan subscription for new user
    const subscriptionResult = await db.query(`
      INSERT INTO subscriptions (
        user_id,
        organization_id,
        plan_name,
        status,
        current_period_start,
        current_period_end,
        created_at
      ) VALUES (
        $1,
        $2,
        'Free',
        'active',
        NOW(),
        NOW() + INTERVAL '1 month',
        NOW()
      )
      RETURNING id
    `, [user.id, organization.id]);

    const subscriptionId = subscriptionResult.rows[0].id;

    // Create 1 free credit in user_credits table
    await db.query(`
      INSERT INTO user_credits (
        user_id,
        source_type,
        source_id,
        source_description,
        quantity,
        value_usd,
        status,
        priority,
        created_at
      ) VALUES (
        $1,
        'subscription',
        $2,
        'Free Plan - Welcome Post',
        1,
        0.00,
        'active',
        25,
        NOW()
      )
    `, [user.id, subscriptionId]);

    console.log(`✅ [${dbRegId}] Created 1 free credit for new user ${user.id}`);

    // Initialize usage tracking for the current month
    const currentMonth = new Date();
    const periodStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const periodEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

    await db.query(`
      INSERT INTO user_usage_tracking (
        user_id,
        feature_type,
        period_start,
        period_end,
        usage_count,
        limit_count,
        created_at
      ) VALUES (
        $1,
        'generation',
        $2,
        $3,
        0,
        1,
        NOW()
      )
    `, [user.id, periodStart, periodEnd]);

    // Log registration activity
    await this.logUserActivity(user.id, 'user_registered', {
      email: user.email,
      plan_tier: user.plan_tier,
      organization_id: organization.id
    });

    // Track registration event for analytics funnel
    try {
      await db.query(`
        INSERT INTO user_activity_events (
          id, user_id, event_type, conversion_funnel_step,
          event_data, timestamp
        ) VALUES (
          $1, $2, 'user_registered', 'signed_up',
          $3, NOW()
        )
      `, [
        uuidv4(),
        user.id,
        JSON.stringify({ email: user.email, plan_tier: user.plan_tier, organization_id: organization.id })
      ]);
      console.log(`📊 [${dbRegId}] Analytics event tracked: user_registered (signed_up)`);
    } catch (eventError) {
      console.error(`⚠️ [${dbRegId}] Failed to track analytics event:`, eventError.message);
      // Don't throw - analytics failure shouldn't block registration
    }

    // Link website lead if user came from website analysis
    await this.linkWebsiteLeadToUser(user.id, organization.id, websiteUrl);

    // Fetch available credits for the user
    const creditsResult = await db.query(`
      SELECT COUNT(*) as available_credits
      FROM user_credits
      WHERE user_id = $1
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > NOW())
    `, [user.id]);

    const availableCredits = parseInt(creditsResult.rows[0]?.available_credits || 0);
    console.log(`✅ [${dbRegId}] User has ${availableCredits} available credits`);

    // Generate tokens
    const tokens = this.generateTokens(user);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        organizationName: organization.name,
        organizationId: organization.id,
        organizationRole: 'owner',
        referralCode: user.referral_code,
        planTier: user.plan_tier,
        postsRemaining: availableCredits,
        createdAt: user.created_at
      },
      ...tokens
    };
  }

  /**
   * Register user to memory (fallback)
   */
  async registerToMemory(userData) {
    const { email, password, firstName, lastName, organizationName, websiteUrl } = userData;

    // Check if user already exists
    const existingUser = Array.from(fallbackUsers.values()).find(user => user.email === email);
    if (existingUser) {
      throw new Error('User already exists with this email');
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const user = {
      id: uuidv4(),
      email: email.toLowerCase(),
      firstName,
      lastName,
      organizationName,
      referralCode: this.generateReferralCode(firstName, lastName),
      planTier: 'free',
      hashedPassword,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Store user
    fallbackUsers.set(user.id, user);

    // Generate tokens
    const tokens = this.generateTokens(user);

    // Return user without password
    const { hashedPassword: _, ...userWithoutPassword } = user;
    return {
      user: userWithoutPassword,
      ...tokens
    };
  }

  /**
   * Login user
   */
  async login(email, password) {
    try {
      // Ensure database connection is checked
      await this.ensureDatabaseConnection();
      
      // Use database if available
      if (this.databaseAvailable && this.useDatabaseStorage) {
        return await this.loginFromDatabase(email, password);
      } else {
        return await this.loginFromMemory(email, password);
      }
    } catch (error) {
      // If database fails, try memory as fallback
      if (this.databaseAvailable && error.message.includes('database')) {
        console.warn('Database login failed, using memory fallback:', error.message);
        return await this.loginFromMemory(email, password);
      }
      throw error;
    }
  }

  /**
   * Login from database with proper organization JOINs
   */
  async loginFromDatabase(email, password) {
    // Find user by email with organization, billing, and role data
    const userResult = await db.query(`
      SELECT u.*, 
             o.id as organization_id, o.name as organization_name, o.slug as organization_slug, o.website_url as organization_website,
             om.role as organization_role,
             ba.current_plan, ba.billing_status, ba.usage_limit, ba.current_usage,
             ur.name as role_name, ur.permissions, ur.hierarchy_level
      FROM users u
      LEFT JOIN organization_members om ON u.id = om.user_id
      LEFT JOIN organizations o ON om.organization_id = o.id
      LEFT JOIN billing_accounts ba ON u.id = ba.user_id
      LEFT JOIN user_roles ur ON u.role = ur.name
      WHERE u.email = $1 AND u.status = 'active'
      ORDER BY om.created_at ASC
      LIMIT 1
    `, [email.toLowerCase()]);

    if (userResult.rows.length === 0) {
      throw new Error('Invalid email or password');
    }

    const user = userResult.rows[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      throw new Error('Invalid email or password');
    }

    // Auto-promote super admin emails from environment variable
    const superAdminEmails = process.env.SUPER_ADMIN_EMAILS?.split(',').map(email => email.trim().toLowerCase()) || [];
    const userEmail = user.email.toLowerCase();
    const shouldBeSuperAdmin = superAdminEmails.includes(userEmail);
    
    if (shouldBeSuperAdmin && user.role !== 'super_admin') {
      console.log(`🛡️ Auto-promoting ${user.email} to super_admin role`);
      
      // Update user role in database
      await db.query('UPDATE users SET role = $1 WHERE id = $2', ['super_admin', user.id]);
      
      // Update the user object for this session
      user.role = 'super_admin';
      user.role_name = 'super_admin';
      
      // Get updated permissions from user_roles table
      const roleResult = await db.query('SELECT permissions, hierarchy_level FROM user_roles WHERE name = $1', ['super_admin']);
      if (roleResult.rows.length > 0) {
        user.permissions = roleResult.rows[0].permissions;
        user.hierarchy_level = roleResult.rows[0].hierarchy_level;
      }
      
      // Log the promotion for security audit
      await this.logUserActivity(user.id, 'role_promotion', {
        previous_role: 'user',
        new_role: 'super_admin',
        promoted_by: 'system',
        reason: 'super_admin_email_list'
      });
    }

    // Update last login
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    // Create session record
    const sessionId = uuidv4();
    await db.query(`
      INSERT INTO user_sessions (user_id, session_id, started_at, ip_address)
      VALUES ($1, $2, NOW(), $3)
    `, [user.id, sessionId, '127.0.0.1']); // IP will be set by middleware

    // Log login activity
    await this.logUserActivity(user.id, 'user_login', {
      session_id: sessionId
    });

    // Track login event for analytics funnel
    try {
      // Check if this is the first login
      const isFirstLogin = await db.query(`
        SELECT COUNT(*) as login_count
        FROM user_activity_events
        WHERE user_id = $1 AND event_type = 'user_login'
      `, [user.id]);

      const loginCount = parseInt(isFirstLogin.rows[0]?.login_count || 0);
      const funnelStep = loginCount === 0 ? 'first_login' : null;

      await db.query(`
        INSERT INTO user_activity_events (
          id, user_id, session_id, event_type,
          conversion_funnel_step, event_data, timestamp
        ) VALUES (
          $1, $2, $3, 'user_login',
          $4, $5, NOW()
        )
      `, [
        uuidv4(),
        user.id,
        sessionId,
        funnelStep,
        JSON.stringify({ email: user.email, session_id: sessionId })
      ]);
      console.log(`📊 Analytics event tracked: user_login${funnelStep ? ' (first_login)' : ''}`);
    } catch (eventError) {
      console.error(`⚠️ Failed to track analytics event:`, eventError.message);
      // Don't throw - analytics failure shouldn't block login
    }

    // Generate tokens with all user data including permissions
    const userForToken = {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      organization_name: user.organization_name,
      plan_tier: user.current_plan || user.plan_tier,
      role: user.role_name || user.role,
      permissions: user.permissions || [],
      hierarchy_level: user.hierarchy_level || 10
    };
    
    
    const tokens = this.generateTokens(userForToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        organizationName: user.organization_name,
        organizationId: user.organization_id,
        organizationRole: user.organization_role,
        organizationSlug: user.organization_slug,
        organizationWebsite: user.organization_website,
        referralCode: user.referral_code,
        planTier: user.current_plan || user.plan_tier,
        billingStatus: user.billing_status,
        usageLimit: user.usage_limit,
        currentUsage: user.current_usage,
        role: user.role_name || user.role || 'user',
        permissions: user.permissions || [],
        hierarchyLevel: user.hierarchy_level || 10
      },
      sessionId,
      ...tokens
    };
  }

  /**
   * Login from memory (fallback)
   */
  async loginFromMemory(email, password) {
    // Find user by email
    const user = Array.from(fallbackUsers.values()).find(u => u.email === email.toLowerCase());
    if (!user) {
      throw new Error('Invalid email or password');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.hashedPassword);
    if (!isPasswordValid) {
      throw new Error('Invalid email or password');
    }

    // Update last login
    user.lastLoginAt = new Date().toISOString();
    user.updatedAt = new Date().toISOString();

    // Generate tokens
    const tokens = this.generateTokens(user);

    // Return user without password
    const { hashedPassword: _, ...userWithoutPassword } = user;
    return {
      user: userWithoutPassword,
      ...tokens
    };
  }

  /**
   * Get user by ID with organization data
   */
  async getUserById(userId) {
    try {
      // Ensure database connection is checked
      await this.ensureDatabaseConnection();
      
      if (this.databaseAvailable && this.useDatabaseStorage) {
        const userResult = await db.query(`
          SELECT u.*, 
                 o.id as organization_id, o.name as organization_name, o.slug as organization_slug, o.website_url as organization_website,
                 om.role as organization_role,
                 ba.current_plan, ba.billing_status, ba.usage_limit, ba.current_usage,
                 ur.name as role_name, ur.permissions, ur.hierarchy_level
          FROM users u
          LEFT JOIN organization_members om ON u.id = om.user_id
          LEFT JOIN organizations o ON om.organization_id = o.id
          LEFT JOIN billing_accounts ba ON u.id = ba.user_id
          LEFT JOIN user_roles ur ON u.role = ur.name
          WHERE u.id = $1 AND u.status = 'active'
          ORDER BY om.created_at ASC
          LIMIT 1
        `, [userId]);

        if (userResult.rows.length === 0) {
          throw new Error('User not found');
        }

        const user = userResult.rows[0];
        return {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          organizationName: user.organization_name,
          organizationId: user.organization_id,
          organizationRole: user.organization_role,
          organizationSlug: user.organization_slug,
          organizationWebsite: user.organization_website,
          referralCode: user.referral_code,
          planTier: user.current_plan || user.plan_tier,
          billingStatus: user.billing_status,
          usageLimit: user.usage_limit,
          currentUsage: user.current_usage,
          lastLoginAt: user.last_login_at,
          role: user.role_name || user.role || 'user',
          permissions: user.permissions || [],
          hierarchyLevel: user.hierarchy_level || 10
        };
      } else {
        const user = fallbackUsers.get(userId);
        if (!user) {
          throw new Error('User not found');
        }
        const { hashedPassword: _, ...userWithoutPassword } = user;
        return userWithoutPassword;
      }
    } catch (error) {
      if (this.databaseAvailable && error.message.includes('database')) {
        const user = fallbackUsers.get(userId);
        if (!user) {
          throw new Error('User not found');
        }
        const { hashedPassword: _, ...userWithoutPassword } = user;
        return userWithoutPassword;
      }
      throw error;
    }
  }

  /**
   * Generate JWT tokens
   */
  generateTokens(user) {
    const payload = {
      userId: user.id,
      email: user.email,
      firstName: user.first_name || user.firstName,
      lastName: user.last_name || user.lastName,
      organizationName: user.organization_name || user.organizationName,
      planTier: user.current_plan || user.plan_tier || user.planTier || 'free',
      role: user.role_name || user.role || 'user',
      permissions: user.permissions || [],
      hierarchyLevel: user.hierarchy_level || 10
    };

    const accessToken = jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
      issuer: 'autoblog-api'
    });

    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET || JWT_SECRET,
      {
        expiresIn: '30d',
        issuer: 'autoblog-api'
      }
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: JWT_EXPIRES_IN
    };
  }

  /**
   * Generate referral code
   */
  generateReferralCode(firstName, lastName) {
    const prefix = 'AMB';
    const namePart = (firstName.substring(0, 2) + lastName.substring(0, 2)).toUpperCase();
    const randomPart = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `${prefix}${namePart}${randomPart}`;
  }

  /**
   * Log user activity
   */
  async logUserActivity(userId, eventType, eventData = {}) {
    if (!this.databaseAvailable) return;

    try {
      await db.query(`
        INSERT INTO user_activity_events (user_id, event_type, event_data, timestamp)
        VALUES ($1, $2, $3, NOW())
      `, [userId, eventType, JSON.stringify(eventData)]);
    } catch (error) {
      console.warn('Failed to log user activity:', error.message);
    }
  }

  /**
   * Verify JWT token
   */
  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return decoded;
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Refresh tokens
   */
  async refreshTokens(refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || JWT_SECRET);
      const user = await this.getUserById(decoded.userId);

      if (!user) {
        throw new Error('User not found');
      }

      return this.generateTokens(user);
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  }

  /**
   * Middleware to protect routes
   */
  authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Access denied',
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    try {
      const decoded = this.verifyToken(token);
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).json({
        error: 'Access denied',
        message: error.message
      });
    }
  }

  /**
   * Optional auth middleware
   */
  optionalAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = this.verifyToken(token);
        req.user = decoded;
        console.log('✅ Token verified successfully for optional auth:', {
          userId: decoded.userId,
          endpoint: req.path
        });
      } catch (error) {
        // Log error for debugging JWT issues
        console.log('⚠️ Token verification failed in optionalAuth:', {
          error: error.message,
          endpoint: req.path
        });
      }
    }

    next();
  }

  /**
   * Get all users (admin only)
   */
  async getAllUsers(options = {}) {
    const {
      limit = 100,
      offset = 0,
      search = '',
      role = 'all',
      status = 'active',
      sortBy = 'created_at',
      order = 'DESC'
    } = options;
    try {
      // Ensure database connection is checked
      await this.ensureDatabaseConnection();
      
      if (this.databaseAvailable && this.useDatabaseStorage) {
        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;

        // Apply search filter
        if (search && search.length > 0) {
          whereConditions.push(`(
            LOWER(u.email) LIKE $${paramIndex} OR 
            LOWER(u.first_name) LIKE $${paramIndex} OR 
            LOWER(u.last_name) LIKE $${paramIndex}
          )`);
          queryParams.push(`%${search.toLowerCase()}%`);
          paramIndex++;
        }

        // Apply role filter
        if (role && role !== 'all') {
          whereConditions.push(`u.role = $${paramIndex}`);
          queryParams.push(role);
          paramIndex++;
        }

        // Apply status filter
        if (status && status !== 'all') {
          whereConditions.push(`u.status = $${paramIndex}`);
          queryParams.push(status);
          paramIndex++;
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
        
        // Validate sortBy to prevent SQL injection
        const allowedSortFields = ['created_at', 'updated_at', 'email', 'first_name', 'last_name', 'last_login_at', 'role'];
        const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
        const safeOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const usersResult = await db.query(`
          SELECT u.id, u.email, u.first_name, u.last_name, u.role,
                 u.referral_code, u.plan_tier, u.status, u.created_at, u.last_login_at,
                 o.id as organization_id, o.name as organization_name,
                 ba.current_plan, ba.billing_status, ba.usage_limit, ba.current_usage,
                 ur.permissions, ur.hierarchy_level
          FROM users u
          LEFT JOIN organization_members om ON u.id = om.user_id
          LEFT JOIN organizations o ON om.organization_id = o.id
          LEFT JOIN billing_accounts ba ON u.id = ba.user_id
          LEFT JOIN user_roles ur ON u.role = ur.name
          ${whereClause}
          ORDER BY u.${safeSortBy} ${safeOrder}
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `, [...queryParams, limit, offset]);

        // Get total count for pagination
        const countResult = await db.query(`
          SELECT COUNT(*) as total
          FROM users u
          ${whereClause}
        `, queryParams);

        const total = parseInt(countResult.rows[0]?.total || 0);
        const users = usersResult.rows.map(user => ({
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          organizationName: user.organization_name,
          organizationId: user.organization_id,
          referralCode: user.referral_code,
          planTier: user.current_plan || user.plan_tier,
          status: user.status,
          role: user.role,
          permissions: user.permissions || [],
          hierarchyLevel: user.hierarchy_level || 10,
          billingStatus: user.billing_status,
          usageLimit: user.usage_limit,
          currentUsage: user.current_usage,
          createdAt: user.created_at,
          lastLoginAt: user.last_login_at
        }));

        return {
          users,
          total,
          limit,
          offset,
          hasMore: offset + limit < total
        };
      } else {
        const allUsers = Array.from(fallbackUsers.values()).map(user => {
          const { hashedPassword: _, ...userWithoutPassword } = user;
          return userWithoutPassword;
        });

        return {
          users: allUsers.slice(offset, offset + limit),
          total: allUsers.length,
          limit,
          offset,
          hasMore: offset + limit < allUsers.length
        };
      }
    } catch (error) {
      console.error('Failed to get all users:', error.message);
      return {
        users: [],
        total: 0,
        limit,
        offset,
        hasMore: false
      };
    }
  }

  /**
   * Check if database is being used
   */
  isDatabaseMode() {
    return this.databaseAvailable && this.useDatabaseStorage;
  }

  /**
   * Get storage status
   */
  getStorageStatus() {
    return {
      useDatabaseStorage: this.useDatabaseStorage,
      databaseAvailable: this.databaseAvailable,
      mode: this.isDatabaseMode() ? 'database' : 'memory',
      userCount: this.isDatabaseMode() ? 'N/A' : fallbackUsers.size
    };
  }

  /**
   * Update user profile
   */
  async updateUserProfile(userId, updates) {
    try {
      await this.ensureDatabaseConnection();
      
      if (this.databaseAvailable && this.useDatabaseStorage) {
        const setClause = [];
        const values = [];
        let paramIndex = 1;

        // Build dynamic update query - only for allowed profile fields
        const allowedFields = ['firstName', 'lastName', 'email'];
        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined && allowedFields.includes(key)) {
            const dbField = key === 'firstName' ? 'first_name' : key === 'lastName' ? 'last_name' : key.toLowerCase();
            setClause.push(`${dbField} = $${paramIndex}`);
            values.push(value);
            paramIndex++;
          }
        }

        if (setClause.length === 0) {
          throw new Error('No valid fields to update');
        }

        const updateQuery = `
          UPDATE users 
          SET ${setClause.join(', ')}, updated_at = NOW()
          WHERE id = $${paramIndex}
          RETURNING id, email, first_name as "firstName", last_name as "lastName", 
                   role, created_at as "createdAt"
        `;

        values.push(userId);
        const result = await db.query(updateQuery, values);

        if (result.rows.length === 0) {
          throw new Error('User not found');
        }

        return result.rows[0];
      } else {
        // Memory storage update
        const user = fallbackUsers.get(userId);
        if (!user) {
          throw new Error('User not found');
        }

        Object.assign(user, updates);
        const { hashedPassword: _, ...userWithoutPassword } = user;
        return userWithoutPassword;
      }
    } catch (error) {
      throw new Error(`Failed to update profile: ${error.message}`);
    }
  }

  /**
   * Link website lead to user when they convert from anonymous website analysis
   */
  async linkWebsiteLeadToUser(userId, organizationId, websiteUrl) {
    if (!this.databaseAvailable || !websiteUrl) return;

    try {
      // Find matching website lead based on URL and recent creation
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

        // Track conversion step
        await db.query(`
          INSERT INTO conversion_tracking (
            website_lead_id, conversion_step, step_completed_at, 
            step_data, total_time_to_conversion
          ) VALUES ($1, 'registration', NOW(), $2, 
            EXTRACT(EPOCH FROM (NOW() - (SELECT created_at FROM website_leads WHERE id = $1))) / 60
          )
        `, [leadId, JSON.stringify({ userId, organizationId })]);

        console.log(`🔗 Linked website lead ${leadId} to user ${userId}`);
      }
    } catch (error) {
      console.warn('Failed to link website lead:', error.message);
    }
  }

  /**
   * Change user password
   */
  async changePassword(userId, oldPassword, newPassword) {
    try {
      await this.ensureDatabaseConnection();
      
      if (this.databaseAvailable && this.useDatabaseStorage) {
        // Get current password hash from database
        const userResult = await db.query(
          'SELECT password_hash FROM users WHERE id = $1',
          [userId]
        );

        if (userResult.rows.length === 0) {
          throw new Error('User not found');
        }

        const currentPasswordHash = userResult.rows[0].password_hash;

        // Verify old password
        const isOldPasswordValid = await bcrypt.compare(oldPassword, currentPasswordHash);
        if (!isOldPasswordValid) {
          throw new Error('Current password is incorrect');
        }

        // Hash new password
        const saltRounds = 12;
        const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

        // Update password in database
        await db.query(
          'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
          [newPasswordHash, userId]
        );

        // Log the password change
        await this.logUserActivity(userId, 'password_changed', {
          timestamp: new Date().toISOString()
        });

        return { success: true };
      } else {
        // Memory storage password change
        const user = fallbackUsers.get(userId);
        if (!user) {
          throw new Error('User not found');
        }

        // Verify old password
        const isOldPasswordValid = await bcrypt.compare(oldPassword, user.hashedPassword);
        if (!isOldPasswordValid) {
          throw new Error('Current password is incorrect');
        }

        // Hash and store new password
        const saltRounds = 12;
        user.hashedPassword = await bcrypt.hash(newPassword, saltRounds);

        return { success: true };
      }
    } catch (error) {
      throw new Error(`Failed to change password: ${error.message}`);
    }
  }
}

// Export both the class and a singleton instance
export { DatabaseAuthService };
export default DatabaseAuthService;