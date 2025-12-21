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

      // Extract content and brand colors
      const content = await page.evaluate(() => {
        // Helper function to convert RGB to Hex
        const rgbToHex = (rgb) => {
          if (!rgb || rgb === 'transparent') return null;
          const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
          if (!match) return rgb.startsWith('#') ? rgb : null;
          
          const [, r, g, b] = match;
          const hex = '#' + [r, g, b].map(x => {
            const hex = parseInt(x).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
          }).join('');
          return hex;
        };

        // Helper function to check if color is meaningful (not white/black/gray)
        const isValidBrandColor = (color) => {
          if (!color || color === 'transparent') return false;
          const commonColors = ['#ffffff', '#000000', '#fff', '#000', 'white', 'black', 'transparent'];
          if (commonColors.includes(color.toLowerCase())) return false;
          
          // Check if it's a gray color (RGB values are similar)
          const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
          if (match) {
            const [, r, g, b] = match.map(Number);
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            // If color variance is low, it's likely a gray
            return (max - min) > 30;
          }
          
          return true;
        };

        // Extract CSS custom properties (CSS variables)
        const extractCSSVariables = () => {
          const cssVariables = {};
          const rootStyles = getComputedStyle(document.documentElement);
          
          // Common brand color variable names
          const brandColorVars = [
            '--primary', '--primary-color', '--brand-primary', '--main-color',
            '--secondary', '--secondary-color', '--brand-secondary',
            '--accent', '--accent-color', '--brand-accent', '--highlight',
            '--theme-color', '--brand-color'
          ];
          
          brandColorVars.forEach(varName => {
            const value = rootStyles.getPropertyValue(varName).trim();
            if (value) {
              cssVariables[varName] = rgbToHex(value) || value;
            }
          });
          
          return cssVariables;
        };

        // Extract colors from key brand elements
        const extractElementColors = () => {
          const brandElements = [
            // Header and navigation
            'header', 'nav', '.header', '.navigation', '.navbar',
            // Primary buttons and CTAs
            'button[type="submit"]', '.btn-primary', '.cta', '.button',
            'a[href*="contact"]', 'a[href*="buy"]', 'a[href*="shop"]',
            // Logo containers
            '.logo', '#logo', '.brand', '.site-title',
            // Other brand elements
            '.hero', '.banner', '.highlight'
          ];
          
          const elementColors = {};
          
          brandElements.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach((el, index) => {
              const styles = getComputedStyle(el);
              const bgColor = rgbToHex(styles.backgroundColor);
              const textColor = rgbToHex(styles.color);
              const borderColor = rgbToHex(styles.borderColor);
              
              if (isValidBrandColor(bgColor)) {
                elementColors[`${selector}-${index}-bg`] = bgColor;
              }
              if (isValidBrandColor(textColor)) {
                elementColors[`${selector}-${index}-text`] = textColor;
              }
              if (isValidBrandColor(borderColor)) {
                elementColors[`${selector}-${index}-border`] = borderColor;
              }
            });
          });
          
          return elementColors;
        };

        // Analyze and rank colors by frequency and importance
        const analyzeColors = (cssVars, elementColors) => {
          const colorFrequency = {};
          
          // Weight CSS variables higher (they're intentional brand colors)
          Object.values(cssVars).forEach(color => {
            if (color && isValidBrandColor(color)) {
              colorFrequency[color] = (colorFrequency[color] || 0) + 10;
            }
          });
          
          // Count element colors
          Object.values(elementColors).forEach(color => {
            if (color && isValidBrandColor(color)) {
              colorFrequency[color] = (colorFrequency[color] || 0) + 1;
            }
          });
          
          // Sort by frequency and return top colors
          const sortedColors = Object.entries(colorFrequency)
            .sort(([,a], [,b]) => b - a)
            .map(([color]) => color);
          
          return {
            primary: sortedColors[0] || null,
            secondary: sortedColors[1] || null,
            accent: sortedColors[2] || null,
            allColors: sortedColors.slice(0, 5),
            cssVariables: cssVars,
            elementColors: elementColors,
            colorFrequency: colorFrequency
          };
        };

        // Extract brand colors
        const cssVariables = extractCSSVariables();
        const elementColors = extractElementColors();
        const brandColorAnalysis = analyzeColors(cssVariables, elementColors);

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
          url,
          brandColors: brandColorAnalysis
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