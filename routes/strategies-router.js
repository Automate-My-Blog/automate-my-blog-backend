/**
 * Single composite router for /api/v1/strategies.
 * Route order is explicit here so we never hit 405 or wrong-handler due to mount order.
 * See docs/STRATEGY_ROUTES_ORDER.md.
 *
 * Order: subscription routes first (literal + :id), then strategy routes (overview, :id/pitch, :id/sample-content-ideas).
 */

import express from 'express';
import { registerRoutes as registerSubscriptionRoutes } from './strategy-subscriptions.js';
import { registerRoutes as registerStrategyRoutes } from './strategies.js';

const router = express.Router();

registerSubscriptionRoutes(router);
registerStrategyRoutes(router);

export default router;
