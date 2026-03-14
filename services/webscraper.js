import axios from 'axios';
import * as cheerio from 'cheerio';
import xml2js from 'xml2js';

export class WebScraperService {
  constructor() {
    this.timeout = parseInt(process.env.ANALYSIS_TIMEOUT, 10) || 10000;
    this.userAgent = process.env.USER_AGENT || 'AutoBlog Bot 1.0';
    this.waitAfterLoadMs = Math.max(0, parseInt(process.env.SCRAPE_WAIT_AFTER_LOAD_MS, 10)) || 2000;
    this.waitForContentTimeoutMs = Math.max(2000, parseInt(process.env.SCRAPE_WAIT_FOR_CONTENT_TIMEOUT_MS, 10)) || 8000;
    this.fastPathTimeoutMs = Math.max(2000, parseInt(process.env.SCRAPE_FAST_PATH_TIMEOUT_MS, 10)) || 5000;
    this.fastPathMinContentChars = Math.max(200, parseInt(process.env.SCRAPE_FAST_PATH_MIN_CONTENT_CHARS, 10)) || 500;
    this.browserLaunchTimeoutMs = Math.max(5000, parseInt(process.env.SCRAPE_BROWSER_LAUNCH_TIMEOUT_MS, 10)) || 25000;
  }

  /**
   * Notify optional progress callback. Used for granular stream updates during scrape.
   * @param {Function|undefined} onScrapeProgress - (phase, message, detail?) => void
   * @param {string} phase - e.g. 'validate', 'browser-launch', 'extract'
   * @param {string} message - Human-readable status
   * @param {object} [detail] - Optional extra (e.g. { url }
   */
  _scrapeProgress(onScrapeProgress, phase, message, detail = {}) {
    if (typeof onScrapeProgress === 'function') {
      try {
        onScrapeProgress(phase, message, detail);
      } catch (e) {
        console.warn('[webscraper] onScrapeProgress error:', e?.message);
      }
    }
  }

  /**
   * Scrape website content with fallback methods.
   * @param {string} url - Page URL
   * @param {{ onScrapeProgress?: (phase: string, message: string, detail?: object) => void }} [opts] - Optional progress callback for stream
   */
  async scrapeWebsite(url, opts = {}) {
    const { onScrapeProgress } = opts;
    try {
      this._scrapeProgress(onScrapeProgress, 'start', 'Starting website scrape', { url });

      this._scrapeProgress(onScrapeProgress, 'validate', 'Validating URL');
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new Error('Invalid URL protocol. Only HTTP and HTTPS are supported.');
      }

      // Fast path: try HTTP + Cheerio first for static/SSR sites (short timeout)
      this._scrapeProgress(onScrapeProgress, 'method-cheerio-fast', 'Trying fast path (HTTP)');
      try {
        const response = await axios.get(url, {
          headers: {
            'User-Agent': this.userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          timeout: this.fastPathTimeoutMs,
          maxRedirects: 5,
          validateStatus: (status) => status === 200
        });
        if (response.data && typeof response.data === 'string' && response.data.includes('</')) {
          const extracted = this._extractContentAndCTAsFromHTML(response.data, url);
          const bodyText = (extracted.content || '').trim();
          if (bodyText.length >= this.fastPathMinContentChars) {
            console.log(`✅ Fast path succeeded: ${bodyText.length} chars`);
            const content = {
              title: extracted.title,
              metaDescription: extracted.metaDescription,
              content: extracted.content,
              headings: extracted.headings,
              url,
              internalLinks: extracted.internalLinks || [],
              externalLinks: [],
              ctas: extracted.ctas || [],
              socialHandles: extracted.socialHandles || {},
              extractionMethod: 'cheerio_fast_path'
            };
            return this.cleanContent(content);
          }
        }
      } catch (fastPathError) {
        // Expected for JS-heavy or slow sites; fall through
      }

      // Cloudflare Browser Rendering crawl (multi-page, markdown); skip if not configured
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
      const apiToken = process.env.CLOUDFLARE_BROWSER_RENDERING_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
      if (accountId && apiToken) {
        this._scrapeProgress(onScrapeProgress, 'cf-request', 'Requesting crawl (Cloudflare)');
        try {
          return await this.scrapeWithCloudflareCrawl(url, opts);
        } catch (cfError) {
          console.warn('⚠️ Cloudflare crawl failed, falling back to Cheerio:', cfError?.message || cfError);
          this._scrapeProgress(onScrapeProgress, 'fallback-cheerio', 'Trying Cheerio (static HTML)');
        }
      } else {
        this._scrapeProgress(onScrapeProgress, 'method-cheerio-fallback', 'Cloudflare not configured, using Cheerio');
      }

      return await this.scrapeWithCheerio(url, opts);
    } catch (error) {
      console.error('Website scraping error:', error);
      throw new Error(`Failed to scrape website: ${error.message}`);
    }
  }

  /** Default max pages per crawl (configurable via env). */
  static get CLOUDFLARE_CRAWL_PAGE_LIMIT() {
    return Math.min(20, Math.max(1, parseInt(process.env.CLOUDFLARE_CRAWL_PAGE_LIMIT, 10) || 5));
  }

  /**
   * Scrape via Cloudflare Browser Rendering /crawl API (multi-page, markdown + optional HTML for CTAs).
   * @param {string} url - Start URL (homepage)
   * @param {{ onScrapeProgress?: (phase: string, message: string, detail?: object) => void }} [opts]
   * @returns {Promise<object>} Same shape as scrapeWebsite: title, metaDescription, content, headings, ctas, socialHandles, ...
   */
  async scrapeWithCloudflareCrawl(url, opts = {}) {
    const { onScrapeProgress } = opts;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_BROWSER_RENDERING_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiToken) {
      throw new Error('Cloudflare Browser Rendering not configured (CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_BROWSER_RENDERING_API_TOKEN)');
    }

