# Database Schema Changes

## Overview
Complete database schema modifications needed to support audience persistence with proper normalization.

## Current Database State

### Existing Tables (Working)
- ✅ `organization_intelligence` - Stores website analysis + scenarios
- ✅ `users` - User accounts and authentication
- ✅ `content_topics` - **EMPTY** (needs population)
- ✅ `content_strategies` - **EMPTY** (needs population)

### Missing Tables
- ❌ `audiences` - Core audience strategies (NEW)
- ❌ `seo_keywords` - Keyword management (NEW)

## New Tables

### 1. `audiences` Table
Stores core audience strategy data generated from analysis scenarios.

```sql
CREATE TABLE audiences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) NULL, -- NULL for anonymous sessions
    session_id VARCHAR(255), -- For anonymous users  
    organization_intelligence_id UUID REFERENCES organization_intelligence(id),
    target_segment JSONB NOT NULL,
    customer_problem TEXT,
    customer_language JSONB,
    conversion_path TEXT,
    business_value JSONB,
    priority INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_audiences_user_id ON audiences(user_id);
CREATE INDEX idx_audiences_session_id ON audiences(session_id);
CREATE INDEX idx_audiences_org_intelligence ON audiences(organization_intelligence_id);
CREATE INDEX idx_audiences_priority ON audiences(priority);
```

### 2. `seo_keywords` Table
Manages SEO keywords associated with each audience strategy.

```sql
CREATE TABLE seo_keywords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) NULL,
    session_id VARCHAR(255),
    audience_id UUID REFERENCES audiences(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    search_volume INTEGER,
    competition VARCHAR(20) CHECK (competition IN ('low', 'medium', 'high')),
    relevance_score DECIMAL(3,2) CHECK (relevance_score >= 0.0 AND relevance_score <= 1.0),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance  
CREATE INDEX idx_seo_keywords_audience_id ON seo_keywords(audience_id);
CREATE INDEX idx_seo_keywords_user_id ON seo_keywords(user_id);
CREATE INDEX idx_seo_keywords_session_id ON seo_keywords(session_id);
CREATE INDEX idx_seo_keywords_keyword ON seo_keywords(keyword);
```

## Updated Existing Tables

### 3. Update `content_topics` Table
Add foreign key relationships to audiences.

```sql
-- Add new columns to link topics to audiences
ALTER TABLE content_topics ADD COLUMN audience_id UUID REFERENCES audiences(id);
ALTER TABLE content_topics ADD COLUMN session_id VARCHAR(255);

-- Add indexes
CREATE INDEX idx_content_topics_audience_id ON content_topics(audience_id);
CREATE INDEX idx_content_topics_session_id ON content_topics(session_id);
```

### 4. Update `content_strategies` Table  
Add foreign key relationships to audiences.

```sql
-- Add new columns to link strategies to audiences
ALTER TABLE content_strategies ADD COLUMN audience_id UUID REFERENCES audiences(id);
ALTER TABLE content_strategies ADD COLUMN session_id VARCHAR(255);

-- Add indexes
CREATE INDEX idx_content_strategies_audience_id ON content_strategies(audience_id);
CREATE INDEX idx_content_strategies_session_id ON content_strategies(session_id);
```

## Data Relationships

### Entity Relationship Diagram
```
organization_intelligence (1) → (many) audiences
audiences (1) → (many) seo_keywords
audiences (1) → (many) content_topics  
audiences (1) → (many) content_strategies
users (1) → (many) audiences
```

### Session vs User Data
- **Anonymous Users**: Use `session_id` for temporary persistence
- **Authenticated Users**: Use `user_id` for permanent persistence
- **Upgrade Path**: Transfer `session_id` data to `user_id` on registration

## Migration Scripts

### Migration File: `11_audience_persistence_tables.sql`
```sql
-- Create audiences table
CREATE TABLE audiences (
    -- [Full table definition above]
);

-- Create seo_keywords table  
CREATE TABLE seo_keywords (
    -- [Full table definition above]
);

-- Update existing tables
ALTER TABLE content_topics ADD COLUMN audience_id UUID REFERENCES audiences(id);
ALTER TABLE content_topics ADD COLUMN session_id VARCHAR(255);

ALTER TABLE content_strategies ADD COLUMN audience_id UUID REFERENCES audiences(id);
ALTER TABLE content_strategies ADD COLUMN session_id VARCHAR(255);

-- Create all indexes
-- [All index creation statements above]
```

### Rollback Script: `rollback_11_audience_persistence_tables.sql`
```sql
-- Remove added columns from existing tables
ALTER TABLE content_strategies DROP COLUMN IF EXISTS audience_id;
ALTER TABLE content_strategies DROP COLUMN IF EXISTS session_id;

ALTER TABLE content_topics DROP COLUMN IF EXISTS audience_id;
ALTER TABLE content_topics DROP COLUMN IF EXISTS session_id;

-- Drop new tables
DROP TABLE IF EXISTS seo_keywords;
DROP TABLE IF EXISTS audiences;
```

## Testing Validation

### Schema Testing Checklist
- [ ] All tables create successfully
- [ ] Foreign key constraints work properly
- [ ] Indexes create without errors
- [ ] Data insertion works for all tables
- [ ] Cascade deletes work correctly
- [ ] Rollback script restores original state
- [ ] No impact on existing data/APIs

### Test Data Insertion
```sql
-- Test data for validation
INSERT INTO audiences (user_id, organization_intelligence_id, target_segment, customer_problem) 
VALUES ('test-user-id', 'test-org-intel-id', '{"demographics": "test"}', 'test problem');

INSERT INTO seo_keywords (audience_id, keyword, search_volume, competition)
VALUES ('test-audience-id', 'test keyword', 1000, 'medium');
```

## Performance Considerations
- Indexes on frequently queried columns
- JSONB for flexible schema evolution
- Cascade deletes for data integrity
- Efficient query patterns for API endpoints

---
**Migration Number**: 11  
**Estimated Duration**: 5-10 minutes  
**Risk Level**: Low (new tables, minimal existing table changes)  
**Rollback Time**: 2-3 minutes