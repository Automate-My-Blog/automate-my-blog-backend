#!/usr/bin/env node

import puppeteer from 'puppeteer';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testContentExtraction() {
  console.log('🔍 CONTENT EXTRACTION DEBUG');
  console.log('============================\n');
  
  const testUrl = 'https://lumibears.com/blog/emotional-support-stuffed-animals-for-kids';
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    const page = await browser.newPage();
    await page.setUserAgent('AutoBlog Bot 1.0');
    await page.goto(testUrl, { waitUntil: 'networkidle0', timeout: 10000 });
    await new Promise(resolve => setTimeout(resolve, 2000));

    const contentAnalysis = await page.evaluate(() => {
      const results = {
        pageTitle: document.title,
        bodyText: document.body ? document.body.innerText.length : 0,
        htmlLength: document.documentElement ? document.documentElement.innerHTML.length : 0,
        contentSelectors: [],
        allParagraphs: document.querySelectorAll('p').length,
        allDivs: document.querySelectorAll('div').length,
        allSections: document.querySelectorAll('section').length,
        allArticles: document.querySelectorAll('article').length
      };
      
      // Test different content selectors
      const contentSelectors = [
        'article .entry-content',
        'article .post-content', 
        'article .content',
        '.post-body',
        '.entry-content',
        '.post-content',
        'article',
        'main',
        '.content',
        '[class*="content"]',
        '[class*="post"]',
        '[class*="article"]'
      ];
      
      for (const selector of contentSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          for (const element of elements) {
            const text = element.innerText || '';
            if (text.length > 100) {
              results.contentSelectors.push({
                selector,
                textLength: text.length,
                preview: text.slice(0, 200) + '...',
                tagName: element.tagName,
                className: element.className,
                hasChildren: element.children.length > 0
              });
            }
          }
        }
      }
      
      return results;
    });

    console.log('📊 CONTENT ANALYSIS RESULTS:');
    console.log(`Page title: ${contentAnalysis.pageTitle}`);
    console.log(`Body text length: ${contentAnalysis.bodyText} characters`);
    console.log(`HTML length: ${contentAnalysis.htmlLength} characters`);
    console.log(`Paragraphs found: ${contentAnalysis.allParagraphs}`);
    console.log(`Divs found: ${contentAnalysis.allDivs}`);
    console.log(`Sections found: ${contentAnalysis.allSections}`);
    console.log(`Articles found: ${contentAnalysis.allArticles}`);
    
    console.log('\n🎯 CONTENT SELECTOR RESULTS:');
    if (contentAnalysis.contentSelectors.length === 0) {
      console.log('❌ No content found with any selector');
      console.log('🔍 This suggests the page is heavily JavaScript-dependent');
      
      // Check if we can find any text content at all
      const fallbackContent = await page.evaluate(() => {
        // Try to find any meaningful text content
        const allElements = document.querySelectorAll('*');
        const textElements = [];
        
        for (const el of allElements) {
          if (el.children.length === 0 && el.innerText && el.innerText.trim().length > 50) {
            textElements.push({
              tagName: el.tagName,
              className: el.className,
              text: el.innerText.slice(0, 100),
              length: el.innerText.length
            });
          }
        }
        
        return textElements.slice(0, 10);
      });
      
      console.log('\n🔍 FALLBACK TEXT ELEMENTS:');
      fallbackContent.forEach((el, i) => {
        console.log(`${i+1}. ${el.tagName}.${el.className}: "${el.text}..." (${el.length} chars)`);
      });
      
    } else {
      contentAnalysis.contentSelectors.forEach((result, i) => {
        console.log(`${i+1}. ${result.selector}`);
        console.log(`   Text: ${result.textLength} characters`);
        console.log(`   Tag: ${result.tagName}`);
        console.log(`   Class: ${result.className}`);
        console.log(`   Preview: "${result.preview}"`);
        console.log('');
      });
    }
    
    // Test specific wait for dynamic content
    console.log('\n⏳ TESTING DYNAMIC CONTENT LOADING...');
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait longer
    
    const delayedContent = await page.evaluate(() => {
      const articleEl = document.querySelector('article');
      const mainEl = document.querySelector('main');
      
      return {
        articleExists: !!articleEl,
        articleText: articleEl ? articleEl.innerText.length : 0,
        mainExists: !!mainEl,
        mainText: mainEl ? mainEl.innerText.length : 0,
        bodyClass: document.body.className,
        dataLoaded: document.querySelector('[data-loaded]') ? true : false
      };
    });
    
    console.log(`Article exists: ${delayedContent.articleExists}`);
    console.log(`Article text: ${delayedContent.articleText} chars`);
    console.log(`Main exists: ${delayedContent.mainExists}`);
    console.log(`Main text: ${delayedContent.mainText} chars`);
    console.log(`Body classes: ${delayedContent.bodyClass}`);

  } catch (error) {
    console.error('❌ Content extraction test failed:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run the test
testContentExtraction()
  .then(() => {
    console.log('\n🔍 Content extraction test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Test failed:', error.message);
    process.exit(1);
  });