    const limit = this.constructor.CLOUDFLARE_CRAWL_PAGE_LIMIT;
    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/crawl`;

    const body = {
      url,
      limit,
      formats: ['markdown', 'html'],
      render: true,
      options: {
        excludePatterns: [
          '**/blog/**',
          '**/posts/**',
          '**/news/**',
          '**/articles/**',
          '**/tag/**',
          '**/category/**'
        ]
      }
    };

    this._scrapeProgress(onScrapeProgress, 'cf-request', 'Starting crawl job');
    const startRes = await axios.post(baseUrl, body, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000,
      validateStatus: (s) => s === 200
    }).catch((err) => {
      throw new Error(err.response?.data?.errors?.[0]?.message || err.message || 'Cloudflare crawl start failed');
    });

    const jobId = startRes.data?.result;
    if (!jobId) {
      throw new Error('Cloudflare crawl did not return job id');
    }

    this._scrapeProgress(onScrapeProgress, 'cf-wait', 'Waiting for crawl to complete');
    const pollIntervalMs = 3000;
    const maxAttempts = 60;
    let result;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const getRes = await axios.get(`${baseUrl}/${jobId}`, {
        params: { limit: 1 },
        headers: { Authorization: `Bearer ${apiToken}` },
        timeout: 10000,
        validateStatus: (s) => s === 200
      }).catch((err) => {
        throw new Error(err.response?.data?.errors?.[0]?.message || err.message || 'Cloudflare crawl status failed');
      });
      const status = getRes.data?.result?.status;
      if (status !== 'running' && status !== undefined) {
        result = getRes.data.result;
        break;
      }
      if (i === maxAttempts - 1) {
        throw new Error('Cloudflare crawl did not complete within timeout');
      }
    }

    if (result?.status === 'errored' || result?.status === 'cancelled_due_to_limits' || result?.status === 'cancelled_due_to_timeout') {
      throw new Error(`Cloudflare crawl ${result.status}`);
    }

    this._scrapeProgress(onScrapeProgress, 'cf-parse', 'Processing crawl results');
    const records = result?.records || [];
    const completed = records.filter((r) => r.status === 'completed');
    if (completed.length === 0) {
      throw new Error('Cloudflare crawl returned no completed pages');
    }

    const startOrigin = new URL(url).origin;
    const firstPage = completed.find((r) => {
      try {
        return new URL(r.url).origin === startOrigin && (r.url === url || r.url.replace(/\/$/, '') === url.replace(/\/$/, ''));
      } catch {
        return false;
      }
    }) || completed[0];

    const title = firstPage?.metadata?.title ?? firstPage?.url ?? url;
    const metaDescription = firstPage?.metadata?.description ?? '';

    const contentParts = [];
    const allHeadings = [];
    const allCtas = [];
    const socialHandlesAcc = {};

    for (const record of completed) {
      const pageUrl = record.url || url;
      const md = record.markdown || '';
      if (md) {
        contentParts.push(`## ${record.metadata?.title || pageUrl}\n\n${md}`);
        const headingMatches = md.matchAll(/^#{1,6}\s+(.+)$/gm);
        for (const m of headingMatches) {
          const level = (m[0].match(/^#+/) || [''])[0].length;
          allHeadings.push({ text: m[1].trim(), level, id: '' });
        }
      }
      if (record.html) {
        try {
          const extracted = this._extractContentAndCTAsFromHTML(record.html, pageUrl);
          const ctas = (extracted.ctas || []).map((cta) => ({
            ...cta,
            page_url: pageUrl
          }));
          allCtas.push(...ctas);
          if (extracted.socialHandles && typeof extracted.socialHandles === 'object') {
            Object.assign(socialHandlesAcc, extracted.socialHandles);
          }
        } catch (e) {
          console.warn('[webscraper] CTA/social extract failed for', pageUrl, e?.message);
        }
      }
    }

    const content = contentParts.join('\n\n');
    const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;
    const contentOut = {
      title: title.trim(),
      metaDescription: metaDescription.trim(),
      content,
      wordCount,
      headings: allHeadings.length ? allHeadings : [{ text: title, level: 1, id: '' }],
      url,
      internalLinks: [],
      externalLinks: [],
      ctas: allCtas,
      socialHandles: socialHandlesAcc,
      extractionMethod: 'cloudflare_crawl'
    };
    return this.cleanContent(contentOut);
  }

