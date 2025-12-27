import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import db from './database.js';

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-development';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

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
    
    // Test database availability on startup
    this.testDatabaseConnection();
  }

  async testDatabaseConnection() {
    try {
      await db.testConnection();
      this.databaseAvailable = true;
      console.log('✅ Auth service using database storage');
    } catch (error) {
      this.databaseAvailable = false;
      console.log('⚠️  Auth service falling back to in-memory storage');
      console.log('   Database will be used once connection is established');
    }
  }

  /**
   * Register a new user
   */
  async register(userData) {
    const { email, password, firstName, lastName, organizationName } = userData;

    try {
      // Use database if available
      if (this.databaseAvailable && this.useDatabaseStorage) {
        return await this.registerToDatabase(userData);
      } else {
        return await this.registerToMemory(userData);
      }
    } catch (error) {
      // If database fails, try memory as fallback
      if (this.databaseAvailable && error.message.includes('database')) {
        console.warn('Database registration failed, using memory fallback:', error.message);
        return await this.registerToMemory(userData);
      }
      throw error;
    }
  }

  /**
   * Register user to database with proper organization relationships
   */
  async registerToDatabase(userData) {
    const { email, password, firstName, lastName, organizationName } = userData;

    // Check if user already exists
    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      throw new Error('User already exists with this email');
    }

    // Hash password
    const saltRounds = 12; // Higher security for production
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Generate referral code
    const referralCode = this.generateReferralCode(firstName, lastName);
    const userId = uuidv4();

    // Insert user into database (without organization_name - use proper JOINs)
    const userResult = await db.query(`
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

    const user = userResult.rows[0];

    // Create default organization for user
    const organizationSlug = organizationName.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    
    const orgResult = await db.query(`
      INSERT INTO organizations (
        id, name, slug, owner_user_id, plan_tier, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING id, name, slug
    `, [
      uuidv4(),
      organizationName,
      organizationSlug + '-' + userId.substring(0, 8), // Ensure unique slug
      userId,
      'free',
      'active'
    ]);

    const organization = orgResult.rows[0];

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

    // Create billing account
    await db.query(`
      INSERT INTO billing_accounts (
        user_id, current_plan, billing_status, usage_limit, current_usage, created_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
    `, [user.id, 'free', 'active', 3, 0]); // 3 free blog posts

    // Log registration activity
    await this.logUserActivity(user.id, 'user_registered', {
      email: user.email,
      plan_tier: user.plan_tier,
      organization_id: organization.id
    });

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
        createdAt: user.created_at
      },
      ...tokens
    };
  }

  /**
   * Register user to memory (fallback)
   */
  async registerToMemory(userData) {
    const { email, password, firstName, lastName, organizationName } = userData;

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
             o.id as organization_id, o.name as organization_name, o.slug as organization_slug,
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

    // Generate tokens
    const tokens = this.generateTokens(user);

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
      if (this.databaseAvailable && this.useDatabaseStorage) {
        const userResult = await db.query(`
          SELECT u.*, 
                 o.id as organization_id, o.name as organization_name, o.slug as organization_slug,
                 om.role as organization_role,
                 ba.current_plan, ba.billing_status, ba.usage_limit, ba.current_usage
          FROM users u
          LEFT JOIN organization_members om ON u.id = om.user_id
          LEFT JOIN organizations o ON om.organization_id = o.id
          LEFT JOIN billing_accounts ba ON u.id = ba.user_id
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
          referralCode: user.referral_code,
          planTier: user.current_plan || user.plan_tier,
          billingStatus: user.billing_status,
          usageLimit: user.usage_limit,
          currentUsage: user.current_usage,
          lastLoginAt: user.last_login_at
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
      planTier: user.current_plan || user.plan_tier || user.planTier || 'free'
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
      } catch (error) {
        // Ignore invalid tokens for optional auth
      }
    }

    next();
  }

  /**
   * Get all users (admin only)
   */
  async getAllUsers() {
    try {
      if (this.databaseAvailable && this.useDatabaseStorage) {
        const usersResult = await db.query(`
          SELECT u.id, u.email, u.first_name, u.last_name, u.organization_name,
                 u.referral_code, u.plan_tier, u.status, u.created_at, u.last_login_at,
                 ba.current_plan, ba.billing_status
          FROM users u
          LEFT JOIN billing_accounts ba ON u.id = ba.user_id
          ORDER BY u.created_at DESC
        `);

        return usersResult.rows.map(user => ({
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          organizationName: user.organization_name,
          referralCode: user.referral_code,
          planTier: user.current_plan || user.plan_tier,
          status: user.status,
          billingStatus: user.billing_status,
          createdAt: user.created_at,
          lastLoginAt: user.last_login_at
        }));
      } else {
        return Array.from(fallbackUsers.values()).map(user => {
          const { hashedPassword: _, ...userWithoutPassword } = user;
          return userWithoutPassword;
        });
      }
    } catch (error) {
      console.error('Failed to get all users:', error.message);
      return [];
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
}

// Export both the class and a singleton instance
export { DatabaseAuthService };
export default DatabaseAuthService;