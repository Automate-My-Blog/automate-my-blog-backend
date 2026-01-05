# Audience Persistence Implementation Roadmap

## Overview
This document outlines the complete implementation plan to fix the audience data persistence issue where generated audience strategies disappear on page refresh.

## Problem Statement

### Current Issue
- ✅ Website analysis persists across sessions
- ❌ Generated audience strategies are lost on page refresh
- ❌ Users must regenerate audiences every session
- ❌ No persistence for content topics and SEO keywords

### Root Cause Analysis
The frontend has two separate data loading systems in `AudienceSegmentsTab.js`:

1. **Focus Mode Loader** (lines 47-89): Loads cached analysis into local `strategies` state
2. **Main Generator** (lines 92-242): Generates audiences from `stepResults.home.websiteAnalysis`

**The Issue**: Focus mode loader gets analysis data but doesn't populate `stepResults`, so main generator skips execution.

**Debug Evidence**:
```javascript
// Working during session:
hasAnalysisData: "Parents of sensitive children, caregivers, therapists"
analysisCompleted: true

// Failing after refresh:
Focus Mode getRecentAnalysis Response: { success: false, analysis: null }
```

## Solution Architecture

### Database Design
Create proper normalized tables for audience data persistence:

1. **`audiences`** - Core audience strategies
2. **`seo_keywords`** - Keywords per audience (NEW TABLE)  
3. **`content_topics`** - Topics per audience (EXISTING, UPDATE)
4. **`content_strategies`** - Strategy configs per audience (EXISTING, UPDATE)

### API Design
Support both authenticated and anonymous workflows:

- **Session-based APIs** for logged-out users
- **Persistent APIs** for authenticated users
- **Dual-mode endpoints** that work for both

## Implementation Phases

### Phase 1: Database Schema Creation ⏳
- [ ] Create `audiences` table
- [ ] Create `seo_keywords` table  
- [ ] Update existing `content_topics` table
- [ ] Update existing `content_strategies` table
- [ ] Test schema integrity

### Phase 2: Backend API Development ⏳
- [ ] Core audience CRUD endpoints
- [ ] Session management for anonymous users
- [ ] Enhanced analysis endpoints
- [ ] API testing and validation

### Phase 3: Frontend Integration ⏳
- [ ] Update API service layer
- [ ] Modify AudienceSegmentsTab for persistence
- [ ] Add session management
- [ ] End-to-end testing

## Success Criteria
- ✅ Audience strategies persist across page refreshes
- ✅ Anonymous users can complete full workflow
- ✅ Authenticated users get enhanced persistence
- ✅ No existing functionality broken
- ✅ Database properly normalized

## Testing Strategy
- Unit tests for each new API endpoint
- Integration tests with database
- Frontend React app testing
- End-to-end workflow testing
- Rollback testing

## Progress Tracking
- [ ] Phase 1: Database Schema
- [ ] Phase 2: Backend APIs
- [ ] Phase 3: Frontend Integration
- [ ] Final Testing & Deployment

## References
- [Database Schema Changes](./database-schema-changes.md)
- [API Endpoints Specification](./api-endpoints-specification.md)
- [Testing Checklist](./testing-checklist.md)
- [Rollback Procedures](./rollback-procedures.md)

---
**Last Updated**: January 4, 2026  
**Status**: In Progress - Phase 1  
**Next Action**: Create database schema files