  /**
   * Parse a URL and return { platform, handle } if it's a known social profile URL, else null.
   * Supports: Twitter/X, LinkedIn, Facebook, Instagram, YouTube, TikTok, GitHub, Reddit, Pinterest,
   * Medium, Substack, Mastodon, Threads, Bluesky, Tumblr, Vimeo, Dribbble, Behance, SoundCloud,
   * Twitch, Telegram, Patreon, Linktree, Snapchat, Ko-fi, Buy Me a Coffee, Discord.
   * @param {string} href - Absolute or relative URL
   * @param {string} baseUrl - Page base URL for resolving relative hrefs
   * @returns {{ platform: string, handle: string } | null}
   */
  _parseSocialHandle(href, baseUrl) {
    if (!href || typeof href !== 'string') return null;
    let absolute;
    let host = '';
    try {
      const u = new URL(href, baseUrl || 'https://example.com');
      absolute = u.href;
      host = u.hostname.toLowerCase();
    } catch (e) {
      return null;
    }
    const lower = absolute.toLowerCase();
    // Twitter/X: twitter.com/User, x.com/User (host must be twitter.com or x.com)
    if ((host === 'twitter.com' || host === 'x.com')) {
      const m = absolute.match(/(?:twitter\.com|x\.com)\/([^/?]+)/i);
      if (m && m[1] && !['intent', 'share', 'home', 'search', 'hashtag'].includes(m[1].toLowerCase())) {
        const handle = m[1].startsWith('@') ? m[1] : `@${m[1]}`;
        return { platform: 'twitter', handle };
      }
    }
    // LinkedIn: linkedin.com/company/slug or linkedin.com/in/slug
    if (host.replace(/^www\./, '') === 'linkedin.com') {
      const companyMatch = absolute.match(/linkedin\.com\/company\/([^/?]+)/i);
      if (companyMatch && companyMatch[1]) return { platform: 'linkedin', handle: `company/${companyMatch[1]}` };
      const inMatch = absolute.match(/linkedin\.com\/in\/([^/?]+)/i);
      if (inMatch && inMatch[1]) return { platform: 'linkedin', handle: `in/${inMatch[1]}` };
    }
    // Facebook: facebook.com/PageName, fb.com/PageName
    if (['facebook.com', 'www.facebook.com', 'fb.com', 'fb.me'].includes(host)) {
      const m = absolute.match(/(?:facebook\.com|fb\.com|fb\.me)\/([^/?]+)/i);
      if (m && m[1] && !['sharer', 'share', 'dialog', 'plugins', 'login', 'pages'].includes(m[1].toLowerCase())) {
        return { platform: 'facebook', handle: m[1] };
      }
    }
    // Instagram: instagram.com/username
    if (host.replace(/^www\./, '') === 'instagram.com') {
      const m = absolute.match(/instagram\.com\/([^/?]+)/i);
      if (m && m[1] && !['p/', 'reel/', 'stories/', 'explore', 'accounts'].includes(m[1].toLowerCase())) {
        return { platform: 'instagram', handle: m[1] };
      }
    }
    // YouTube: youtube.com/c/Name, youtube.com/@handle, youtube.com/channel/ID
    if (host.replace(/^www\./, '') === 'youtube.com') {
      const cMatch = absolute.match(/youtube\.com\/c\/([^/?]+)/i);
      if (cMatch && cMatch[1]) return { platform: 'youtube', handle: `c/${cMatch[1]}` };
      const atMatch = absolute.match(/youtube\.com\/@([^/?]+)/i);
      if (atMatch && atMatch[1]) return { platform: 'youtube', handle: `@${atMatch[1]}` };
      const chMatch = absolute.match(/youtube\.com\/channel\/([^/?]+)/i);
      if (chMatch && chMatch[1]) return { platform: 'youtube', handle: `channel/${chMatch[1]}` };
    }
    // TikTok: tiktok.com/@username
    if (host.replace(/^www\./, '') === 'tiktok.com') {
      const m = absolute.match(/tiktok\.com\/@([^/?]+)/i);
      if (m && m[1]) return { platform: 'tiktok', handle: `@${m[1]}` };
    }
    // GitHub: github.com/username or github.com/org/repo (first path segment)
    if (host.replace(/^www\./, '') === 'github.com') {
      const m = absolute.match(/github\.com\/([^/?]+)/i);
      if (m && m[1] && !['settings', 'orgs', 'search', 'login', 'signup', 'about', 'blog', 'contact', 'explore', 'topics', 'features', 'enterprise', 'pricing', 'mobile', 'site', 'brand'].includes(m[1].toLowerCase())) {
        return { platform: 'github', handle: m[1] };
      }
    }
    // Reddit: reddit.com/user/username, reddit.com/u/username
    if (host.replace(/^www\./, '') === 'reddit.com' && (lower.includes('/user/') || lower.includes('/u/'))) {
      const m = absolute.match(/reddit\.com\/(?:user|u)\/([^/?]+)/i);
      if (m && m[1] && !['popular', 'all', 'mine'].includes(m[1].toLowerCase())) {
        return { platform: 'reddit', handle: m[1] };
      }
    }
    // Pinterest: pinterest.com/username/
    if ((host === 'pinterest.com' || host === 'www.pinterest.com' || host === 'pinterest.co.uk') && lower.includes('/')) {
      const m = absolute.match(/pinterest\.(?:com|co\.uk)\/([^/?]+)/i);
      if (m && m[1] && !['pin', 'search', 'about', 'business', 'help', 'login', 'signup'].includes(m[1].toLowerCase())) {
        return { platform: 'pinterest', handle: m[1] };
      }
    }
    // Medium: medium.com/@username
    if (host.replace(/^www\./, '') === 'medium.com') {
      const atMatch = absolute.match(/medium\.com\/@([^/?]+)/i);
      if (atMatch && atMatch[1]) return { platform: 'medium', handle: `@${atMatch[1]}` };
      const m = absolute.match(/medium\.com\/([^/?]+)/i);
      if (m && m[1] && !['me', 'about', 'subscribe', 'search', 'topic', 'policy', 'terms'].includes(m[1].toLowerCase())) {
        return { platform: 'medium', handle: m[1] };
      }
    }
    // Substack: substack.com/@username or username.substack.com
    if (host === 'substack.com' && lower.includes('/@')) {
      const m = absolute.match(/substack\.com\/@([^/?]+)/i);
      if (m && m[1]) return { platform: 'substack', handle: `@${m[1]}` };
    }
    if (host.endsWith('.substack.com')) {
      const m = host.match(/^([a-z0-9-]+)\.substack\.com$/i);
      if (m && m[1] && m[1].length > 1) return { platform: 'substack', handle: m[1] };
    }
    // Mastodon: instance e.g. mastodon.social/@user, mstdn.social/@user, mas.to/@user
    try {
      const mastodonHost = new URL(absolute).hostname.toLowerCase();
      if ((mastodonHost.includes('mastodon') || mastodonHost.includes('mstdn') || mastodonHost === 'mas.to') && lower.includes('/@')) {
        const atMatch = absolute.match(/\/(@[a-z0-9_.]+)\/?$/i);
        if (atMatch && atMatch[1]) {
          return { platform: 'mastodon', handle: `${mastodonHost}/${atMatch[1]}` };
        }
      }
    } catch (e) { /* ignore */ }
    // Threads: threads.net/@user
    if (host === 'threads.net') {
      const m = absolute.match(/threads\.net\/@([^/?]+)/i);
      if (m && m[1]) return { platform: 'threads', handle: `@${m[1]}` };
    }
    // Bluesky: bsky.app/profile/handle.bsky.social or bsky.app/profile/handle
    if (host === 'bsky.app' && lower.includes('/profile/')) {
      const m = absolute.match(/bsky\.app\/profile\/([^/?]+)/i);
      if (m && m[1]) return { platform: 'bluesky', handle: m[1] };
    }
    // Tumblr: username.tumblr.com or tumblr.com/blog/username
    if (host.endsWith('.tumblr.com')) {
      const m = host.match(/^([a-z0-9-]+)\.tumblr\.com$/i);
      if (m && m[1] && !['www', 'api', 'assets'].includes(m[1].toLowerCase())) {
        return { platform: 'tumblr', handle: m[1] };
      }
    }
    if (host.replace(/^www\./, '') === 'tumblr.com' && lower.includes('/blog/')) {
      const m = absolute.match(/tumblr\.com\/blog\/([^/?]+)/i);
      if (m && m[1]) return { platform: 'tumblr', handle: m[1] };
    }
    // Vimeo: vimeo.com/username or vimeo.com/user/123
    if (host.replace(/^www\./, '') === 'vimeo.com') {
      const m = absolute.match(/vimeo\.com\/([^/?]+)/i);
      if (m && m[1] && !['channels', 'groups', 'album', 'videos', 'ondemand', 'help', 'blog', 'about'].includes(m[1].toLowerCase())) {
        return { platform: 'vimeo', handle: m[1] };
      }
    }
    // Dribbble: dribbble.com/username
    if (host.replace(/^www\./, '') === 'dribbble.com') {
      const m = absolute.match(/dribbble\.com\/([^/?]+)/i);
      if (m && m[1] && !['shots', 'designers', 'jobs', 'about', 'contact', 'api', 'search'].includes(m[1].toLowerCase())) {
        return { platform: 'dribbble', handle: m[1] };
      }
    }
    // Behance: behance.net/username
    if (host.replace(/^www\./, '') === 'behance.net') {
      const m = absolute.match(/behance\.net\/([^/?]+)/i);
      if (m && m[1] && !['gallery', 'search', 'jobs', 'adobe', 'api'].includes(m[1].toLowerCase())) {
        return { platform: 'behance', handle: m[1] };
      }
    }
    // SoundCloud: soundcloud.com/username
    if (host.replace(/^www\./, '') === 'soundcloud.com') {
      const m = absolute.match(/soundcloud\.com\/([^/?]+)/i);
      if (m && m[1] && !['you', 'discover', 'stream', 'search', 'pages', 'embed', 'player', 'api'].includes(m[1].toLowerCase())) {
        return { platform: 'soundcloud', handle: m[1] };
      }
    }
    // Twitch: twitch.tv/username
    if (host.replace(/^www\./, '') === 'twitch.tv') {
      const m = absolute.match(/twitch\.tv\/([^/?]+)/i);
      if (m && m[1] && !['directory', 'videos', 'search', 'p', 'settings', 'login', 'signup'].includes(m[1].toLowerCase())) {
        return { platform: 'twitch', handle: m[1] };
      }
    }
    // Telegram: t.me/username
    if (host === 't.me') {
      const m = absolute.match(/t\.me\/([a-z0-9_]+)/i);
      if (m && m[1] && m[1].length > 4) return { platform: 'telegram', handle: m[1] };
    }
    // Patreon: patreon.com/username
    if (host.replace(/^www\./, '') === 'patreon.com') {
      const m = absolute.match(/patreon\.com\/([^/?]+)/i);
      if (m && m[1] && !['home', 'login', 'signup', 'search', 'explore', 'creators', 'c'].includes(m[1].toLowerCase())) {
        return { platform: 'patreon', handle: m[1] };
      }
    }
    // Linktree: linktr.ee/username
    if (host === 'linktr.ee') {
      const m = absolute.match(/linktr\.ee\/([^/?]+)/i);
      if (m && m[1]) return { platform: 'linktree', handle: m[1] };
    }
    // Snapchat: snapchat.com/add/username
    if (host.replace(/^www\./, '') === 'snapchat.com' && lower.includes('/add/')) {
      const m = absolute.match(/snapchat\.com\/add\/([^/?]+)/i);
      if (m && m[1]) return { platform: 'snapchat', handle: m[1] };
    }
    // Ko-fi: ko-fi.com/username
    if (host.replace(/^www\./, '') === 'ko-fi.com') {
      const m = absolute.match(/ko-fi\.com\/([^/?]+)/i);
      if (m && m[1] && !['home', 'login', 'signup', 'donate', 'shop'].includes(m[1].toLowerCase())) {
        return { platform: 'kofi', handle: m[1] };
      }
    }
    // Buy Me a Coffee: buymeacoffee.com/username
    if (host.replace(/^www\./, '') === 'buymeacoffee.com') {
      const m = absolute.match(/buymeacoffee\.com\/([^/?]+)/i);
      if (m && m[1] && !['buy', 'login', 'signup', 'explore'].includes(m[1].toLowerCase())) {
        return { platform: 'buymeacoffee', handle: m[1] };
      }
    }
    // Discord: discord.com/users/id
    if (host === 'discord.com' && lower.includes('/users/')) {
      const m = absolute.match(/discord\.com\/users\/([^/?]+)/i);
      if (m && m[1]) return { platform: 'discord', handle: m[1] };
    }
    return null;
  }

