import puppeteer from 'puppeteer';
import axios from 'axios';
import * as cheerio from 'cheerio';

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
      await page.waitForTimeout(2000);

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
   * Discover blog pages and content across the website
   */
  async discoverBlogPages(baseUrl) {
    try {
      console.log(`🔍 Discovering blog content on: ${baseUrl}`);
      
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
      
      const blogUrls = [];
      const discoveredPosts = [];
      
      // Check common blog directory patterns
      for (const pattern of blogPatterns) {
        const blogUrl = `${baseHostUrl}${pattern}`;
        try {
          console.log(`🔍 Checking blog pattern: ${blogUrl}`);
          const blogPageContent = await this.scrapeWebsite(blogUrl);
          
          if (blogPageContent && blogPageContent.content.length > 100) {
            console.log(`✅ Found blog section: ${blogUrl}`);
            blogUrls.push(blogUrl);
            
            // Try to discover individual blog posts from this page
            const posts = await this.findBlogPostsOnPage(blogUrl);
            discoveredPosts.push(...posts);
          }
        } catch (error) {
          console.log(`❌ Blog pattern ${pattern} not found`);
        }
      }
      
      // Also try to discover blog posts from homepage links
      const homepagePosts = await this.findBlogPostsOnPage(baseUrl);
      discoveredPosts.push(...homepagePosts);
      
      // Deduplicate posts by URL
      const uniquePosts = Array.from(new Map(
        discoveredPosts.map(post => [post.url, post])
      ).values());
      
      console.log(`📊 Blog discovery complete: Found ${blogUrls.length} blog sections, ${uniquePosts.length} posts`);
      
      return {
        blogSections: blogUrls,
        blogPosts: uniquePosts.slice(0, 10), // Limit to first 10 posts
        totalPostsFound: uniquePosts.length
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
        await page.waitForTimeout(1000);

        // Extract blog post links and metadata
        const blogPostData = await page.evaluate((baseUrl) => {
          const posts = [];
          
          // Common selectors for blog post links
          const postSelectors = [
            'article a[href*="/blog/"]',
            'article a[href*="/post/"]', 
            'article a[href*="/news/"]',
            '.post-title a',
            '.entry-title a',
            '.blog-post a',
            'h2 a',
            'h3 a',
            '.post a',
            '.article a'
          ];
          
          const foundLinks = new Set();
          
          for (const selector of postSelectors) {
            const elements = document.querySelectorAll(selector);
            
            elements.forEach((link, index) => {
              if (index >= 20) return; // Limit per selector
              
              let href = link.href;
              if (!href) return;
              
              // Ensure absolute URL
              if (href.startsWith('/')) {
                const urlObj = new URL(baseUrl);
                href = `${urlObj.protocol}//${urlObj.host}${href}`;
              }
              
              // Skip duplicates and non-blog URLs
              if (foundLinks.has(href) || 
                  !href.includes(new URL(baseUrl).host) ||
                  href === baseUrl) {
                return;
              }
              
              foundLinks.add(href);
              
              // Try to extract metadata
              const article = link.closest('article') || link.closest('.post') || link.closest('.entry');
              const titleText = link.textContent?.trim() || '';
              
              let publishDate = null;
              let author = null;
              let excerpt = null;
              
              if (article) {
                // Look for date
                const dateEl = article.querySelector('time, .date, .published, .post-date');
                if (dateEl) {
                  publishDate = dateEl.getAttribute('datetime') || dateEl.textContent?.trim();
                }
                
                // Look for author
                const authorEl = article.querySelector('.author, .by-author, .post-author');
                if (authorEl) {
                  author = authorEl.textContent?.trim();
                }
                
                // Look for excerpt
                const excerptEl = article.querySelector('.excerpt, .summary, p');
                if (excerptEl) {
                  excerpt = excerptEl.textContent?.trim().slice(0, 200);
                }
              }
              
              if (titleText.length > 0) {
                posts.push({
                  url: href,
                  title: titleText,
                  publishDate,
                  author,
                  excerpt
                });
              }
            });
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
      await page.waitForTimeout(1500);

      const postData = await page.evaluate(() => {
        // Remove unwanted elements
        const elementsToRemove = [
          'script', 'style', 'nav', 'header', 'footer', 
          '.cookie-banner', '.popup', '.modal', '.advertisement',
          '.social-share', '.comments', '.sidebar'
        ];
        
        elementsToRemove.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => el.remove());
        });

        // Extract post metadata
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

        return {
          title,
          content: content.slice(0, 8000), // Limit content size
          metaDescription,
          publishDate,
          author,
          headings,
          internalLinks,
          externalLinks,
          wordCount: content.split(/\s+/).length,
          url: window.location.href
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
      await page.waitForTimeout(1000);

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