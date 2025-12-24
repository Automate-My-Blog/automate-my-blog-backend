# AutoBlog Database Setup

This directory contains the complete database schema for the AutoBlog platform. The database is designed to support the full feature set from MVP to enterprise scale.

## 📁 Files Overview

| File | Purpose | Tables Created |
|------|---------|----------------|
| `01_core_tables.sql` | Phase 1: MVP Core functionality | users, organizations, organization_members, projects, content_strategies, blog_posts, content_topics |
| `02_billing_tables.sql` | Phase 2: Billing & subscriptions | plan_definitions, user_usage_tracking, subscriptions, billing_cycles, pay_per_use_charges |
| `03_referral_analytics_tables.sql` | Phase 3: Growth & analytics | user_invites, referral_rewards, generation_history, user_sessions, user_activity_events, daily_metrics |
| `04_admin_security_tables.sql` | Phase 4: Admin & security | user_roles, audit_logs, feature_flags, api_keys |
| `05_create_all_indexes.sql` | Performance optimization | Critical indexes for all tables |
| `06_lead_generation_tables.sql` | Phase 5: Lead generation & sales | website_leads, lead_scoring, conversion_tracking, lead_interactions, lead_enrichment |

## 🚀 Quick Setup

### Option 1: Create All Tables at Once
```bash
# Connect to your PostgreSQL database and run:
psql -d your_database_name -f 01_core_tables.sql
psql -d your_database_name -f 02_billing_tables.sql  
psql -d your_database_name -f 03_referral_analytics_tables.sql
psql -d your_database_name -f 04_admin_security_tables.sql
psql -d your_database_name -f 06_lead_generation_tables.sql
psql -d your_database_name -f 05_create_all_indexes.sql
```

### Option 2: Incremental Deployment
```bash
# Start with core functionality only
psql -d your_database_name -f 01_core_tables.sql
psql -d your_database_name -f 05_create_all_indexes.sql

# Add billing when ready for revenue
psql -d your_database_name -f 02_billing_tables.sql

# Add analytics when scaling
psql -d your_database_name -f 03_referral_analytics_tables.sql

# Add admin features when needed
psql -d your_database_name -f 04_admin_security_tables.sql

# Add lead generation for sales intelligence
psql -d your_database_name -f 06_lead_generation_tables.sql
```

## 🔧 Environment Configuration

### Required Environment Variables
```bash
# Database connection
DATABASE_URL="postgresql://username:password@host:port/database_name"
# or individual components:
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="autoblog"
DB_USER="autoblog_user" 
DB_PASSWORD="your_secure_password"
DB_SSL="true" # for production

# Application settings
NODE_ENV="production"
JWT_SECRET="your_jwt_secret_key"
JWT_REFRESH_SECRET="your_jwt_refresh_secret"

# Stripe (for billing)
STRIPE_SECRET_KEY="sk_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# OpenAI
OPENAI_API_KEY="sk-..."
```

### Database Setup Steps

1. **Create PostgreSQL Database**
   ```sql
   CREATE DATABASE autoblog;
   CREATE USER autoblog_user WITH PASSWORD 'your_secure_password';
   GRANT ALL PRIVILEGES ON DATABASE autoblog TO autoblog_user;
   ```

2. **Run Schema Files** (see Quick Setup above)

3. **Verify Installation**
   ```sql
   -- Check tables were created
   SELECT table_name FROM information_schema.tables 
   WHERE table_schema = 'public' 
   ORDER BY table_name;
   
   -- Check indexes
   SELECT * FROM index_usage_stats;
   
   -- Check seed data
   SELECT * FROM plan_definitions;
   SELECT * FROM user_roles;
   SELECT * FROM feature_flags;
   ```

## 📊 Database Schema Summary

### Core Tables (22 total)
- **Users & Organizations**: Multi-tenant user management
- **Content Management**: Projects, strategies, blog posts, topics  
- **Billing System**: Plans, subscriptions, usage tracking, charges
- **Referral System**: Invites, rewards ($15 value per referral)
- **Analytics**: Generation history, user sessions, activity events
- **Admin Tools**: Roles, audit logs, feature flags, API keys

