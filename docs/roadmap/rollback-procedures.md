# Rollback Procedures

## Overview
Comprehensive rollback procedures for audience persistence implementation to ensure system can be restored to previous working state if issues occur.

## Emergency Rollback Triggers

### When to Execute Rollback
Execute immediate rollback if any of the following occur:

- **Database Issues**:
  - Migration fails or corrupts data
  - Performance degradation > 50%
  - Foreign key constraint violations
  - Data consistency issues

- **API Issues**:
  - Critical endpoints returning errors
  - Authentication system broken
  - Existing functionality broken
  - Response times > 5 seconds

- **Frontend Issues**:
  - App fails to build or deploy
  - Critical user workflows broken
  - Data loss or corruption
  - Security vulnerabilities exposed

## Phase 1: Database Schema Rollback

### Immediate Rollback (< 5 minutes)

#### Step 1: Execute Rollback Script
```bash
# Navigate to backend directory
cd "/Users/jamesfrankel/codebases/Automate My Blog/automate-my-blog-frontend backend"

# Execute rollback migration
node -e "
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function rollback() {
  try {
    const rollbackSQL = fs.readFileSync('./database/rollback_11_audience_persistence_tables.sql', 'utf8');
    await pool.query(rollbackSQL);
    console.log('✅ Database rollback completed successfully');
  } catch (error) {
    console.error('❌ Database rollback failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

rollback();
"
```

#### Step 2: Verify Rollback
```sql
-- Check tables are removed
SELECT table_name FROM information_schema.tables 
WHERE table_name IN ('audiences', 'seo_keywords');
-- Should return 0 rows

-- Check columns removed from existing tables
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'content_topics' AND column_name IN ('audience_id', 'session_id');
-- Should return 0 rows

SELECT column_name FROM information_schema.columns 
WHERE table_name = 'content_strategies' AND column_name IN ('audience_id', 'session_id');
-- Should return 0 rows
```

#### Step 3: Test Existing Functionality
```bash
# Test existing API endpoints
curl -X GET "https://automate-my-blog-backend.vercel.app/api/v1/health"
curl -X POST "https://automate-my-blog-backend.vercel.app/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password"}'
```

### Manual Rollback Script

#### File: `database/rollback_11_audience_persistence_tables.sql`
```sql
-- Rollback Script for Audience Persistence Implementation
-- Execute this script to remove all changes from migration 11

BEGIN;

-- Remove added columns from existing tables (safe - data in these columns will be lost)
ALTER TABLE content_strategies DROP COLUMN IF EXISTS audience_id;
ALTER TABLE content_strategies DROP COLUMN IF EXISTS session_id;

ALTER TABLE content_topics DROP COLUMN IF EXISTS audience_id; 
ALTER TABLE content_topics DROP COLUMN IF EXISTS session_id;

-- Drop new tables (safe - data in these tables will be lost)
DROP TABLE IF EXISTS seo_keywords;
DROP TABLE IF EXISTS audiences;

-- Verify rollback
SELECT 'Rollback completed - checking for remaining objects...' as status;

-- Check for any remaining objects (should return 0 rows)
SELECT table_name, 'ERROR: Table still exists' as issue
FROM information_schema.tables 
WHERE table_name IN ('audiences', 'seo_keywords');

SELECT table_name, column_name, 'ERROR: Column still exists' as issue
FROM information_schema.columns 
WHERE (table_name = 'content_topics' OR table_name = 'content_strategies')
  AND column_name IN ('audience_id', 'session_id');

COMMIT;
```

## Phase 2: Backend API Rollback

### Immediate API Rollback

#### Step 1: Revert Backend Code
```bash
# Navigate to backend directory
cd "/Users/jamesfrankel/codebases/Automate My Blog/automate-my-blog-frontend backend"

# Revert to previous commit (replace with actual commit hash)
git log --oneline -5  # Find previous working commit
git revert [commit-hash] --no-edit
```

#### Step 2: Redeploy Backend
```bash
# Redeploy to Vercel
vercel --prod

# Or if using git deployment, push revert
git push origin main
```

#### Step 3: Verify API Rollback
```bash
# Test critical endpoints still work
curl -X GET "https://automate-my-blog-backend.vercel.app/api/v1/user/recent-analysis" \
  -H "Authorization: Bearer YOUR_TOKEN"

curl -X POST "https://automate-my-blog-backend.vercel.app/api/v1/analyze-website" \
  -H "Content-Type: application/json" \
  -d '{"websiteUrl":"https://test.com"}'
```

### Environment Variables Rollback
If environment variables were changed:
```bash
# Revert environment variables in Vercel dashboard
# Or using Vercel CLI
vercel env ls
vercel env rm [VARIABLE_NAME]
vercel env add [VARIABLE_NAME] [OLD_VALUE]
```

## Phase 3: Frontend Rollback

### Immediate Frontend Rollback

#### Step 1: Revert Frontend Code
```bash
# Navigate to frontend directory  
cd "/Users/jamesfrankel/codebases/Automate My Blog/automate-my-blog-frontend"

# Revert to previous commit
git log --oneline -5  # Find previous working commit
git revert [commit-hash] --no-edit
```

