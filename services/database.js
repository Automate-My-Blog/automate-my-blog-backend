import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const { Pool } = pg;

// Database configuration for Vercel/Cloud hosting
const getDatabaseConfig = () => {
  // Check if we have a full connection string (production/vercel)
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    };
  }
  
  // Fallback to individual connection parameters (development/local)
  return {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'automate_my_blog',
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
    ssl: false
  };
};

// Connection pool configuration optimized for Vercel serverless
const dbConfig = {
  ...getDatabaseConfig(),
  // Serverless-optimized pool settings
  max: process.env.NODE_ENV === 'production' ? 2 : 10,  // Lower max for serverless
  idleTimeoutMillis: 10000,     // Shorter idle timeout for serverless
  connectionTimeoutMillis: 5000, // Quicker connection timeout
};

console.log('🔗 Connecting to database:', {
  ssl: dbConfig.ssl,
  host: dbConfig.host || 'connection_string',
  database: dbConfig.database || 'from_url',
  environment: process.env.NODE_ENV
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
   * Test database connection
   * @returns {Promise<boolean>} Connection status
   */
  async testConnection() {
    try {
      const result = await this.query('SELECT NOW() as current_time, version() as db_version');
      console.log('✅ Database connection successful');
      console.log('⏰ Server time:', result.rows[0].current_time);
      console.log('🗄️ Database version:', result.rows[0].db_version.split(' ')[0]);
      return true;
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      
      // Provide helpful error messages
      if (error.code === 'ECONNREFUSED') {
        console.log('\n🚨 Connection refused. Check database server status.');
      } else if (error.code === '3D000') {
        console.log('\n🚨 Database does not exist.');
      } else if (error.code === '28P01') {
        console.log('\n🚨 Authentication failed. Check credentials.');
      } else if (error.code === 'ENOTFOUND') {
        console.log('\n🚨 Database host not found. Check connection string.');
      }
      
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

// Export both the instance and the raw pool
export default db;
export { pool };

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