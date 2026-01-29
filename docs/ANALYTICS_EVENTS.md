# Analytics Event Taxonomy

This document defines all analytics events tracked in Automate My Blog, ensuring consistency between frontend instrumentation and backend analytics.

## Event Categories

### Authentication Events
Events related to user authentication and session management.

- **`signup_started`** - User clicked "Sign Up" button and began registration flow
- **`signup_completed`** - User successfully completed registration and account was created
- **`login_completed`** - User successfully authenticated and logged into their account
- **`logout`** - User logged out of their session

### Navigation Events
Events tracking user navigation and page interactions within the application.

- **`page_view`** - User navigated to a new page
  - `event_data`: `{ page_url: string, referrer?: string }`
- **`tab_switched`** - User switched tabs within the dashboard
  - `event_data`: `{ tab: string, from_tab?: string }`

### Workflow Events (Lead Funnel)
Events tracking the core content generation workflow from analysis to export.

- **`analysis_started`** - User initiated website analysis (can be anonymous lead)
  - `event_data`: `{ website_url: string }`
- **`analysis_completed`** - Website analysis finished successfully
  - `event_data`: `{ website_url: string, analysis_duration_ms?: number }`
- **`previews_viewed`** - User viewed audience persona previews
  - `event_data`: `{ preview_count: number }`
- **`audience_selected`** - User selected a target audience for content generation
  - `event_data`: `{ audience_id: string, audience_name: string }`
- **`topic_selected`** - User selected a topic for blog post generation
  - `event_data`: `{ topic: string, source?: string }`
- **`content_generated`** - AI successfully generated blog post content
  - `event_data`: `{ post_id: string, topic: string, word_count?: number }`
- **`export_initiated`** - User clicked export button to download content
  - `event_data`: `{ format: string, post_id: string }`
- **`content_exported`** - Content was successfully exported/downloaded
  - `event_data`: `{ format: string, post_id: string, file_size_bytes?: number }`
- **`project_saved`** - User saved their project for later access
  - `event_data`: `{ project_id: string }`

### Business Events
Events related to revenue, payments, and monetization.

- **`payment_success`** - Payment transaction completed successfully
  - `event_data`: `{ amount: number, currency: string, subscription_tier?: string }`
  - `revenue_attributed`: Decimal value of revenue generated
- **`purchase`** - User made a purchase (one-time or subscription)
  - `event_data`: `{ product_type: string, amount: number, payment_method?: string }`
  - `revenue_attributed`: Decimal value of revenue generated
- **`revenue`** - Revenue attributed to user action
  - `event_data`: `{ source: string, amount: number }`
  - `revenue_attributed`: Decimal value of revenue generated

### Generic Events
General-purpose events for tracking various user interactions.

- **`funnel_progress`** - Generic event for tracking progression through conversion funnel
  - `event_data`: `{ step: string, funnel_name?: string }`
  - `conversion_funnel_step`: String identifier of funnel step
- **`click`** - Generic click event
  - `event_data`: `{ element_id?: string, element_type?: string, label?: string }`
- **`button_click`** - Specific button interaction
  - `event_data`: `{ button_id: string, action?: string }`

## Event Data Structure

All events are stored in the `user_activity_events` table with the following schema:

```sql
{
  id: UUID,
  user_id: UUID | NULL,           -- NULL for anonymous visitors
  session_id: STRING,              -- Persistent across anonymous → registered
  event_type: STRING,              -- One of the event types above
  event_data: JSONB,               -- Event-specific metadata (flexible schema)
  page_url: STRING | NULL,         -- URL where event occurred
  referrer: STRING | NULL,         -- HTTP referrer
  utm_source: STRING | NULL,       -- Marketing attribution
  utm_medium: STRING | NULL,       -- Marketing attribution
  utm_campaign: STRING | NULL,     -- Marketing attribution
  conversion_funnel_step: STRING | NULL,  -- Funnel stage identifier
  revenue_attributed: DECIMAL | NULL,      -- Revenue generated (for business events)
  timestamp: TIMESTAMP             -- When event occurred
}
```