### Key Features
- ✅ **Multi-tenant**: Organizations with role-based access
- ✅ **Usage-based billing**: Free → Pay-per-use ($15) → Starter ($20/month) → Pro ($50/month unlimited)
- ✅ **Referral rewards**: $15 value for both inviter and invitee
- ✅ **Comprehensive analytics**: User behavior and platform metrics
- ✅ **Security**: Audit logs, role permissions, feature flags
- ✅ **Performance**: 80+ optimized indexes

## 🔄 Migration from In-Memory System

The current application uses in-memory storage in `/services/auth.js`. To migrate:

### Step 1: Install Database Library
```bash
# Choose one:
npm install pg  # PostgreSQL driver
npm install prisma @prisma/client  # Prisma ORM
npm install sequelize pg  # Sequelize ORM
```

### Step 2: Update Authentication Service
```javascript
// Example with pg (PostgreSQL driver)
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

class AuthService {
  async register(userData) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'INSERT INTO users (email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4) RETURNING *',
        [userData.email, userData.hashedPassword, userData.firstName, userData.lastName]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }
  
  // ... other methods
}
```

### Step 3: Data Migration
```javascript
// Migrate existing in-memory users to database
async function migrateInMemoryUsers() {
  for (const [id, user] of users.entries()) {
    await pool.query(
      'INSERT INTO users (id, email, password_hash, first_name, last_name, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, user.email, user.hashedPassword, user.firstName, user.lastName, user.createdAt]
    );
  }
}
```

## 🔍 Useful Queries

### Admin Dashboard Queries
```sql
-- Platform overview
SELECT * FROM platform_metrics_summary;

-- User management
SELECT * FROM admin_user_summary WHERE plan_tier != 'free';

-- Referral performance  
SELECT * FROM referral_program_summary ORDER BY total_reward_value DESC;

-- Recent activity
SELECT * FROM user_activity_events 
WHERE timestamp > CURRENT_TIMESTAMP - INTERVAL '24 hours'
ORDER BY timestamp DESC;
```

### Performance Monitoring
```sql
-- Index usage
SELECT * FROM index_usage_stats WHERE idx_scan > 1000;

-- Slow queries (enable pg_stat_statements)
SELECT query, mean_time, calls FROM pg_stat_statements 
ORDER BY mean_time DESC LIMIT 10;

-- Database size
SELECT pg_size_pretty(pg_database_size('autoblog'));
```

## 📈 Scaling Considerations

### Performance Tips
1. **Connection Pooling**: Use connection pools (pg-pool, Prisma connection pooling)
2. **Read Replicas**: Consider read replicas for analytics queries
3. **Caching**: Redis for session management and frequent queries
4. **Partitioning**: Partition large tables like `generation_history` by date
5. **Archive Strategy**: Move old analytics data to data warehouse

### Monitoring Setup
1. **Database Metrics**: CPU, memory, disk I/O, connection count
2. **Query Performance**: Slow query logs, query execution plans  
3. **Index Usage**: Monitor unused indexes, missing indexes
4. **Backup Strategy**: Automated daily backups with point-in-time recovery

## 🔒 Security Considerations

1. **Database Access**: Use least-privilege principle
2. **Connection Security**: SSL/TLS in production
3. **Query Safety**: Parameterized queries, input validation
4. **Audit Logs**: All admin actions logged in `audit_logs`
5. **Data Retention**: Implement data retention policies per GDPR

## 🆘 Troubleshooting

### Common Issues

**Connection errors:**
```bash
# Check database is running
pg_isready -h localhost -p 5432

# Test connection
psql -d autoblog -c "SELECT version();"
```

**Index creation taking long:**
```sql
-- Create indexes concurrently to avoid blocking
CREATE INDEX CONCURRENTLY idx_name ON table_name(column);
```

**Performance issues:**
```sql
-- Analyze table statistics
ANALYZE;

-- Check for missing indexes
SELECT * FROM pg_stat_user_tables WHERE seq_scan > idx_scan;
```

---

**Ready to migrate?** The database schema is production-ready and won't affect your current in-memory system until you explicitly connect your application code to it.