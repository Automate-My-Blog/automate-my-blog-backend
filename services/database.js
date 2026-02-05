import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const { Pool } = pg;

// Database configuration for Vercel/Cloud hosting
const getDatabaseConfig = () => {
  console.log('🔍 Database Configuration Debug:', {
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    hasRawDatabaseUrl: !!process.env.DATABASE_URL,
    databaseUrlLength: process.env.DATABASE_URL?.length || 0,
    databaseUrlStart: process.env.DATABASE_URL?.substring(0, 20) || 'Not set',
    hasDbUser: !!process.env.DB_USER,
    hasDbHost: !!process.env.DB_HOST,
    hasDbName: !!process.env.DB_NAME,
    hasDbPassword: !!process.env.DB_PASSWORD,
    hasDbPort: !!process.env.DB_PORT
  });

  // Check if we have a full connection string (production/vercel)
  if (process.env.DATABASE_URL) {
    const config = {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    };
    
    console.log('✅ Using DATABASE_URL connection with config:', {
      hasConnectionString: !!config.connectionString,
      sslConfig: config.ssl,
      urlProtocol: process.env.DATABASE_URL?.split('://')[0] || 'unknown'
    });
    
    return config;
  }
  
  // Fallback to individual connection parameters (development/local)
  const config = {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'automate_my_blog',
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
    ssl: false
  };
  
  console.log('📋 Using individual connection parameters:', {
    user: config.user,
    host: config.host,
    database: config.database,
    hasPassword: !!config.password,
    port: config.port,
    ssl: config.ssl
  });
  
  return config;
};

// Connection pool configuration optimized for Vercel serverless
const dbConfig = {
  ...getDatabaseConfig(),
  // Serverless-optimized pool settings with extended timeouts for slow databases
  max: process.env.NODE_ENV === 'production' ? 1 : 10,  // Single connection for serverless to avoid pool conflicts
  idleTimeoutMillis: 3000,      // Shorter idle timeout for serverless cleanup
  connectionTimeoutMillis: 30000, // Extended timeout for slow database connections (was 5000)
  acquireTimeoutMillis: 30000,  // Time to wait for connection from pool
  createTimeoutMillis: 30000,   // Time to wait for new connection creation
};

console.log('🔗 Initializing database connection pool:', {
  ssl: dbConfig.ssl,
  host: dbConfig.host || 'connection_string',
  database: dbConfig.database || 'from_url',
  environment: process.env.NODE_ENV,
  maxConnections: dbConfig.max,
  idleTimeout: dbConfig.idleTimeoutMillis,
  connectionTimeout: dbConfig.connectionTimeoutMillis,
  acquireTimeout: dbConfig.acquireTimeoutMillis,
  createTimeout: dbConfig.createTimeoutMillis,
  configType: process.env.DATABASE_URL ? 'DATABASE_URL' : 'individual_params',
  timeoutFix: 'Extended timeouts for slow database connections'
});

// Create connection pool
const pool = new Pool(dbConfig);

// Handle pool connection events
pool.on('connect', (client) => {
  console.log('🔗 New client connected to PostgreSQL database');
});

pool.on('error', (err, client) => {
  console.error('🚨 Unexpected error on idle client', err);
  // Don't exit in serverless environment
  if (process.env.NODE_ENV !== 'production') {
    process.exit(-1);
  }
});

// Database utility class optimized for serverless
class DatabaseService {
  constructor() {
    this.pool = pool;
  }