## Event Data Examples

### Authentication Example
```json
{
  "event_type": "signup_completed",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "session_id": "sess_abc123xyz",
  "event_data": {
    "registration_method": "email",
    "referral_code": "FRIEND10"
  },
  "page_url": "/signup",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Workflow Example (Topic Selection)
```json
{
  "event_type": "topic_selected",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "session_id": "sess_abc123xyz",
  "event_data": {
    "topic": "AI in Healthcare",
    "source": "dashboard",
    "category": "technology"
  },
  "page_url": "/dashboard/content-generation",
  "timestamp": "2024-01-15T10:35:00Z"
}
```

### Business Example (Payment)
```json
{
  "event_type": "payment_success",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "session_id": "sess_abc123xyz",
  "event_data": {
    "amount": 29.99,
    "currency": "USD",
    "subscription_tier": "pro",
    "payment_method": "card"
  },
  "revenue_attributed": 29.99,
  "conversion_funnel_step": "payment_completed",
  "page_url": "/checkout",
  "timestamp": "2024-01-15T10:40:00Z"
}
```

## Analytics Dashboard Usage

### Sales Funnel & Retention
Uses events to track full user journey from anonymous visitor to paying customer:
1. `total_leads` (from website_leads table)
2. `analysis_started` (anonymous visitor)
3. `analysis_completed` (anonymous visitor)
4. `topic_selected` (anonymous visitor)
5. `signup_started` (conversion point)
6. `signed_up` (from users table)
7. `email_verified` (from users table)
8. `first_login` (first login_completed event)
9. `first_generation` (first content_generated event)
10. `payment_success` (first payment event)
11. `active_subscriber` (from subscriptions table)
12. `upsell` (subscription tier upgrade)

### Engagement Metrics
Surfaces navigation and interaction patterns:
- **Page Views**: `page_view` events grouped by `page_url`
- **Tab Switches**: `tab_switched` events grouped by `tab_name`
- **Topic Selections**: `topic_selected` events grouped by `topic`
- **Export Activity**: `export_initiated` + `content_exported` events grouped by `format`
- **Session Metrics**: Calculated from event timestamps by `session_id`
- **Logout Tracking**: `logout` events for session end analysis

### Product Insights
LLM-generated insights use engagement metrics to identify:
- Navigation friction points (low tab switch rates)
- Feature discovery issues (page views vs. feature usage)
- Popular content topics (topic selection patterns)
- Export format preferences (export activity analysis)
- Session engagement quality (duration, events per session)

### User Journey
Individual user timeline showing all events categorized by:
- **Authentication**: signup_started, signup_completed, login_completed, logout
- **Navigation**: page_view, tab_switched
- **Workflow**: analysis_started, analysis_completed, topic_selected, content_generated, export_initiated
- **Business**: revenue, purchase, payment_success
- **Other**: All other tracked events

## Implementation Guidelines

### Frontend Instrumentation
When adding new analytics events in the frontend:

1. **Use descriptive event_type names** following the naming conventions above
2. **Include relevant event_data** that helps understand user context
3. **Preserve session_id** across anonymous → registered user transition
4. **Set conversion_funnel_step** for events that are part of conversion funnels
5. **Track revenue_attributed** for all monetization events

### Backend Analytics
When querying analytics data:

1. **Filter by event_type** for specific event categories
2. **Use session_id** to track anonymous visitors before they register
3. **Group by event_data fields** (using JSONB operators) for detailed breakdowns
4. **Calculate conversion rates** using COUNT DISTINCT on user_id or session_id
5. **Join with users/subscriptions tables** for registered user context

## Maintenance

This document should be updated whenever:
- New event types are added to frontend tracking
- Event data schemas change (new fields added to event_data)
- Analytics dashboard sections are added or modified
- Funnel definitions change

Last updated: 2024-01-29