  /**
   * Build social_handles object from array of { platform, handle }. Dedupes by platform (first wins).
   * @param {Array<{ platform: string, handle: string }>} pairs
   * @returns {Record<string, string[]>}
   */
  _buildSocialHandlesObject(pairs) {
    const byPlatform = {};
    const seen = new Set();
    for (const { platform, handle } of pairs) {
      const key = `${platform}:${handle}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!byPlatform[platform]) byPlatform[platform] = [];
      byPlatform[platform].push(handle);
    }
    return byPlatform;
  }

  /**
   * Shared HTML → content + CTAs extraction (Cheerio). Used by scrapeWithCheerio and Cloudflare crawl.
   * @param {string} html - Raw HTML
   * @param {string} url - Page URL (for internal links and context)
   * @returns {{ title: string, metaDescription: string, content: string, headings: Array<{text:string,level:number,id:string}>, internalLinks: Array<object>, ctas: Array<object>, socialHandles: object }}
   */
  _extractContentAndCTAsFromHTML(html, url) {
    const $ = cheerio.load(html);

    // Collect social from meta and JSON-LD before removing script tags
    const earlySocialPairs = [];
    const twitterCreator = $('meta[name="twitter:creator"]').attr('content');
    if (twitterCreator && typeof twitterCreator === 'string') {
      const handle = twitterCreator.trim().startsWith('@') ? twitterCreator.trim() : `@${twitterCreator.trim()}`;
      if (handle.length > 1) earlySocialPairs.push({ platform: 'twitter', handle });
    }
    $('script[type="application/ld+json"]').each((_i, el) => {
      const text = $(el).html();
      if (!text) return;
      try {
        const data = JSON.parse(text);
        const sameAs = Array.isArray(data.sameAs) ? data.sameAs : (data['@graph'] && Array.isArray(data['@graph']) ? data['@graph'].flatMap(g => Array.isArray(g.sameAs) ? g.sameAs : []) : []);
        sameAs.forEach(link => {
          if (typeof link !== 'string') return;
          const social = this._parseSocialHandle(link, url);
          if (social) earlySocialPairs.push(social);
        });
      } catch (e) { /* ignore invalid JSON */ }
    });

    $('script, style, .cookie-banner, .popup, .modal, .advertisement, .social-share, .comments').remove();

    const title = $('title').text().trim() || '';
    const metaDescription = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';

    const mainSelectors = [
      'main', '[role="main"]', '.main-content', '.content', '.page-content',
      'article', '.post-content', '.entry-content', '.blog-post', '.post-body',
      '.single-post', '[data-post]', '.content-area', '.post', '.article-content'
    ];
    let mainContent = '';
    for (const selector of mainSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        const text = element.text().trim();
        if (text.length > 100) {
          mainContent = text;
          break;
        }
      }
    }
    if (!mainContent || mainContent.length < 100) {
      const paragraphs = [];
      $('p').each((i, el) => {
        const text = $(el).text().trim();
        if (text.length > 20) paragraphs.push(text);
      });
      if (paragraphs.length > 0) mainContent = paragraphs.join(' ');
    }
    if (!mainContent || mainContent.length < 100) {
      $('nav, header, footer, aside, .sidebar, .menu, .navigation').remove();
      mainContent = $('body').text().trim();
    }

    const headings = [];
    $('h1, h2, h3, h4, h5, h6').each((i, el) => {
      if (i >= 15) return;
      const text = $(el).text().trim();
      const level = parseInt(el.tagName.charAt(1), 10) || 1;
      if (text) headings.push({ text, level, id: $(el).attr('id') || '' });
    });

    let domain = '';
    try {
      domain = new URL(url).hostname;
    } catch (e) { /* ignore */ }
    const internalLinks = [];
    const socialPairs = [];
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      const linkText = $(el).text().trim();
      if (!href) return;
      try {
        const linkUrl = new URL(href, url);
        if (linkUrl.hostname === domain || linkUrl.hostname.replace('www.', '') === domain.replace('www.', '')) {
          if (linkText) internalLinks.push({ url: linkUrl.href, text: linkText, context: 'content' });
        } else {
          const social = this._parseSocialHandle(href, url);
          if (social) socialPairs.push(social);
        }
      } catch (err) { /* ignore */ }
    });
    socialPairs.push(...earlySocialPairs);
    const socialHandles = this._buildSocialHandlesObject(socialPairs);

    const ctas = [];
    const ctaSelectors = [
      'button',
      'a[class*="btn"]', 'a[class*="button"]', 'a[class*="cta"]',
      '[data-cta]', '.cta', '.call-to-action',
      'input[type="submit"]', '[role="button"]'
    ];
    ctaSelectors.forEach(selector => {
      $(selector).each((i, el) => {
        const text = $(el).text().trim();
        const href = $(el).attr('href') || '';
        if (text && text.length > 0 && text.length < 100) {
          ctas.push({
            text,
            href,
            type: this.classifyCTA(text, href),
            placement: 'main_content',
            tagName: el.tagName ? el.tagName.toLowerCase() : ''
          });
        }
      });
    });

    return { title, metaDescription, content: mainContent, headings, internalLinks, socialHandles, ctas };
  }

  /**
   * Scrape with Axios + Cheerio for static content. Uses shared _extractContentAndCTAsFromHTML.
   * @param {string} url
   * @param {{ onScrapeProgress?: (phase: string, message: string, detail?: object) => void }} [opts]
   */
  async scrapeWithCheerio(url, opts = {}) {
    const { onScrapeProgress } = opts;
    try {
      console.log('🔧 Using enhanced Cheerio fallback for:', url);
      this._scrapeProgress(onScrapeProgress, 'fetch', 'Fetching page with HTTP');

      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive'
        },
        timeout: this.timeout,
        maxRedirects: 5
      });

      this._scrapeProgress(onScrapeProgress, 'parse-html', 'Parsing HTML');
      this._scrapeProgress(onScrapeProgress, 'extract', 'Extracting text and structure');
      const extracted = this._extractContentAndCTAsFromHTML(response.data, url);
      this._scrapeProgress(onScrapeProgress, 'ctas', 'Extracting CTAs');

      const wordCount = extracted.content ? extracted.content.split(/\s+/).filter(w => w.length > 0).length : 0;
      const content = {
        title: extracted.title,
        metaDescription: extracted.metaDescription,
        content: extracted.content,
        headings: extracted.headings,
        url,
        wordCount,
        internalLinks: extracted.internalLinks || [],
        externalLinks: [],
        ctas: extracted.ctas || [],
        socialHandles: extracted.socialHandles || {},
        extractionMethod: 'cheerio_enhanced'
      };

      console.log(`📊 Cheerio extraction results: ${wordCount} words, ${(extracted.internalLinks || []).length} internal links, ${(extracted.ctas || []).length} CTAs, ${Object.keys(extracted.socialHandles || {}).length} social platforms`);
      return this.cleanContent(content);
    } catch (error) {
      console.error('Enhanced Cheerio extraction failed:', error);
      throw new Error(`Enhanced HTTP scraping failed: ${error.message}`);
    }
  }

  /**
   * Discover blog posts from XML sitemaps
   */
  async discoverFromSitemap(baseUrl) {
    try {
      console.log(`🗺️ Discovering content from sitemaps: ${baseUrl}`);
      
      const urlObj = new URL(baseUrl);
      const domain = `${urlObj.protocol}//${urlObj.host}`;
      
      // Common sitemap locations
      const sitemapUrls = [
        `${domain}/sitemap.xml`,
        `${domain}/sitemap_index.xml`,
        `${domain}/blog/sitemap.xml`,
        `${domain}/news/sitemap.xml`,
        `${domain}/wp-sitemap.xml`,
        `${domain}/sitemap-index.xml`
      ];
      
      const discoveredPosts = [];
      const sitemapsFound = [];
      
      for (const sitemapUrl of sitemapUrls) {
        try {
          console.log(`🔍 Checking sitemap: ${sitemapUrl}`);
          
          const response = await axios.get(sitemapUrl, {
            headers: { 'User-Agent': this.userAgent },
            timeout: this.timeout
          });
          
          if (response.data && response.data.includes('<urlset') || response.data.includes('<sitemapindex')) {
            console.log(`✅ Found sitemap: ${sitemapUrl}`);
            sitemapsFound.push(sitemapUrl);
            
            const parser = new xml2js.Parser();
            const result = await parser.parseStringPromise(response.data);
            
            // Handle regular sitemap
            if (result.urlset && result.urlset.url) {
              const urls = result.urlset.url;
              
              for (const urlEntry of urls) {
                const url = urlEntry.loc[0];
                const lastmod = urlEntry.lastmod ? urlEntry.lastmod[0] : null;
                const priority = urlEntry.priority ? parseFloat(urlEntry.priority[0]) : 0.5;
                const changefreq = urlEntry.changefreq ? urlEntry.changefreq[0] : null;
                
                // Filter for blog posts
                if (this.isBlogPostUrl(url)) {
                  console.log(`📄 Found blog post: ${url}`);
                  discoveredPosts.push({
                    url,
                    title: this.extractTitleFromUrl(url),
                    lastModified: lastmod,
                    priority,
                    changeFreq: changefreq,
                    discoveredFrom: 'sitemap',
                    discoverySource: sitemapUrl,
                    isLikelyPost: true
                  });
                }
              }
            }
            
            // Handle sitemap index
            if (result.sitemapindex && result.sitemapindex.sitemap) {
              console.log('📚 Found sitemap index, processing sub-sitemaps...');
              const subSitemaps = result.sitemapindex.sitemap;
              
              for (const subSitemap of subSitemaps.slice(0, 10)) { // Limit to 10 sub-sitemaps
                const subSitemapUrl = subSitemap.loc[0];
                try {
                  console.log(`  🔍 Processing sub-sitemap: ${subSitemapUrl}`);
                  const subResponse = await axios.get(subSitemapUrl, {
                    headers: { 'User-Agent': this.userAgent },
                    timeout: this.timeout
                  });
                  
                  const subResult = await parser.parseStringPromise(subResponse.data);
                  if (subResult.urlset && subResult.urlset.url) {
                    for (const urlEntry of subResult.urlset.url) {
                      const url = urlEntry.loc[0];
                      if (this.isBlogPostUrl(url)) {
                        discoveredPosts.push({
                          url,
                          title: this.extractTitleFromUrl(url),
                          lastModified: urlEntry.lastmod ? urlEntry.lastmod[0] : null,
                          priority: urlEntry.priority ? parseFloat(urlEntry.priority[0]) : 0.5,
                          changeFreq: urlEntry.changefreq ? urlEntry.changefreq[0] : null,
                          discoveredFrom: 'sitemap',
                          discoverySource: subSitemapUrl,
                          isLikelyPost: true
                        });
                      }
                    }
                  }
                } catch (subError) {
                  console.log(`  ❌ Failed to process sub-sitemap: ${subError.message}`);
                }
                
                // Add delay between sitemap requests
                await new Promise(resolve => setTimeout(resolve, 500));
              }
            }
            
            // Break after first successful sitemap to avoid duplicates
            break;
            
          }
        } catch (error) {
          console.log(`❌ Sitemap ${sitemapUrl} not accessible: ${error.message}`);
        }
      }
      
      // Deduplicate by URL
      const uniquePosts = Array.from(new Map(
        discoveredPosts.map(post => [post.url, post])
      ).values());
      
      console.log(`🗺️ Sitemap discovery complete: Found ${sitemapsFound.length} sitemaps, ${uniquePosts.length} blog posts`);
      
      return {
        sitemapsFound,
        blogPosts: uniquePosts,
        totalPostsFound: uniquePosts.length
      };
      
    } catch (error) {
      console.error('Sitemap discovery error:', error);
      return {
        sitemapsFound: [],
        blogPosts: [],
        totalPostsFound: 0,
        error: error.message
      };
    }
  }

