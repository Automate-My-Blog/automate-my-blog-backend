/**
 * One-off test: scrape https://www.samjhill.com/ and print extracted social handles.
 * Run: node test-social-scrape-samjhill.js
 */
import webScraper from './services/webscraper.js';

const URL = 'https://www.samjhill.com/';

async function main() {
  console.log('Scraping:', URL);
  console.log('');

  try {
    const result = await webScraper.scrapeWebsite(URL, {
      onScrapeProgress: (phase, message) => console.log(`  [${phase}] ${message}`)
    });

    console.log('\n--- Result ---');
    console.log('Title:', result?.title?.slice(0, 80) || '(none)');
    console.log('Content length:', result?.content?.length ?? 0, 'chars');
    console.log('CTAs count:', result?.ctas?.length ?? 0);
    console.log('');
    console.log('Social handles:', JSON.stringify(result?.socialHandles ?? {}, null, 2));
    console.log('');
    if (result?.socialHandles && Object.keys(result.socialHandles).length > 0) {
      console.log('Platforms found:', Object.keys(result.socialHandles).join(', '));
    } else {
      console.log('No social handles detected from links on the page.');
    }
  } catch (err) {
    console.error('Scrape failed:', err.message);
    process.exit(1);
  }
}

main();
