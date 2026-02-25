-- Migration: Google Data Cache Tables
-- Purpose: Store cached data from Google Trends, Search Console, and Analytics
-- to reduce API calls and enable historical analysis

-- Google Trends Cache: Store trending topics per user/niche
CREATE TABLE IF NOT EXISTS google_trends_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,

    -- Query context
    keyword VARCHAR(255) NOT NULL,
    geo VARCHAR(10) DEFAULT 'US',
    timeframe VARCHAR(20) DEFAULT '7d',

    -- Trending data
    rising_queries JSONB, -- [{query, value, growth_percentage}]
    related_topics JSONB, -- [{topic, value, type: 'rising'|'top'}]
    interest_over_time JSONB, -- [{date, value}]

    -- Metadata
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_trends_user_keyword ON google_trends_cache(user_id, keyword);
CREATE INDEX idx_trends_fetched_at ON google_trends_cache(fetched_at);
CREATE INDEX idx_trends_expires_at ON google_trends_cache(expires_at);

-- Google Search Console Cache: Store ranking data per site
CREATE TABLE IF NOT EXISTS google_search_console_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Site context
    site_url VARCHAR(500) NOT NULL,

    -- Query data
    top_queries JSONB NOT NULL, -- [{query, clicks, impressions, ctr, position}]

    -- Date range
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,

    -- Metadata
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_gsc_user_site ON google_search_console_cache(user_id, site_url);
CREATE INDEX idx_gsc_fetched_at ON google_search_console_cache(fetched_at);

-- Google Analytics Cache: Store conversion data per site
CREATE TABLE IF NOT EXISTS google_analytics_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Page performance data
    page_url VARCHAR(1000),
    pageviews INTEGER,
    avg_session_duration FLOAT,
    bounce_rate FLOAT,
    conversions INTEGER,

    -- Date range
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,

    -- Metadata
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ga_user_page ON google_analytics_cache(user_id, page_url);
CREATE INDEX idx_ga_conversions ON google_analytics_cache(conversions DESC);

-- Content Performance Tracking: Link blog posts to Google data
CREATE TABLE IF NOT EXISTS content_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blog_post_id UUID REFERENCES blog_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Google Search Console metrics
    gsc_clicks INTEGER DEFAULT 0,
    gsc_impressions INTEGER DEFAULT 0,
    gsc_ctr FLOAT DEFAULT 0,
    gsc_avg_position FLOAT,
    gsc_queries JSONB, -- [{query, clicks, impressions, position}]

    -- Google Analytics metrics
    ga_pageviews INTEGER DEFAULT 0,
    ga_avg_session_duration FLOAT DEFAULT 0,
    ga_bounce_rate FLOAT DEFAULT 0,
    ga_conversions INTEGER DEFAULT 0,

    -- Derived metrics
    performance_score INTEGER, -- 0-100 composite score
    trend_informed BOOLEAN DEFAULT false, -- Was this post created from trending data?

    -- Tracking
    first_tracked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_tracked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_performance_post ON content_performance(blog_post_id);
CREATE INDEX idx_performance_score ON content_performance(performance_score DESC);
CREATE INDEX idx_performance_trend ON content_performance(trend_informed);

-- Table comments for documentation
COMMENT ON TABLE google_trends_cache IS 'Cached Google Trends data to reduce API calls and track trending topics over time';
COMMENT ON TABLE google_search_console_cache IS 'Cached Search Console rankings and queries to identify content opportunities';
COMMENT ON TABLE google_analytics_cache IS 'Cached Analytics conversion and engagement data to measure content effectiveness';
COMMENT ON TABLE content_performance IS 'Tracks real-world performance of generated content using Google data';

-- Column comments
COMMENT ON COLUMN google_trends_cache.rising_queries IS 'Array of trending search queries with growth percentage';
COMMENT ON COLUMN google_trends_cache.related_topics IS 'Array of related topics categorized as rising or top';
COMMENT ON COLUMN google_trends_cache.expires_at IS 'Cache expiration timestamp (typically 6 hours from fetch)';

COMMENT ON COLUMN google_search_console_cache.top_queries IS 'Top performing search queries with clicks, impressions, CTR, and position';
COMMENT ON COLUMN google_search_console_cache.expires_at IS 'Cache expiration timestamp (typically 24 hours from fetch)';

COMMENT ON COLUMN google_analytics_cache.page_url IS 'Specific page URL or NULL for aggregate data';
COMMENT ON COLUMN google_analytics_cache.expires_at IS 'Cache expiration timestamp (typically 24 hours from fetch)';

COMMENT ON COLUMN content_performance.performance_score IS 'Composite score (0-100) calculated from GSC and GA metrics';
COMMENT ON COLUMN content_performance.trend_informed IS 'Indicates if this content was created based on trending data';
COMMENT ON COLUMN content_performance.gsc_queries IS 'Detailed query performance data from Search Console';