  /**
   * Check if a URL looks like a blog post
   */
  isBlogPostUrl(url) {
    const urlLower = url.toLowerCase();
    
    // Blog post patterns
    const blogPatterns = [
      /\/blog\/[^\/]+$/,           // /blog/post-name
      /\/news\/[^\/]+$/,           // /news/article-name
      /\/articles\/[^\/]+$/,       // /articles/article-name
      /\/posts\/[^\/]+$/,          // /posts/post-name
      /\/insights\/[^\/]+$/,       // /insights/insight-name
      /\/resources\/[^\/]+$/,      // /resources/resource-name
      /\/stories\/[^\/]+$/,        // /stories/story-name
      /\/content\/[^\/]+$/,        // /content/content-name
      /\/\d{4}\/\d{2}\/[^\/]+$/,   // /2024/01/post-name (date-based)
      /\/\d{4}\/[^\/]+$/           // /2024/post-name
    ];
    
    // Exclude patterns (pages that are NOT blog posts)
    const excludePatterns = [
      /\/(blog|news|articles|posts|insights|resources|stories)\/?\s*$/i, // Index pages
      /\/(tag|category|archive|page|wp-admin|admin|login|register)/i,    // Admin/utility pages
      /\/(contact|about|privacy|terms|faq|help|support)/i,               // Static pages
      /\.(css|js|jpg|jpeg|png|gif|svg|pdf|zip|xml|json|txt)$/i,         // File extensions
      /\/feed\/|\/rss\.xml|\/sitemap/i                                   // Feeds and sitemaps
    ];
    
    // Check exclude patterns first
    for (const pattern of excludePatterns) {
      if (pattern.test(urlLower)) {
        return false;
      }
    }
    
    // Check blog patterns
    for (const pattern of blogPatterns) {
      if (pattern.test(urlLower)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Extract a readable title from URL
   */
  extractTitleFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const segments = pathname.split('/').filter(s => s.length > 0);
      const lastSegment = segments[segments.length - 1];
      
      // Convert URL slug to title
      return lastSegment
        .replace(/-/g, ' ')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase())
        .trim();
    } catch (error) {
      return 'Unknown Title';
    }
  }