#### Step 2: Remove Debug Code
If debug logging needs to be removed quickly:
```bash
# Remove debug console.log statements
find src/ -name "*.js" -exec sed -i '' '/console.log.*Debug/d' {} \;
find src/ -name "*.js" -exec sed -i '' '/console.log.*🔍/d' {} \;
```

#### Step 3: Test Build
```bash
# Test build works
npm run build

# If build fails, identify and fix issues
npm start  # Test development server
```

#### Step 4: Redeploy Frontend
```bash
# Deploy via Vercel
vercel --prod

# Or push to trigger auto-deployment
git push origin main
```

## Full System Rollback

### Complete Environment Restoration

#### Step 1: Database State Restoration
```sql
-- If needed, restore from backup
-- (Replace with actual backup restoration procedure)

-- For Supabase/managed PostgreSQL:
-- 1. Go to Supabase dashboard
-- 2. Navigate to Database → Backups
-- 3. Restore from backup created before migration

-- For manual backup restoration:
-- psql $DATABASE_URL < backup_before_migration_11.sql
```

#### Step 2: Code State Restoration
```bash
# Navigate to project root
cd "/Users/jamesfrankel/codebases/Automate My Blog"

# Reset both backend and frontend to working state
git checkout [last-working-commit]

# Or revert specific changes
git revert [bad-commit-1] [bad-commit-2] --no-edit
```

#### Step 3: Deployment State Restoration
```bash
# Redeploy both services
cd automate-my-blog-frontend
vercel --prod

cd "../automate-my-blog-frontend backend"  
vercel --prod
```

#### Step 4: Verification
```bash
# Full system health check
curl -X GET "https://automate-my-blog-backend.vercel.app/api/v1/health"
curl -X GET "https://YOUR_FRONTEND_URL/"

# Test critical user workflow
# 1. Load app
# 2. Run website analysis  
# 3. Verify results persist
# 4. Test authentication
```

## Rollback Testing

### Pre-Rollback Testing
Before executing any rollback:
```bash
# Create snapshot of current state
pg_dump $DATABASE_URL > rollback_point_backup.sql

# Verify rollback scripts work in staging
# Execute rollback in staging environment first
```

### Post-Rollback Validation
After rollback completion:
```sql
-- Verify data integrity
SELECT COUNT(*) FROM users;  -- Should match pre-migration count
SELECT COUNT(*) FROM organization_intelligence;  -- Should be unchanged

-- Check for any orphaned data
SELECT COUNT(*) FROM content_topics WHERE audience_id IS NOT NULL;  -- Should be 0
SELECT COUNT(*) FROM content_strategies WHERE audience_id IS NOT NULL;  -- Should be 0
```

## Emergency Contacts & Communication

### Rollback Communication Plan

#### Internal Team
- [ ] Notify development team of rollback execution
- [ ] Update project status in team channels
- [ ] Document rollback reasons and lessons learned

#### External Communication (if needed)
- [ ] Prepare user-facing status page update
- [ ] Draft customer communication if rollback affects users
- [ ] Update support team on known issues

### Escalation Procedures

#### Level 1: Immediate Issues (< 1 hour)
- Execute appropriate rollback procedure
- Test critical functionality
- Monitor error logs and metrics

#### Level 2: Persistent Issues (1-4 hours)
- Engage additional team members
- Consider full system restoration from backup
- Prepare incident report

#### Level 3: Critical Issues (> 4 hours)
- Executive team notification
- Customer communication
- External vendor support if needed

## Prevention & Monitoring

### Rollback Prevention
- **Staging Testing**: Always test migrations in staging first
- **Gradual Deployment**: Use feature flags for incremental rollout
- **Monitoring**: Set up alerts for key metrics
- **Backup Strategy**: Automated backups before major changes

### Post-Rollback Analysis
- [ ] Root cause analysis of rollback trigger
- [ ] Update testing procedures to prevent recurrence
- [ ] Review and improve rollback procedures
- [ ] Team retrospective on incident handling

## Recovery Planning

### Data Recovery
If rollback results in data loss:
```sql
-- If audiences data needs to be regenerated
-- Use organization_intelligence.scenarios to recreate audiences
SELECT oi.id, oi.scenarios, oi.user_id 
FROM organization_intelligence oi
WHERE oi.scenarios IS NOT NULL AND oi.scenarios != '[]';
```

### State Reconstruction
If partial rollback leaves system in inconsistent state:
```bash
# Clear all caches
# Redis/cache clearing commands here

# Reset user sessions
# Force re-authentication if needed

# Regenerate any computed data
# Run data consistency checks
```

---
**Emergency Contact**: Development Team  
**Backup Strategy**: Daily automated backups  
**Recovery Time Objective (RTO)**: < 1 hour  
**Recovery Point Objective (RPO)**: < 24 hours  

**Last Updated**: January 4, 2026  
**Tested**: Staging Environment ✅  
**Status**: Ready for Implementation