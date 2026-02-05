# API Endpoints Specification

## Overview
Complete API specification for audience persistence supporting both authenticated and anonymous workflows.

## Authentication Strategy

### Dual-Mode Support
All endpoints support both authentication modes:
- **Authenticated**: Use `user_id` from JWT token
- **Anonymous**: Use `session_id` from request headers or body

### Headers
```javascript
// For authenticated requests
Authorization: Bearer <jwt_token>

// For anonymous requests  
X-Session-ID: <session_id>
```

## Core Audience APIs

### 1. Create Audience Strategy
```http
POST /api/v1/audiences
```

**Request Body**:
```json
{
  "organization_intelligence_id": "uuid",
  "target_segment": {
    "demographics": "Parents of children aged 2-12",
    "psychographics": "Value-driven customers",
    "searchBehavior": "Active researchers"
  },
  "customer_problem": "Finding safe, effective products for sensitive children",
  "customer_language": ["sensitive skin", "natural products", "safe for kids"],
  "conversion_path": "Educational content → Product comparison → Purchase",
  "business_value": {
    "searchVolume": "8K+ monthly",
    "conversionPotential": "High", 
    "priority": 1,
    "competition": "Medium"
  },
  "priority": 1
}
```

**Response**:
```json
{
  "success": true,
  "audience": {
    "id": "audience-uuid",
    "user_id": "user-uuid", // null for anonymous
    "session_id": "session-uuid", // null for authenticated
    "organization_intelligence_id": "org-uuid",
    "target_segment": {...},
    "customer_problem": "...",
    "customer_language": [...],
    "conversion_path": "...",
    "business_value": {...},
    "priority": 1,
    "created_at": "2026-01-04T10:00:00Z",
    "updated_at": "2026-01-04T10:00:00Z"
  }
}
```

### 2. Get User's Audiences
```http
GET /api/v1/audiences
```

**Query Parameters**:
- `organization_intelligence_id` (optional) - Filter by analysis

**Response**:
```json
{
  "success": true,
  "audiences": [
    {
      "id": "audience-uuid",
      "target_segment": {...},
      "customer_problem": "...",
      "priority": 1,
      "topics_count": 3,
      "keywords_count": 8,
      "created_at": "2026-01-04T10:00:00Z"
    }
  ],
  "strategies": [...],
  "total": 1
}
```
Note: `strategies` is an alias of `audiences` (same array) for frontend "Choose Your SEO Strategy" / AudienceSegmentsTab compatibility.

### 3. Get Specific Audience
```http
GET /api/v1/audiences/:id
```

**Response**:
```json
{
  "success": true,
  "audience": {
    "id": "audience-uuid",
    "target_segment": {...},
    "customer_problem": "...",
    "customer_language": [...],
    "conversion_path": "...",
    "business_value": {...},
    "topics": [
      {
        "id": "topic-uuid",
        "title": "Complete Guide to Sensitive Skin Care",
        "description": "...",
        "category": "Educational"
      }
    ],
    "keywords": [
      {
        "id": "keyword-uuid", 
        "keyword": "sensitive skin products",
        "search_volume": 2400,
        "competition": "medium",
        "relevance_score": 0.85
      }
    ]
  }
}
```

### 4. Update Audience
```http
PUT /api/v1/audiences/:id
```

**Request Body**: Same as create, fields to update only

### 5. Delete Audience
```http
DELETE /api/v1/audiences/:id
```

**Response**:
```json
{
  "success": true,
  "message": "Audience deleted successfully"
}
```

## Content Topics APIs

### 1. Add Topics to Audience
```http
POST /api/v1/audiences/:id/topics
```

**Request Body**:
```json
{
  "topics": [
    {
      "title": "Complete Guide to Sensitive Skin Care for Children",
      "description": "Comprehensive guide covering product selection, ingredients to avoid, and daily routines",
      "category": "Educational Guide",
      "subheader": "Expert advice for parents dealing with children's sensitive skin"
    }
  ]
}
```