  /**
   * Discover blog pages and content across the website
   */
  async discoverBlogPages(baseUrl) {
    try {
      console.log(`🔍 Discovering blog content on: ${baseUrl}`);
      
      // Step 1: Try sitemap discovery first (best for SPAs and comprehensive coverage)
      console.log('🗺️ Phase 1: Sitemap Discovery');
      const sitemapResult = await this.discoverFromSitemap(baseUrl);
      
      // Step 2: Traditional page scraping (for sites without sitemaps or additional discovery)
      console.log('📄 Phase 2: Traditional Page Discovery');
      
      // First, scrape the homepage to look for blog links
      const homepageContent = await this.scrapeWebsite(baseUrl);
      
      // Common blog URL patterns to check
      const blogPatterns = [
        '/blog/',
        '/news/',
        '/articles/',
        '/posts/',
        '/insights/',
        '/resources/',
        '/content/',
        '/stories/'
      ];
      
      const urlObj = new URL(baseUrl);
      const baseHostUrl = `${urlObj.protocol}//${urlObj.host}`;
      
      // Also try www version if original doesn't have it, and non-www if it does
      const alternativeUrls = [];
      if (urlObj.host.startsWith('www.')) {
        alternativeUrls.push(`${urlObj.protocol}//${urlObj.host.replace('www.', '')}`);
      } else {
        alternativeUrls.push(`${urlObj.protocol}//www.${urlObj.host}`);
      }
      
      const blogUrls = [];
      const discoveredPosts = [];
      
      // Check common blog directory patterns on both primary and alternative URLs
      for (const pattern of blogPatterns) {
        const urlsToCheck = [baseHostUrl, ...alternativeUrls];
        
        for (const hostUrl of urlsToCheck) {
          const blogUrl = `${hostUrl}${pattern}`;
          try {
            console.log(`🔍 Checking blog pattern: ${blogUrl}`);
            const blogPageContent = await this.scrapeWebsite(blogUrl);
            
            if (blogPageContent && blogPageContent.content.length > 100) {
              console.log(`✅ Found blog section: ${blogUrl}`);
              
              // Detect if this is a blog index or individual post
              const pageType = await this.detectPageType(blogUrl);
              console.log(`📄 Page type detected: ${pageType.type} (confidence: ${Math.round(pageType.confidence * 100)}%)`);
              
              if (pageType.type === 'blog_index') {
                console.log(`📚 Analyzing blog index page for individual posts...`);
                blogUrls.push({url: blogUrl, type: 'blog_index'});
                
                // Extract individual blog post links from the index
                const posts = await this.findBlogPostsOnPage(blogUrl);
                console.log(`🔗 Found ${posts.length} potential blog posts on index page`);
                
                // Sort by priority (likely posts first) and limit
                const prioritizedPosts = posts
                  .sort((a, b) => a.priority - b.priority)
                  .slice(0, 15); // Limit to top 15 posts for performance
                
                // Now scrape the actual content of the individual posts
                console.log(`📖 Scraping individual blog post content...`);
                for (let i = 0; i < Math.min(prioritizedPosts.length, 8); i++) {
                  const post = prioritizedPosts[i];
                  try {
                    console.log(`  📄 Scraping post ${i+1}/${Math.min(prioritizedPosts.length, 8)}: ${post.title}`);
                    const fullPostContent = await this.scrapeBlogPost(post.url);
                    if (fullPostContent && fullPostContent.content.length > 500) {
                      // Merge metadata from index with full content
                      discoveredPosts.push({
                        ...post,
                        ...fullPostContent,
                        title: fullPostContent.title || post.title,
                        excerpt: post.excerpt || fullPostContent.metaDescription,
                        discoveredFrom: 'blog_index_scraped'
                      });
                    } else {
                      // Keep the post info even if full scraping failed
                      discoveredPosts.push(post);
                    }
                    
                    // Add delay between scraping requests
                    await new Promise(resolve => setTimeout(resolve, 800));
                  } catch (postError) {
                    console.log(`    ⚠️ Failed to scrape post: ${postError.message}`);
                    // Still add the basic post info
                    discoveredPosts.push(post);
                  }
                }
                
              } else {
                // It's an individual blog post
                console.log(`📄 Found individual blog post, scraping content...`);
                blogUrls.push({url: blogUrl, type: 'blog_post'});
                
                const fullPostContent = await this.scrapeBlogPost(blogUrl);
                if (fullPostContent) {
                  discoveredPosts.push({
                    ...fullPostContent,
                    discoveredFrom: 'direct_post'
                  });
                }
              }
              
              // Break out of alternative URL loop if we found content
              break;
            }
          } catch (error) {
            console.log(`❌ Blog pattern ${blogUrl} not found`);
          }
        }
      }
      
      // Also try to discover blog posts from homepage links
      const homepagePosts = await this.findBlogPostsOnPage(baseUrl);
      discoveredPosts.push(...homepagePosts);
      
      // Merge sitemap results with traditional discovery
      const allDiscoveredPosts = [
        ...sitemapResult.blogPosts,
        ...discoveredPosts
      ];
      
      // Deduplicate posts by URL and prioritize scraped content
      const uniquePosts = Array.from(new Map(
        allDiscoveredPosts.map(post => [post.url, post])
      ).values());
      
      // Sort posts by quality and discovery method
      const sortedPosts = uniquePosts.sort((a, b) => {
        // Prioritize sitemap discoveries (most reliable)
        if (a.discoveredFrom === 'sitemap' && b.discoveredFrom !== 'sitemap') return -1;
        if (b.discoveredFrom === 'sitemap' && a.discoveredFrom !== 'sitemap') return 1;
        
        // Then prioritize scraped content
        if (a.discoveredFrom === 'blog_index_scraped' && b.discoveredFrom !== 'blog_index_scraped') return -1;
        if (b.discoveredFrom === 'blog_index_scraped' && a.discoveredFrom !== 'blog_index_scraped') return 1;
        
        // Then by priority/word count
        const aPriority = a.priority || 0.5;
        const bPriority = b.priority || 0.5;
        if (aPriority !== bPriority) return bPriority - aPriority;
        
        return (b.wordCount || 0) - (a.wordCount || 0);
      });
      
      const indexPages = blogUrls.filter(b => typeof b === 'object' && b.type === 'blog_index').length;
      const individualPosts = blogUrls.filter(b => typeof b === 'object' && b.type === 'blog_post').length;
      const sitemapPosts = sortedPosts.filter(p => p.discoveredFrom === 'sitemap').length;
      const scrapedPosts = sortedPosts.filter(p => p.discoveredFrom === 'blog_index_scraped').length;
      
      console.log(`📊 Comprehensive blog discovery complete:`);
      console.log(`   🗺️ Sitemap posts: ${sitemapPosts}`);
      console.log(`   📚 Blog index pages: ${indexPages}`);
      console.log(`   📄 Individual posts scraped: ${scrapedPosts}`);
      console.log(`   🔗 Total unique posts: ${sortedPosts.length}`);
      console.log(`   📖 Sitemaps found: ${sitemapResult.sitemapsFound.length}`);
      
      return {
        blogSections: blogUrls,
        blogPosts: sortedPosts.slice(0, 15), // Return top 15 quality posts
        totalPostsFound: sortedPosts.length,
        indexPagesFound: indexPages,
        individualPostsFound: individualPosts,
        sitemapPostsFound: sitemapPosts,
        sitemapsFound: sitemapResult.sitemapsFound,
        analysis: {
          hasIndex: indexPages > 0,
          hasIndividualPosts: individualPosts > 0,
          hasSitemap: sitemapResult.sitemapsFound.length > 0,
          qualityScore: (sitemapPosts + scrapedPosts) / Math.max(sortedPosts.length, 1),
          discoveryMethods: [...new Set(sortedPosts.map(p => p.discoveredFrom))]
        }
      };
    } catch (error) {
      console.error('Blog discovery error:', error);
      return {
        blogSections: [],
        blogPosts: [],
        totalPostsFound: 0,
        error: error.message
      };
    }
  }
  
