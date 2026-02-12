/**
 * Strategy routes for pitch generation and strategy management
 * Complements strategy-subscriptions.js (subscription/payment endpoints)
 */

import express from 'express';
import db from '../services/database.js';
import openaiService from '../services/openai.js';
import DatabaseAuthService from '../services/auth-database.js';

const router = express.Router();
const authService = new DatabaseAuthService();

/**
 * GET /api/v1/strategies/:id/pitch
 * Generate LLM-powered pitch and pricing rationale for a strategy
 * Streams content via SSE (Server-Sent Events)
 * Authentication: Token passed via query param (EventSource can't send headers)
 * Note: Uses GET instead of POST because EventSource only supports GET
 */
router.get('/:id/pitch', async (req, res) => {
  const { id } = req.params;
  const token = req.query.token;

  // Validate auth token from query params (EventSource can't send headers)
  let userId = null;
  if (token) {
    try {
      const decoded = authService.verifyToken(token);
      userId = decoded?.userId;
    } catch (error) {
      console.warn('⚠️ Invalid auth token for SSE pitch:', error.message);
      res.status(401).set('Content-Type', 'text/plain').end('Unauthorized');
      return;
    }
  }

  if (!userId) {
    res.status(401).set('Content-Type', 'text/plain').end('Unauthorized');
    return;
  }

  console.log(`🎯 Strategy pitch request: strategyId=${id}, userId=${userId}`);

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders?.();

  try {
    // Fetch strategy data from audiences table
    const strategyQuery = 'SELECT * FROM audiences WHERE id = $1';
    const strategyResult = await db.query(strategyQuery, [id]);

    if (!strategyResult.rows || strategyResult.rows.length === 0) {
      console.warn(`⚠️ Strategy not found: ${id}`);
      res.write(`data: ${JSON.stringify({ type: 'error', content: 'Strategy not found' })}\n\n`);
      return res.end();
    }

    const strategyData = strategyResult.rows[0];
    console.log(`✅ Found strategy: ${strategyData.id}`);

    // Stream pitch generation
    console.log('🎯 Starting pitch generation...');
    const pitchStream = openaiService.generateStrategyPitch(strategyData);

    for await (const chunk of pitchStream) {
      res.write(`data: ${JSON.stringify({ type: 'pitch-chunk', content: chunk })}\n\n`);
    }

    console.log('✅ Pitch streaming complete, starting pricing rationale...');

    // Stream pricing rationale generation
    const pricingStream = openaiService.generatePricingRationale(strategyData);

    for await (const chunk of pricingStream) {
      res.write(`data: ${JSON.stringify({ type: 'pricing-chunk', content: chunk })}\n\n`);
    }

    console.log('✅ Pricing rationale streaming complete');

    // Send completion event
    res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
    res.end();

  } catch (error) {
    console.error('❌ Strategy pitch generation error:', error);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      content: error.message || 'Failed to generate strategy pitch'
    })}\n\n`);
    res.end();
  }
});

/**
 * Note: Generic GET routes for strategies are handled by audiences.js and strategy-subscriptions.js
 * This file focuses on LLM-powered strategy pitch generation
 */

export default router;