### 2. Get Topics for Audience
```http
GET /api/v1/audiences/:id/topics
```

### 3. Update Topic
```http
PUT /api/v1/topics/:id
```

### 4. Delete Topic
```http
DELETE /api/v1/topics/:id
```

## SEO Keywords APIs

### 1. Add Keywords to Audience
```http
POST /api/v1/audiences/:id/keywords
```

**Request Body**:
```json
{
  "keywords": [
    {
      "keyword": "sensitive skin products for kids",
      "search_volume": 1200,
      "competition": "medium",
      "relevance_score": 0.90
    },
    {
      "keyword": "natural baby skincare",
      "search_volume": 800,
      "competition": "low", 
      "relevance_score": 0.85
    }
  ]
}
```

### 2. Get Keywords for Audience  
```http
GET /api/v1/audiences/:id/keywords
```

### 3. Update Keyword
```http
PUT /api/v1/keywords/:id
```

### 4. Delete Keyword
```http
DELETE /api/v1/keywords/:id
```

## Content Strategies APIs

### 1. Add Strategy to Audience
```http
POST /api/v1/audiences/:id/strategies
```

**Request Body**:
```json
{
  "strategy_type": "content_approach",
  "configuration": {
    "goal": "education",
    "voice": "expert", 
    "template": "comprehensive_guide",
    "length": "deep_dive"
  }
}
```

### 2. Get Strategies for Audience
```http
GET /api/v1/audiences/:id/strategies
```

## Session Management APIs

### 1. Create Anonymous Session
```http
POST /api/v1/session/create
```

**Response**:
```json
{
  "success": true,
  "session_id": "session-uuid",
  "expires_at": "2026-01-05T10:00:00Z"
}
```

### 2. Get Session Data
```http
GET /api/v1/session/:sessionId
```

**Response**:
```json
{
  "success": true,
  "session": {
    "id": "session-uuid",
    "audiences": [...],
    "topics": [...],
    "keywords": [...],
    "created_at": "2026-01-04T10:00:00Z"
  }
}
```

### 3. Transfer Session to User Account
```http
POST /api/v1/users/adopt-session
```

**Request Body**:
```json
{
  "session_id": "session-uuid"
}
```

**Response**:
```json
{
  "success": true,
  "transferred": {
    "audiences": 3,
    "topics": 8, 
    "keywords": 15
  }
}
```

## Enhanced Existing APIs

### 1. Enhanced Analysis Endpoint
```http
GET /api/v1/user/recent-analysis
```

**Enhanced Response**:
```json
{
  "success": true,
  "analysis": {
    "businessName": "Lumibears",
    "targetAudience": "Parents of sensitive children",
    // ... existing analysis fields
    "scenarios": [...] // Existing scenarios
  },
  "audiences": [
    {
      "id": "audience-uuid",
      "target_segment": {...},
      "topics_count": 3,
      "keywords_count": 8
    }
  ],
  "total_topics": 8,
  "total_keywords": 15
}
```

## Batch Operations

### 1. Complete Audience Creation
```http
POST /api/v1/audiences/complete
```

Creates audience + topics + keywords in single transaction.

**Request Body**:
```json
{
  "organization_intelligence_id": "org-uuid",
  "audience": {...},
  "topics": [...],
  "keywords": [...]
}
```

## Error Responses

### Standard Error Format
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "validation error details"
  }
}
```

### HTTP Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (invalid/missing auth)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (duplicate data)
- `500` - Internal Server Error

## Rate Limiting
- **Authenticated Users**: 1000 requests/hour
- **Anonymous Sessions**: 100 requests/hour
- **Burst Allowance**: 20 requests/minute

## Pagination
For list endpoints returning multiple items:

**Query Parameters**:
- `page` (default: 1)
- `limit` (default: 20, max: 100)

**Response Format**:
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 156,
    "total_pages": 8,
    "has_next": true,
    "has_previous": false
  }
}
```

---
**Version**: 1.0  
**Last Updated**: January 4, 2026  
**Status**: Specification Complete - Ready for Implementation