  /**
   * Detect if a page is a blog index/listing page or individual blog post (Cheerio-based).
   */
  async detectPageType(pageUrl) {
    try {
      const response = await axios.get(pageUrl, {
        headers: { 'User-Agent': this.userAgent, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        timeout: this.timeout,
        maxRedirects: 5
      });
      if (!response.data || typeof response.data !== 'string') {
        return { type: 'blog_post', confidence: 0, details: {} };
      }
      const $ = cheerio.load(response.data);
      const pathname = new URL(pageUrl).pathname;

      const indexIndicators = [
        $('article a, .post a, .entry a, h2 a, h3 a').length > 3,
        $('.pagination, .pager, .page-numbers, [class*="pagination"]').length > 0,
        $('a').length > 0 && $('a').toArray().some((el) => /read\s+more|continue\s+reading|view\s+post/i.test($(el).text())),
        $('.archive, .blog-list, .post-list, [class*="archive"], [class*="list"]').length > 0,
        $('time, .date, .published, .post-date').length > 2
      ];
      const mainEl = $('article, .post-content, .entry-content, main').first();
      const mainText = mainEl.length ? mainEl.text().trim() : '';
      const postIndicators = [
        mainText.length > 1000,
        $('article').length === 1,
        $('.post-meta, .entry-meta, .byline').length > 0,
        $('#comments, .comments, [class*="comment"]').length > 0,
        $('.share, .social-share, [class*="share"]').length > 0,
        $('.author-bio, .about-author, [class*="author"]').length > 0
      ];
      const indexScore = indexIndicators.filter(Boolean).length;
      const postScore = postIndicators.filter(Boolean).length;
      const urlPatterns = {
        isIndex: /\/(blog|news|articles|posts)\/?\s*$/i.test(pathname),
        isPost: /\/(blog|news|articles|posts)\/[^/]+/i.test(pathname) || /\/\d{4}\/\d{2}\//.test(pathname) || /\/[a-z-]+-\d+\/?$/i.test(pathname)
      };
      const pageAnalysis = {
        indexScore,
        postScore,
        urlPatterns,
        isLikelyIndex: indexScore > postScore || urlPatterns.isIndex,
        isLikelyPost: postScore > indexScore || urlPatterns.isPost,
        confidence: Math.max(indexScore, postScore) / Math.max(indexIndicators.length, postIndicators.length, 1),
        postLinksFound: $('article a, .post a, .entry a, h2 a, h3 a').length
      };
      console.log(`📊 Page type analysis for ${pageUrl}:`, pageAnalysis);
      return {
        type: pageAnalysis.isLikelyIndex ? 'blog_index' : 'blog_post',
        confidence: pageAnalysis.confidence,
        details: pageAnalysis
      };
    } catch (error) {
      console.warn('detectPageType failed:', error?.message);
      return { type: 'blog_post', confidence: 0, details: { error: error?.message } };
    }
  }

  /**
   * Find blog posts on a specific page (Cheerio-based).
   */
  async findBlogPostsOnPage(pageUrl) {
    try {
      const response = await axios.get(pageUrl, {
        headers: { 'User-Agent': this.userAgent, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        timeout: this.timeout,
        maxRedirects: 5
      });
      if (!response.data || typeof response.data !== 'string') return [];
      const $ = cheerio.load(response.data);
      const baseUrl = new URL(pageUrl);
      const baseOrigin = baseUrl.origin;
      const baseHost = baseUrl.hostname;
      const foundLinks = new Set();
      const posts = [];
      const postSelectors = [
        'article h1 a, article h2 a, article h3 a',
        '.post-title a, .entry-title a, .blog-post-title a',
        'h1 a[href*="/blog/"], h2 a[href*="/blog/"], h3 a[href*="/blog/"]',
        'article > a, .post > a, .entry > a',
        'article a[href*="/blog/"], article a[href*="/post/"], article a[href*="/news/"]',
        '.blog-post a, .post-content a, .entry-content a',
        '.post a, .article a, .blog-item a',
        'a[href*="/blog/"], a[href*="/post/"], a[href*="/news/"], a[href*="/articles/"], a[href*="/insights/"]'
      ];
      for (const selector of postSelectors) {
        if (foundLinks.size >= 50) break;
        $(selector).each((_, el) => {
          if (foundLinks.size >= 50) return false;
          let href = $(el).attr('href');
          if (!href) return;
          try {
            href = new URL(href, pageUrl).href;
          } catch {
            return;
          }
          if (foundLinks.has(href)) return;
          const urlObj = new URL(href);
          if (urlObj.hostname.replace(/^www\./, '') !== baseHost.replace(/^www\./, '')) return;
          if (href === pageUrl || href === pageUrl.replace(/\/?$/, '/') || /\/(blog|news|articles)\/?\s*$/i.test(urlObj.pathname)) return;
          if (/\/(tag|category|archive|admin|wp-admin|login|search|contact|about|privacy)/i.test(href)) return;
          if (/\.(css|js|jpg|jpeg|png|gif|svg|pdf|zip)$/i.test(href)) return;
          const isLikelyPost = /\/[a-z0-9-]+\/?$/i.test(urlObj.pathname) || /\/\d{4}\/\d{2}\//.test(urlObj.pathname) || /\/blog\/[^/]+/.test(href) || /\/post\/[^/]+/.test(href) || /\/news\/[^/]+/.test(href);
          foundLinks.add(href);
          const article = $(el).closest('article, .post, .entry, .blog-item, .news-item');
          let titleText = $(el).text().trim() || $(el).find('h1, h2, h3, h4').first().text().trim() || $(el).attr('title') || '';
          let publishDate = null;
          let author = null;
          let excerpt = null;
          let featuredImage = null;
          if (article.length) {
            const dateEl = article.find('time, .date, .published, .post-date, .entry-date, [datetime]').first();
            if (dateEl.length) publishDate = dateEl.attr('datetime') || dateEl.attr('data-date') || dateEl.text().trim();
            const authorEl = article.find('.author, .by-author, .post-author, .entry-author, [rel="author"]').first();
            if (authorEl.length) author = authorEl.text().replace(/by\s+/i, '').trim();
            const excerptEl = article.find('.excerpt, .summary, .post-excerpt, .entry-summary, p').first();
            if (excerptEl.length) excerpt = excerptEl.text().trim().slice(0, 250);
            const imgEl = article.find('img').first();
            if (imgEl.length && imgEl.attr('src')) featuredImage = imgEl.attr('src');
          }
          if (titleText.length > 0) {
            posts.push({
              url: href,
              title: titleText,
              publishDate,
              author,
              excerpt,
              featuredImage,
              isLikelyPost: !!isLikelyPost,
              discoveredFrom: 'blog_index',
              priority: isLikelyPost ? 1 : 2
            });
          }
        });
        if (posts.filter((p) => p.isLikelyPost).length >= 10) break;
      }
      return posts;
    } catch (error) {
      console.warn(`Failed to find blog posts on ${pageUrl}:`, error.message);
      return [];
    }
  }
  
  /**
   * Scrape multiple blog posts with full content
   */
  async scrapeBlogPosts(postUrls) {
    const results = [];
    const maxPosts = Math.min(postUrls.length, 5); // Limit to 5 posts to avoid rate limiting
    
    console.log(`📖 Scraping ${maxPosts} blog posts for content analysis...`);
    
    for (let i = 0; i < maxPosts; i++) {
      const postUrl = postUrls[i];
      try {
        console.log(`📖 Scraping post ${i + 1}/${maxPosts}: ${postUrl}`);
        const postContent = await this.scrapeBlogPost(postUrl);
        if (postContent) {
          results.push(postContent);
        }
        
        // Add delay between requests to be respectful
        if (i < maxPosts - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.warn(`Failed to scrape post ${postUrl}:`, error.message);
      }
    }
    
    return results;
  }
  
  /**
   * Scrape individual blog post using scrapeWebsite (Cheerio/Cloudflare).
   */
  async scrapeBlogPost(postUrl) {
    const normalizedUrl = this.normalizeUrl(postUrl);
    try {
      const scraped = await this.scrapeWebsite(normalizedUrl);
      const postData = {
        title: scraped.title || '',
        content: scraped.content || '',
        metaDescription: scraped.metaDescription || '',
        author: ''
      };
      return this.cleanBlogPostContent(postData);
    } catch (error) {
      console.error('Blog post scrape error:', error);
      throw new Error(`Failed to scrape blog post: ${error.message}`);
    }
  }

  /**
   * [REMOVED: legacy Puppeteer page.evaluate block for scrapeBlogPost - now uses scrapeWebsite]
   */
  _scrapeBlogPostPlaceholderRemoved() {
    // Block removed; scrapeBlogPost uses scrapeWebsite + cleanBlogPostContent.
  }

  /**
   * Extract CTAs (Call-to-Actions) from a page using scrapeWebsite (Cheerio/Cloudflare).
   */
  async extractCTAs(pageUrl) {
    try {
      const content = await this.scrapeWebsite(pageUrl);
      const ctas = content.ctas || [];
      return ctas.map((c) => ({ ...c, page_url: c.page_url || pageUrl }));
    } catch (error) {
      console.error('CTA extraction error:', error);
      return [];
    }
  }

  /**
   * Extract internal linking structure using HTTP + Cheerio (no browser).
   */
  async extractInternalLinks(pageUrl) {
    try {
      const response = await axios.get(pageUrl, {
        headers: { 'User-Agent': this.userAgent, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        timeout: this.timeout,
        maxRedirects: 5
      });
      if (!response.data || typeof response.data !== 'string') {
        return { internalLinks: [], totalLinksFound: 0 };
      }
      const extracted = this._extractContentAndCTAsFromHTML(response.data, pageUrl);
      const raw = extracted.internalLinks || [];
      const domain = new URL(pageUrl).hostname;
      const internalLinks = raw.slice(0, 50).map((link) => {
        const href = typeof link === 'string' ? link : link.url;
        const text = typeof link === 'object' && link.text ? link.text : '';
        let linkType = 'page';
        if (href.includes('/blog/') || href.includes('/post/')) linkType = 'blog';
        else if (href.includes('/product/') || href.includes('/service/')) linkType = 'product';
        else if (href.includes('/about')) linkType = 'about';
        else if (href.includes('/contact')) linkType = 'contact';
        return {
          url: href,
          text: (text || '').slice(0, 100),
          linkType,
          context: (typeof link === 'object' && link.context) ? link.context : 'content',
          anchorText: (text || '').slice(0, 100)
        };
      });
      return { internalLinks, totalLinksFound: internalLinks.length };
    } catch (error) {
      console.error('Internal links extraction error:', error);
      return { internalLinks: [], totalLinksFound: 0, error: error.message };
    }
  }

  /**
   * Clean and format blog post content
   */
  cleanBlogPostContent(postData) {
    const cleanText = (text) => {
      if (!text) return '';
      return text
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim();
    };

    return {
      ...postData,
      title: cleanText(postData.title),
      content: cleanText(postData.content),
      metaDescription: cleanText(postData.metaDescription),
      author: cleanText(postData.author),
      scrapedAt: new Date().toISOString()
    };
  }

  /**
   * Clean and format extracted content
   */
  cleanContent(content) {
    // Clean up text content
    const cleanText = (text) => {
      if (!text) return '';
      return text
        .replace(/\s+/g, ' ')  // Replace multiple whitespace with single space
        .replace(/\n\s*\n/g, '\n')  // Remove excessive line breaks
        .trim();
    };

    const cleanedContent = cleanText(content.content);
    
    // Calculate word count from cleaned content or use existing if present
    const wordCount = content.wordCount || (cleanedContent.length > 0 
      ? cleanedContent.split(/\s+/).filter(word => word.length > 0).length 
      : 0);

    // Handle headings - support both string array and object array formats
    let cleanedHeadings = [];
    if (content.headings) {
      cleanedHeadings = content.headings.map(h => {
        if (typeof h === 'string') {
          return cleanText(h);
        } else if (h && h.text) {
          return {
            text: cleanText(h.text),
            level: h.level || 1,
            id: h.id || ''
          };
        }
        return h;
      }).filter(h => h && (typeof h === 'string' ? h.length > 0 : h.text && h.text.length > 0));
    }

    return {
      title: cleanText(content.title),
      metaDescription: cleanText(content.metaDescription),
      content: cleanedContent,
      wordCount: wordCount,
      headings: cleanedHeadings,
      url: content.url,
      internalLinks: content.internalLinks || [],
      externalLinks: content.externalLinks || [],
      ctas: content.ctas || [],
      socialHandles: content.socialHandles || {},
      extractionMethod: content.extractionMethod || 'unknown',
      scrapedAt: new Date().toISOString()
    };
  }

  /**
   * Normalize URL to ensure consistent format across discovery and scraping
   */
  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      // Preserve the original URL format (with or without www)
      // This prevents mismatches between discovery and detailed scraping
      return urlObj.href;
    } catch {
      return url;
    }
  }

  /**
   * Compare two URLs for equivalence, handling common variations
   */
  urlsMatch(url1, url2) {
    try {
      const normalizedUrl1 = this.normalizeUrl(url1);
      const normalizedUrl2 = this.normalizeUrl(url2);
      
      // Direct match
      if (normalizedUrl1 === normalizedUrl2) return true;
      
      // Handle www/non-www variations
      const urlObj1 = new URL(normalizedUrl1);
      const urlObj2 = new URL(normalizedUrl2);
      
      // Compare with www variations
      const host1 = urlObj1.host.startsWith('www.') ? urlObj1.host.substring(4) : urlObj1.host;
      const host2 = urlObj2.host.startsWith('www.') ? urlObj2.host.substring(4) : urlObj2.host;
      
      return host1 === host2 && urlObj1.pathname === urlObj2.pathname;
    } catch {
      return url1 === url2;
    }
  }

  /**
   * Validate URL format
   */
  isValidUrl(string) {
    try {
      const url = new URL(string);
      return ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  }

  /**
   * Classify CTA type based on text and context
   * Returns database-valid CTA types that match schema constraints
   *
   * Valid types: 'button', 'contact_link', 'signup_link', 'demo_link', 'trial_link',
   *              'form', 'email_capture', 'cta_element', 'phone_link', 'download_link'
   */
  classifyCTA(text, href = '') {
    const lowerText = text.toLowerCase();
    const lowerHref = href.toLowerCase();

    // Contact/Support CTAs
    if (lowerText.includes('contact') || lowerText.includes('support') ||
        lowerText.includes('help') || lowerHref.includes('contact')) {
      return 'contact_link';
    }

    // Phone CTAs
    if (lowerText.includes('call') || lowerText.includes('phone') ||
        lowerHref.includes('tel:')) {
      return 'phone_link';
    }

    // Signup/Register CTAs
    if (lowerText.includes('sign up') || lowerText.includes('signup') ||
        lowerText.includes('register') || lowerText.includes('join') ||
        lowerHref.includes('signup') || lowerHref.includes('register')) {
      return 'signup_link';
    }

    // Demo CTAs
    if (lowerText.includes('demo') || lowerText.includes('preview') ||
        lowerHref.includes('demo')) {
      return 'demo_link';
    }

    // Trial CTAs
    if (lowerText.includes('trial') || lowerText.includes('try') ||
        lowerHref.includes('trial')) {
      return 'trial_link';
    }

    // Email/Newsletter CTAs
    if (lowerText.includes('subscribe') || lowerText.includes('newsletter') ||
        lowerText.includes('email')) {
      return 'email_capture';
    }

    // Download CTAs
    if (lowerText.includes('download') || lowerText.includes('get') ||
        lowerHref.includes('download')) {
      return 'download_link';
    }

    // Purchase/Buy CTAs - map to button
    if (lowerText.includes('buy') || lowerText.includes('purchase') ||
        lowerText.includes('shop') || lowerText.includes('add to cart') ||
        lowerHref.includes('cart') || lowerHref.includes('checkout')) {
      return 'button';
    }

    // Action CTAs (Get Started, Learn More, etc.) - map to button
    if (lowerText.includes('get started') || lowerText.includes('start') ||
        lowerText.includes('learn more') || lowerText.includes('read more') ||
        lowerText.includes('discover') || lowerText.includes('explore')) {
      return 'button';
    }

    // Generic fallback
    return 'cta_element';
  }
}

export default new WebScraperService();