  /**
   * Execute a query with parameters
   * @param {string} text - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Object>} Query result
   */
  async query(text, params = []) {
    const start = Date.now();
    
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      // Log slow queries (> 2 seconds for production)
      const slowQueryThreshold = process.env.NODE_ENV === 'production' ? 2000 : 1000;
      if (duration > slowQueryThreshold) {
        console.warn(`🐌 Slow query detected (${duration}ms):`, text.substring(0, 100) + '...');
      }
      
      return result;
    } catch (error) {
      console.error('💥 Database query error:', error.message);
      console.error('Query:', text.substring(0, 200) + '...');
      console.error('Params:', JSON.stringify(params).substring(0, 100) + '...');
      throw error;
    }
  }

  /**
   * Get a client from the pool for transactions
   * @returns {Promise<Object>} Database client
   */
  async getClient() {
    try {
      const client = await this.pool.connect();
      return client;
    } catch (error) {
      console.error('Failed to get database client:', error.message);
      throw error;
    }
  }

  /**
   * Execute multiple queries in a transaction
   * @param {Function} callback - Function that receives client and executes queries
   * @returns {Promise<any>} Transaction result
   */
  async transaction(callback) {
    const client = await this.getClient();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Test database connection with enhanced debugging
   * @returns {Promise<boolean>} Connection status
   */
  async testConnection() {
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const startTime = Date.now();
    
    console.log(`🔍 [${connectionId}] Starting database connection test...`);
    
    try {
      // Test basic connectivity first
      console.log(`🔍 [${connectionId}] Attempting to acquire pool connection...`);
      const client = await this.pool.connect();
      
      console.log(`🔍 [${connectionId}] Pool connection acquired, executing test query...`);
      const result = await client.query('SELECT NOW() as current_time, version() as db_version, current_database() as db_name');
      client.release();
      
      const duration = Date.now() - startTime;
      
      console.log(`✅ [${connectionId}] Database connection successful (${duration}ms)`);
      console.log(`⏰ Server time: ${result.rows[0].current_time}`);
      console.log(`🗄️ Database version: ${result.rows[0].db_version.split(' ')[0]}`);
      console.log(`📁 Database name: ${result.rows[0].db_name}`);
      console.log(`📊 Pool status: Total=${this.pool.totalCount}, Idle=${this.pool.idleCount}, Waiting=${this.pool.waitingCount}`);
      
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      console.error(`❌ [${connectionId}] Database connection failed (${duration}ms):`, {
        message: error.message,
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        hostname: error.hostname,
        address: error.address,
        port: error.port,
        stack: error.stack?.split('\n')[0] // First line of stack for brevity
      });
      
      // Enhanced error analysis with production-specific hints
      if (error.code === 'ECONNREFUSED') {
        console.error(`🚨 [${connectionId}] Connection refused:`, {
          issue: 'Database server not accepting connections',
          possibleCauses: [
            'Database server is down',
            'Firewall blocking connection',
            'Wrong host/port configuration',
            'Vercel IP not whitelisted (if using external DB)'
          ],
          checkItems: [
            'Verify DATABASE_URL host and port',
            'Check database server status',
            'Verify Vercel IP whitelist if using external DB'
          ]
        });
      } else if (error.code === '3D000') {
        console.error(`🚨 [${connectionId}] Database does not exist:`, {
          issue: 'Specified database name not found',
          possibleCauses: [
            'Wrong database name in connection string',
            'Database not created on server',
            'Typo in DATABASE_URL'
          ]
        });
      } else if (error.code === '28P01') {
        console.error(`🚨 [${connectionId}] Authentication failed:`, {
          issue: 'Invalid credentials',
          possibleCauses: [
            'Wrong username/password in DATABASE_URL',
            'User permissions insufficient',
            'Password contains special characters not properly encoded'
          ]
        });
      } else if (error.code === 'ENOTFOUND') {
        console.error(`🚨 [${connectionId}] Host not found:`, {
          issue: 'DNS resolution failed',
          possibleCauses: [
            'Wrong hostname in DATABASE_URL',
            'DNS resolution issues in Vercel environment',
            'Private network configuration issues'
          ],
          hostname: error.hostname
        });
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.message?.includes('connection timeout')) {
        console.error(`🚨 [${connectionId}] Connection timeout/reset:`, {
          issue: 'Network connectivity or database performance issues',
          possibleCauses: [
            'Database server overloaded or slow',
            'Network latency too high between Vercel and database',
            'Database plan limitations (free tier throttling)',
            'Connection pool misconfiguration',
            'Database suspended or under maintenance'
          ],
          currentTimeout: this.pool.options?.connectionTimeoutMillis || 'default',
          recommendedAction: 'Check database performance and consider upgrading database plan'
        });
      } else if (error.message?.includes('SSL')) {
        console.error(`🚨 [${connectionId}] SSL/TLS issues:`, {
          issue: 'SSL configuration problems',
          possibleCauses: [
            'SSL required but not configured',
            'Invalid SSL certificate',
            'SSL version mismatch'
          ],
          currentSSLConfig: this.pool.options?.ssl || 'none'
        });
      } else {
        console.error(`🚨 [${connectionId}] Unknown connection error:`, {
          issue: 'Unrecognized error type',
          needsInvestigation: true,
          errorDetails: {
            code: error.code,
            message: error.message,
            name: error.name
          }
        });
      }
      
      console.error(`📊 [${connectionId}] Pool status on failure: Total=${this.pool.totalCount}, Idle=${this.pool.idleCount}, Waiting=${this.pool.waitingCount}`);
      
      return false;
    }
  }

  /**
   * Get database health information
   * @returns {Promise<Object>} Health stats
   */
  async getHealthStats() {
    try {
      const [
        activeConnections,
        databaseSize,
        tableCount
      ] = await Promise.all([
        this.query('SELECT count(*) as active FROM pg_stat_activity WHERE state = \'active\''),
        this.query('SELECT pg_size_pretty(pg_database_size(current_database())) as size'),
        this.query(`SELECT count(*) as tables FROM information_schema.tables 
                   WHERE table_schema = 'public'`)
      ]);

      return {
        activeConnections: parseInt(activeConnections.rows[0].active),
        databaseSize: databaseSize.rows[0].size,
        tableCount: parseInt(tableCount.rows[0].tables),
        poolTotalCount: this.pool.totalCount,
        poolIdleCount: this.pool.idleCount,
        poolWaitingCount: this.pool.waitingCount
      };
    } catch (error) {
      console.error('Failed to get database health stats:', error.message);
      return {
        activeConnections: 0,
        databaseSize: 'Unknown',
        tableCount: 0,
        poolTotalCount: this.pool.totalCount,
        poolIdleCount: this.pool.idleCount,
        poolWaitingCount: this.pool.waitingCount,
        error: error.message
      };
    }
  }

  /**
   * Check if required tables exist
   * @returns {Promise<Object>} Table status
   */
  async checkTables() {
    try {
      const requiredTables = [
        'users', 'blog_posts', 'generation_history', 'user_sessions',
        'billing_accounts', 'referrals', 'user_invites', 'referral_rewards',
        'projects', 'user_activity_events', 'audit_logs', 'feature_flags'
      ];
      
      const tableQuery = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = ANY($1)
      `;
      
      const result = await this.query(tableQuery, [requiredTables]);
      const existingTables = result.rows.map(row => row.table_name);
      const missingTables = requiredTables.filter(table => !existingTables.includes(table));
      
      return {
        totalRequired: requiredTables.length,
        existing: existingTables,
        missing: missingTables,
        isComplete: missingTables.length === 0
      };
    } catch (error) {
      console.error('Failed to check table status:', error.message);
      return {
        totalRequired: 0,
        existing: [],
        missing: [],
        isComplete: false,
        error: error.message
      };
    }
  }

  /**
   * Close all database connections (for serverless cleanup)
   */
  async close() {
    try {
      await this.pool.end();
      console.log('🔒 Database connection pool closed');
    } catch (error) {
      console.error('Error closing database pool:', error.message);
    }
  }
}

// Create singleton instance
const db = new DatabaseService();

// Export the db instance only. Use db.getClient() for transaction support.
// NOTE: pool is intentionally not exported; use db.query() or db.getClient().
export default db;

// Test connection on startup (only in development)
if (process.env.NODE_ENV !== 'production') {
  const testStartup = async () => {
    try {
      const connected = await db.testConnection();
      if (connected) {
        const tableStatus = await db.checkTables();
        console.log('📋 Database tables:', tableStatus);
        
        if (!tableStatus.isComplete) {
          console.warn('⚠️ Some required tables are missing:', tableStatus.missing);
          console.log('💡 Run database migration scripts to create missing tables');
        }
      }
    } catch (error) {
      console.error('Initial database setup check failed:', error.message);
    }
  };
  
  testStartup();
}