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

      // Extract content
      const content = await page.evaluate(() => {
        // Remove unwanted elements
        const elementsToRemove = [
          'script', 'style', 'nav', 'footer', 'header', 
          '.cookie-banner', '.popup', '.modal', '.advertisement'
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