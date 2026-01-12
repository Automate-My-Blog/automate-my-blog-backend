import puppeteer from 'puppeteer';
import axios from 'axios';
import * as cheerio from 'cheerio';
import xml2js from 'xml2js';

export class WebScraperService {
  constructor() {
    this.timeout = parseInt(process.env.ANALYSIS_TIMEOUT) || 10000;
    this.userAgent = process.env.USER_AGENT || 'AutoBlog Bot 1.0';
  }

  /**
   * Scrape website content with fallback methods
   */
  async scrapeWebsite(url) {
    try {
      // Validate URL
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new Error('Invalid URL protocol. Only HTTP and HTTPS are supported.');
      }

      // Try Puppeteer first for dynamic content
      try {
        return await this.scrapeWithPuppeteer(url);
      } catch (puppeteerError) {
        console.warn('Puppeteer failed, falling back to Axios + Cheerio:', puppeteerError.message);
        
        // Fallback to simple HTTP request with Cheerio
        return await this.scrapeWithCheerio(url);
      }
    } catch (error) {
      console.error('Website scraping error:', error);
      throw new Error(`Failed to scrape website: ${error.message}`);
    }
  }

  /**
   * Scrape with Puppeteer for dynamic content
   */
  async scrapeWithPuppeteer(url) {
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      });

      const page = await browser.newPage();
      
      // Set user agent
      await page.setUserAgent(this.userAgent);
      
      // Set viewport
      await page.setViewport({ width: 1920, height: 1080 });

      // Navigate to page with timeout
      await page.goto(url, {
        waitUntil: 'networkidle0',
        timeout: this.timeout
      });

      // Wait a bit for any dynamic content
      await page.waitForSelector('body', { timeout: 5000 }).catch(() => {}); // Fallback wait

      // Extract content only (removed brand color detection)
      const content = await page.evaluate(() => {

        // Remove unwanted elements for content extraction (but keep them for color analysis)
        const elementsToRemove = [
          'script', '.cookie-banner', '.popup', '.modal', '.advertisement'
        ];
        
        elementsToRemove.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => el.remove());
        });

        // Get title
        const title = document.title || '';

        // Get meta description
        const metaDescription = document.querySelector('meta[name="description"]')?.content || '';

        // Get main content
        const mainSelectors = [
          'main', '[role="main"]', '.main-content', '.content', 
          'article', '.post-content', '.entry-content'
        ];
        
        let mainContent = '';
        for (const selector of mainSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            mainContent = element.innerText || '';
            break;
          }
        }

        // If no main content found, get body text
        if (!mainContent) {
          mainContent = document.body.innerText || '';
        }

        // Get headings
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
          .map(h => h.innerText.trim())
          .filter(text => text.length > 0)
          .slice(0, 10);

        return {
          title: title.trim(),
          metaDescription: metaDescription.trim(),
          content: mainContent.trim(),
          headings,
          url
        };
      });

      return this.cleanContent(content);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Scrape with Axios + Cheerio for static content
   */
  async scrapeWithCheerio(url) {
    try {
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

      const $ = cheerio.load(response.data);

      // Remove unwanted elements
      $('script, style, nav, footer, header, .cookie-banner, .popup, .modal, .advertisement').remove();

      // Extract content
      const title = $('title').text().trim();
      const metaDescription = $('meta[name="description"]').attr('content') || '';

      // Try to find main content
      let mainContent = '';
      const mainSelectors = [
        'main', '[role="main"]', '.main-content', '.content', 
        'article', '.post-content', '.entry-content'
      ];

      for (const selector of mainSelectors) {
        const element = $(selector);
        if (element.length > 0) {
          mainContent = element.text().trim();
          break;
        }
      }

      // If no main content found, get body text
      if (!mainContent) {
        mainContent = $('body').text().trim();
      }

      // Get headings
      const headings = [];
      $('h1, h2, h3').each((i, el) => {
        if (i < 10) {
          const text = $(el).text().trim();
          if (text) headings.push(text);
        }
      });

      const content = {
        title,
        metaDescription: metaDescription.trim(),
        content: mainContent,
        headings,
        url
      };

      return this.cleanContent(content);
    } catch (error) {
      throw new Error(`HTTP scraping failed: ${error.message}`);
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
   * Detect if a page is a blog index/listing page or individual blog post
   */
  async detectPageType(pageUrl) {
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
      });

      const page = await browser.newPage();
      await page.setUserAgent(this.userAgent);
      await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: this.timeout });
      await new Promise(resolve => setTimeout(resolve, 1000));

      const pageAnalysis = await page.evaluate(() => {
        // Indicators of blog index/listing page
        const indexIndicators = [
          // Multiple post links (strong indicator)
          document.querySelectorAll('article a, .post a, .entry a, h2 a, h3 a').length > 3,
          
          // Pagination elements
          document.querySelector('.pagination, .pager, .page-numbers, [class*="pagination"]') !== null,
          
          // "Read more" or "Continue reading" links
          document.querySelectorAll('a').length > 0 && 
          Array.from(document.querySelectorAll('a')).some(a => 
            /read\s+more|continue\s+reading|view\s+post/i.test(a.textContent)
          ),
          
          // Archive/listing structure
          document.querySelector('.archive, .blog-list, .post-list, [class*="archive"], [class*="list"]') !== null,
          
          // Multiple date elements (suggests multiple posts)
          document.querySelectorAll('time, .date, .published, .post-date').length > 2
        ];

        // Indicators of individual blog post
        const postIndicators = [
          // Long main content (typical of full blog posts)
          (document.querySelector('article, .post-content, .entry-content, main')?.textContent?.length || 0) > 1000,
          
          // Single article structure
          document.querySelectorAll('article').length === 1,
          
          // Blog post metadata (single post)
          document.querySelector('.post-meta, .entry-meta, .byline') !== null,
          
          // Comments section
          document.querySelector('#comments, .comments, [class*="comment"]') !== null,
          
          // Social sharing buttons
          document.querySelector('.share, .social-share, [class*="share"]') !== null,
          
          // Author bio
          document.querySelector('.author-bio, .about-author, [class*="author"]') !== null
        ];

        const indexScore = indexIndicators.filter(Boolean).length;
        const postScore = postIndicators.filter(Boolean).length;
        
        // URL pattern analysis
        const urlPatterns = {
          isIndex: /\/(blog|news|articles|posts)\/?\s*$/i.test(window.location.pathname),
          isPost: /\/(blog|news|articles|posts)\/[^\/]+/i.test(window.location.pathname) || 
                 /\/\d{4}\/\d{2}\//.test(window.location.pathname) || // Date-based URLs
                 /\/[a-z-]+-\d+\/?$/i.test(window.location.pathname) // Slug with ID
        };

        return {
          indexScore,
          postScore,
          urlPatterns,
          isLikelyIndex: indexScore > postScore || urlPatterns.isIndex,
          isLikelyPost: postScore > indexScore || urlPatterns.isPost,
          confidence: Math.max(indexScore, postScore) / Math.max(indexIndicators.length, postIndicators.length),
          postLinksFound: document.querySelectorAll('article a, .post a, .entry a, h2 a, h3 a').length
        };
      });

      console.log(`📊 Page type analysis for ${pageUrl}:`, pageAnalysis);
      
      return {
        type: pageAnalysis.isLikelyIndex ? 'blog_index' : 'blog_post',
        confidence: pageAnalysis.confidence,
        details: pageAnalysis
      };

    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Find blog posts on a specific page
   */
  async findBlogPostsOnPage(pageUrl) {
    try {
      let browser;
      const posts = [];
      
      try {
        browser = await puppeteer.launch({
          headless: 'new',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
          ]
        });

        const page = await browser.newPage();
        await page.setUserAgent(this.userAgent);
        await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: this.timeout });
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Extract blog post links and metadata
        const blogPostData = await page.evaluate((baseUrl) => {
          const posts = [];
          const foundLinks = new Set();
          
          // Enhanced selectors for blog post links prioritizing quality
          const postSelectors = [
            // High priority - title links
            'article h1 a, article h2 a, article h3 a',
            '.post-title a, .entry-title a, .blog-post-title a',
            'h1 a[href*="/blog/"], h2 a[href*="/blog/"], h3 a[href*="/blog/"]',
            
            // Medium priority - article and post containers
            'article > a, .post > a, .entry > a',
            'article a[href*="/blog/"], article a[href*="/post/"], article a[href*="/news/"]',
            '.blog-post a, .post-content a, .entry-content a',
            
            // Lower priority - general links within blog context
            '.post a, .article a, .blog-item a',
            'a[href*="/blog/"], a[href*="/post/"], a[href*="/news/"]',
            'a[href*="/articles/"], a[href*="/insights/"]'
          ];
          
          // Process selectors in priority order
          for (const selector of postSelectors) {
            const elements = document.querySelectorAll(selector);
            
            elements.forEach((link, index) => {
              if (foundLinks.size >= 50) return; // Global limit for performance
              
              let href = link.href;
              if (!href) return;
              
              // Ensure absolute URL
              if (href.startsWith('/')) {
                const urlObj = new URL(baseUrl);
                href = `${urlObj.protocol}//${urlObj.host}${href}`;
              }
              
              // Skip duplicates and invalid URLs
              if (foundLinks.has(href)) return;
              
              // Enhanced URL filtering
              const urlObj = new URL(href);
              const baseHost = new URL(baseUrl).host;
              
              // Must be same domain
              if (!href.includes(baseHost)) return;
              
              // Skip if same as base URL or just blog index
              if (href === baseUrl || href === baseUrl + '/' || href.match(/\/(blog|news|articles)\/?\s*$/)) return;
              
              // Skip navigation, tag, category, and admin URLs
              if (href.match(/\/(tag|category|archive|admin|wp-admin|login|search|contact|about|privacy)/i)) return;
              
              // Skip non-content URLs (CSS, JS, images, etc.)
              if (href.match(/\.(css|js|jpg|jpeg|png|gif|svg|pdf|zip)$/i)) return;
              
              // Prefer URLs that look like individual posts
              const isLikelyPost = href.match(/\/[a-z0-9-]+\/?$/) || // slug pattern
                                  href.match(/\/\d{4}\/\d{2}\//) || // date pattern
                                  href.match(/\/blog\/[^\/]+/) || // blog/post-name
                                  href.match(/\/post\/[^\/]+/) || // post/post-name
                                  href.match(/\/news\/[^\/]+/); // news/article-name
              
              foundLinks.add(href);
              
              // Extract enhanced metadata
              const article = link.closest('article') || 
                             link.closest('.post') || 
                             link.closest('.entry') ||
                             link.closest('.blog-item') ||
                             link.closest('.news-item');
              
              const titleText = link.textContent?.trim() || 
                               link.querySelector('h1, h2, h3, h4')?.textContent?.trim() ||
                               link.title || '';
              
              let publishDate = null;
              let author = null;
              let excerpt = null;
              let featuredImage = null;
              
              if (article) {
                // Enhanced date extraction
                const dateEl = article.querySelector('time, .date, .published, .post-date, .entry-date, [datetime]');
                if (dateEl) {
                  publishDate = dateEl.getAttribute('datetime') || 
                               dateEl.getAttribute('data-date') ||
                               dateEl.textContent?.trim();
                }
                
                // Enhanced author extraction
                const authorEl = article.querySelector('.author, .by-author, .post-author, .entry-author, [rel="author"]');
                if (authorEl) {
                  author = authorEl.textContent?.replace(/by\s+/i, '').trim();
                }
                
                // Enhanced excerpt extraction
                const excerptEl = article.querySelector('.excerpt, .summary, .post-excerpt, .entry-summary, p:not(.meta):not(.date)');
                if (excerptEl) {
                  excerpt = excerptEl.textContent?.trim().slice(0, 250);
                }
                
                // Featured image extraction
                const imgEl = article.querySelector('img');
                if (imgEl && imgEl.src) {
                  featuredImage = imgEl.src;
                }
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
                  priority: isLikelyPost ? 1 : 2 // Higher priority for likely posts
                });
              }
            });
            
            // If we found good quality posts, we can stop early
            if (posts.filter(p => p.isLikelyPost).length >= 10) break;
          }
          
          return posts;
        }, pageUrl);

        posts.push(...blogPostData);
        
      } finally {
        if (browser) {
          await browser.close();
        }
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
   * Scrape individual blog post with enhanced content extraction
   */
  async scrapeBlogPost(postUrl) {
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
      });

      const page = await browser.newPage();
      await page.setUserAgent(this.userAgent);
      await page.goto(postUrl, { waitUntil: 'networkidle0', timeout: this.timeout });
      await new Promise(resolve => setTimeout(resolve, 1500));

      const postData = await page.evaluate(() => {
        // Extract post metadata first (before removing elements for CTA analysis)
        const title = document.querySelector('h1')?.textContent?.trim() || 
                     document.title || '';

        // Look for article content in common containers
        const contentSelectors = [
          'article .entry-content',
          'article .post-content', 
          'article .content',
          '.post-body',
          '.entry-content',
          '.post-content',
          'article',
          'main'
        ];
        
        let content = '';
        for (const selector of contentSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            content = element.innerText || '';
            if (content.length > 200) break; // Found substantial content
          }
        }

        // Extract metadata
        const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
        
        // Look for publish date
        let publishDate = null;
        const dateSelectors = ['time', '.date', '.published', '.post-date', '[datetime]'];
        for (const selector of dateSelectors) {
          const dateEl = document.querySelector(selector);
          if (dateEl) {
            publishDate = dateEl.getAttribute('datetime') || 
                         dateEl.getAttribute('content') ||
                         dateEl.textContent?.trim();
            if (publishDate) break;
          }
        }

        // Look for author
        let author = null;
        const authorSelectors = ['.author', '.by-author', '.post-author', '[rel="author"]'];
        for (const selector of authorSelectors) {
          const authorEl = document.querySelector(selector);
          if (authorEl) {
            author = authorEl.textContent?.trim();
            if (author) break;
          }
        }

        // Extract headings for structure analysis
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'))
          .map(h => ({
            level: parseInt(h.tagName.charAt(1)),
            text: h.textContent?.trim()
          }))
          .filter(h => h.text && h.text.length > 0)
          .slice(0, 15);

        // Extract internal and external links
        const links = Array.from(document.querySelectorAll('a[href]'))
          .map(a => ({
            url: a.href,
            text: a.textContent?.trim(),
            isInternal: a.href.includes(window.location.host)
          }))
          .filter(link => link.text && link.text.length > 0)
          .slice(0, 20);

        const internalLinks = links.filter(l => l.isInternal);
        const externalLinks = links.filter(l => !l.isInternal);

        // Extract CTAs from the blog post (before removing elements)
        const ctaElements = [];
        
        // Enhanced CTA selectors for blog posts
        const ctaSelectors = [
          { selector: 'button, .btn, .button', type: 'button' },
          { selector: 'a[href*="contact"]', type: 'contact_link' },
          { selector: 'a[href*="signup"], a[href*="register"]', type: 'signup_link' },
          { selector: 'a[href*="subscribe"], a[href*="newsletter"]', type: 'newsletter_signup' },
          { selector: 'a[href*="demo"]', type: 'demo_link' },
          { selector: 'a[href*="trial"]', type: 'trial_link' },
          { selector: 'a[href*="product"], a[href*="shop"], a[href*="buy"]', type: 'product_link' },
          { selector: 'a[href*="download"]', type: 'download_link' },
          { selector: '.share-buttons a, .social-share a', type: 'social_share' },
          { selector: 'form', type: 'form' },
          { selector: 'input[type="email"]', type: 'email_capture' },
          { selector: '[class*="cta"], [id*="cta"]', type: 'cta_element' },
          { selector: 'a[href*="blog"]:not([href*="' + window.location.pathname + '"])', type: 'blog_navigation' }
        ];

        for (const { selector, type } of ctaSelectors) {
          const elements = document.querySelectorAll(selector);
          
          elements.forEach((el, index) => {
            if (index >= 8) return; // Limit per type for blog posts
            
            const text = el.textContent?.trim() || el.placeholder || el.value || '';
            const href = el.href || el.action || '';
            
            if (!text && !href) return;
            
            // Skip if CTA text is too generic or too long
            if (!text || text.length < 2 || text.length > 100) return;
            
            // Determine placement
            let placement = 'unknown';
            if (el.closest('header, .header')) placement = 'header';
            else if (el.closest('footer, .footer')) placement = 'footer';
            else if (el.closest('nav, .nav')) placement = 'navigation';
            else if (el.closest('aside, .sidebar')) placement = 'sidebar';
            else if (el.closest('article, .post-content, .entry-content')) placement = 'article_content';
            else placement = 'main_content';

            // Get surrounding context for analysis
            const context = el.closest('section, article, div')?.textContent?.trim().slice(0, 200) || '';
            
            ctaElements.push({
              type,
              text: text.slice(0, 100),
              href: href.slice(0, 200),
              placement,
              context,
              className: el.className || '',
              tagName: el.tagName.toLowerCase(),
              page_url: window.location.href
            });
          });
        }

        // Extract visual design information before removing elements
        const visualDesign = (() => {
          const design = {
            colors: {
              primary: [],
              background: [],
              text: [],
              accent: []
            },
            typography: {
              fonts: [],
              headingSizes: [],
              bodySize: null,
              lineHeight: null
            },
            layout: {
              maxWidth: null,
              spacing: [],
              borderRadius: []
            },
            contentStructure: {
              paragraphCount: 0,
              listCount: 0,
              blockquoteCount: 0,
              codeBlockCount: 0,
              imageCount: 0
            }
          };

          try {
            // Extract colors from computed styles
            const elementsToAnalyze = [
              ...document.querySelectorAll('article, .post-content, .entry-content, main'),
              ...document.querySelectorAll('h1, h2, h3, h4, h5, h6'),
              ...document.querySelectorAll('p'),
              ...document.querySelectorAll('a'),
              ...document.querySelectorAll('button, .btn')
            ];

            const colorSet = new Set();
            const fontSet = new Set();

            elementsToAnalyze.slice(0, 20).forEach(el => {
              const styles = window.getComputedStyle(el);
              
              // Extract colors
              const bgColor = styles.backgroundColor;
              const textColor = styles.color;
              const borderColor = styles.borderColor;
              
              if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
                colorSet.add(bgColor);
              }
              if (textColor && textColor !== 'rgba(0, 0, 0, 0)') {
                colorSet.add(textColor);
              }
              if (borderColor && borderColor !== 'rgba(0, 0, 0, 0)') {
                colorSet.add(borderColor);
              }

              // Extract fonts
              const fontFamily = styles.fontFamily;
              if (fontFamily) {
                fontSet.add(fontFamily.split(',')[0].replace(/['"]/g, '').trim());
              }
            });

            // Convert colors to arrays
            design.colors.primary = Array.from(colorSet).slice(0, 8);
            design.typography.fonts = Array.from(fontSet).slice(0, 5);

            // Extract typography sizes
            document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
              const styles = window.getComputedStyle(heading);
              const fontSize = styles.fontSize;
              if (fontSize) {
                design.typography.headingSizes.push({
                  level: heading.tagName.toLowerCase(),
                  size: fontSize,
                  weight: styles.fontWeight
                });
              }
            });

            // Extract body text typography
            const bodyEl = document.querySelector('article p, .post-content p, .entry-content p, main p');
            if (bodyEl) {
              const styles = window.getComputedStyle(bodyEl);
              design.typography.bodySize = styles.fontSize;
              design.typography.lineHeight = styles.lineHeight;
            }

            // Extract layout information
            const mainContent = document.querySelector('article, .post-content, .entry-content, main');
            if (mainContent) {
              const styles = window.getComputedStyle(mainContent);
              design.layout.maxWidth = styles.maxWidth;
              design.layout.spacing.push(styles.padding, styles.margin);
              design.layout.borderRadius.push(styles.borderRadius);
            }

            // Analyze content structure
            design.contentStructure.paragraphCount = document.querySelectorAll('article p, .post-content p, .entry-content p').length;
            design.contentStructure.listCount = document.querySelectorAll('article ul, article ol, .post-content ul, .post-content ol').length;
            design.contentStructure.blockquoteCount = document.querySelectorAll('article blockquote, .post-content blockquote').length;
            design.contentStructure.codeBlockCount = document.querySelectorAll('article pre, article code, .post-content pre, .post-content code').length;
            design.contentStructure.imageCount = document.querySelectorAll('article img, .post-content img').length;

          } catch (error) {
            console.warn('Failed to extract visual design:', error);
          }

          return design;
        })();

        // Now remove unwanted elements for clean content extraction
        const elementsToRemove = [
          'script', 'style', 'nav', 'header', 'footer', 
          '.cookie-banner', '.popup', '.modal', '.advertisement',
          '.social-share', '.comments', '.sidebar'
        ];
        
        elementsToRemove.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => el.remove());
        });

        return {
          title,
          content: content.length > 50000 ? content.slice(0, 50000) + '...' : content, // Intelligent content limit for very large posts
          metaDescription,
          publishDate,
          author,
          headings,
          internalLinks,
          externalLinks,
          wordCount: content.split(/\s+/).length,
          url: window.location.href,
          ctas: ctaElements, // Include extracted CTAs
          visualDesign: visualDesign // Include visual design data
        };
      });

      return this.cleanBlogPostContent(postData);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
  
  /**
   * Extract CTAs (Call-to-Actions) from a page
   */
  async extractCTAs(pageUrl) {
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
      });

      const page = await browser.newPage();
      await page.setUserAgent(this.userAgent);
      await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: this.timeout });
      await new Promise(resolve => setTimeout(resolve, 1000));

      const ctas = await page.evaluate(() => {
        const ctaElements = [];
        
        // CTA selectors and their types
        const ctaSelectors = [
          { selector: 'button, .btn, .button', type: 'button' },
          { selector: 'a[href*="contact"]', type: 'contact_link' },
          { selector: 'a[href*="signup"], a[href*="register"]', type: 'signup_link' },
          { selector: 'a[href*="demo"]', type: 'demo_link' },
          { selector: 'a[href*="trial"]', type: 'trial_link' },
          { selector: 'form', type: 'form' },
          { selector: 'input[type="email"]', type: 'email_capture' },
          { selector: '[class*="cta"], [id*="cta"]', type: 'cta_element' }
        ];

        for (const { selector, type } of ctaSelectors) {
          const elements = document.querySelectorAll(selector);
          
          elements.forEach((el, index) => {
            if (index >= 10) return; // Limit per type
            
            const text = el.textContent?.trim() || el.placeholder || el.value || '';
            const href = el.href || '';
            
            if (!text && !href) return;
            
            // Determine placement
            let placement = 'unknown';
            if (el.closest('header, .header')) placement = 'header';
            else if (el.closest('footer, .footer')) placement = 'footer';
            else if (el.closest('nav, .nav')) placement = 'navigation';
            else if (el.closest('aside, .sidebar')) placement = 'sidebar';
            else placement = 'main_content';

            // Get surrounding context for analysis
            const context = el.closest('section, article, div')?.textContent?.trim().slice(0, 200) || '';
            
            ctaElements.push({
              type,
              text: text.slice(0, 100),
              href: href.slice(0, 200),
              placement,
              context,
              className: el.className || '',
              tagName: el.tagName.toLowerCase()
            });
          });
        }

        return ctaElements;
      });

      return ctas;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
  
  /**
   * Extract internal linking structure
   */
  async extractInternalLinks(pageUrl) {
    try {
      const pageContent = await this.scrapeWithPuppeteer(pageUrl);
      
      // Use Puppeteer to get all internal links with context
      let browser;
      try {
        browser = await puppeteer.launch({
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        const page = await browser.newPage();
        await page.setUserAgent(this.userAgent);
        await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: this.timeout });

        const linkStructure = await page.evaluate(() => {
          const host = window.location.host;
          const links = [];
          
          document.querySelectorAll('a[href]').forEach((link, index) => {
            if (index >= 50) return; // Limit total links
            
            const href = link.href;
            const text = link.textContent?.trim();
            
            if (!text || !href.includes(host) || href === window.location.href) return;
            
            // Categorize link type
            let linkType = 'page';
            if (href.includes('/blog/') || href.includes('/post/')) linkType = 'blog';
            else if (href.includes('/product/') || href.includes('/service/')) linkType = 'product';
            else if (href.includes('/about')) linkType = 'about';
            else if (href.includes('/contact')) linkType = 'contact';
            
            // Get context
            const context = link.closest('nav, .nav, .menu') ? 'navigation' : 
                           link.closest('footer') ? 'footer' :
                           link.closest('sidebar, .sidebar') ? 'sidebar' : 'content';
            
            links.push({
              url: href,
              text: text.slice(0, 100),
              linkType,
              context,
              anchorText: text
            });
          });

          return {
            internalLinks: links,
            totalLinksFound: links.length
          };
        });

        return linkStructure;
      } finally {
        if (browser) {
          await browser.close();
        }
      }
    } catch (error) {
      console.error('Internal links extraction error:', error);
      return {
        internalLinks: [],
        totalLinksFound: 0,
        error: error.message
      };
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
      return text
        .replace(/\s+/g, ' ')  // Replace multiple whitespace with single space
        .replace(/\n\s*\n/g, '\n')  // Remove excessive line breaks
        .trim();
    };

    return {
      title: cleanText(content.title),
      metaDescription: cleanText(content.metaDescription),
      content: cleanText(content.content).slice(0, 5000), // Limit content length
      headings: content.headings.map(h => cleanText(h)).filter(h => h.length > 0),
      url: content.url,
      scrapedAt: new Date().toISOString()
    };
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
}

export default new WebScraperService();