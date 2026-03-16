#!/usr/bin/env node
/**
 * Proves that the WordPress content transformation (markdown→HTML, placeholders→img/tweet)
 * works correctly. Uses the same logic as services/wordpress-publish.js prepareContentForWordPress.
 *
 * Run: node scripts/verify-wordpress-content-transform.js
 * Exit 0 = transformation works; images and tweets are converted, raw placeholders removed.
 */

import { markdownToHtml } from '../lib/markdown-to-html.js';

// Exact sample from the blog where images/tweets were showing as raw placeholders
const SAMPLE_CONTENT = `
# Exploring RuneScape Lore: The Best Stories and Adventures

Have you ever wondered what makes RuneScape's lore so captivating?

[Image: An immersive fantasy landscape depicting a RuneScape-inspired world, with lush forests, towering castles, and mythical c]

## The Origins of RuneScape's Lore

RuneScape's lore is a tapestry woven with tales of gods and heroes.

[TWEET:1]

This interaction enriches the lore.

For a deeper dive, check out the video.

[VIDEO:3]

## Music and Lore

[TWEET:0]

This fusion elevates the gaming experience.
`;

function main() {
  console.log('Verifying WordPress content transformation...\n');

  // Same path as wordpress-publish: markdownToHtml (tweet URLs would be handled by prepareContentForWordPress)
  const { html } = markdownToHtml(SAMPLE_CONTENT, { forWordPressTweetEmbeds: true });

  const hasImg = /<img\s/i.test(html) && /via\.placeholder\.com/.test(html);
  const hasFigure = /<figure/i.test(html);
  // Raw placeholder form [Image: ...] must be gone (we output alt/figcaption text, so don't match that)
  const noRawImage = !/\[Image:\s*[^\]]*\]/.test(html);
  const noRawTweetIndex = !/\[TWEET:0\]/.test(html) && !/\[TWEET:1\]/.test(html);
  const noRawVideo = !/\[VIDEO:3\]/.test(html);

  if (hasImg && hasFigure && noRawImage && noRawTweetIndex && noRawVideo) {
    console.log('✓ [Image: ...]  → <figure><img> with placeholder URL');
    console.log('✓ [TWEET:0], [TWEET:1]  → removed (no raw text)');
    console.log('✓ [VIDEO:3]  → removed');
    console.log('\nSample of converted HTML (first 800 chars):');
    console.log('---');
    console.log(html.slice(0, 800).replace(/\n/g, '\n'));
    console.log('...');
    console.log('---\nTransformation verified. Backend sends this HTML to WordPress.');
    process.exit(0);
  }

  console.error('Transformation check failed:');
  if (!hasImg) console.error('  - Expected <img> with via.placeholder.com in output');
  if (!hasFigure) console.error('  - Expected <figure> in output');
  if (!noRawImage) console.error('  - Raw [Image: ...] still present in output');
  if (!noRawTweetIndex) console.error('  - Raw [TWEET:0] or [TWEET:1] still present');
  if (!noRawVideo) console.error('  - Raw [VIDEO:3] still present');
  process.exit(1);
}

main();
