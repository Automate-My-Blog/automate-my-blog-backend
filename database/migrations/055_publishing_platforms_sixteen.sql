-- Migration 055: Expand publishing_platform_connections to support all 16 platform keys
-- Frontend uses: wordpress, medium, substack, ghost, webflow, squarespace, wix, shopify,
-- hubspot, contentful, sanity, drupal, hugo, jekyll, nextjs, astro

-- Drop existing CHECK constraint (name may vary by PG version)
ALTER TABLE publishing_platform_connections
  DROP CONSTRAINT IF EXISTS publishing_platform_connections_platform_check;

-- Allow any platform string; application validates against PLATFORM_KEYS
-- Using a named constraint so we can extend again later if needed
ALTER TABLE publishing_platform_connections
  ADD CONSTRAINT chk_publishing_platform_key CHECK (
    platform IN (
      'wordpress', 'medium', 'substack', 'ghost', 'webflow', 'squarespace', 'wix', 'shopify',
      'hubspot', 'contentful', 'sanity', 'drupal', 'hugo', 'jekyll', 'nextjs', 'astro'
    )
  );

COMMENT ON CONSTRAINT chk_publishing_platform_key ON publishing_platform_connections IS 'Platform keys matching frontend integration handoff (16 platforms)';
