/**
 * BullMQ worker for async jobs: website_analysis, content_generation.
 * Run as a separate process: node jobs/job-worker.js
 * Requires REDIS_URL and DATABASE_URL.
 */

import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import {
  getJobRow,
  updateJobProgress,
  isJobCancelled,
  QUEUE_NAME,
  JOB_TYPES,
  normalizeRedisUrl,
  isRedisUrlValid
} from '../services/job-queue.js';
import { getJobEventsChannel } from '../utils/job-stream-channels.js';

const raw = process.env.REDIS_URL || '';
const url = normalizeRedisUrl(raw);
if (!url) {
  console.error('REDIS_URL is required. Set it to your Redis URL (e.g. rediss://default:token@host.upstash.io:6379).');
  process.exit(1);
}
if (!isRedisUrlValid(url)) {
  console.error(
    'REDIS_URL must be a full TCP URL (e.g. rediss://default:token@host.upstash.io:6379), not a path or redis-cli fragment.'
  );
  process.exit(1);
}
if (raw.trim() !== url) {
  console.warn('[job-worker] Using extracted Redis URL from REDIS_URL (stripped surrounding text).');
}

const redisOpts = { maxRetriesPerRequest: null };
if (process.env.REDIS_TOKEN) redisOpts.password = process.env.REDIS_TOKEN;
const connection = new IORedis(url, redisOpts);

function isCancelledFactory(jobId) {
  return () => isJobCancelled(jobId).then((v) => v === true);
}

function publishJobStreamEvent(connection, jobId, event, data) {
  const channel = getJobEventsChannel(jobId);
  const payload = JSON.stringify({ event, data });
  connection.publish(channel, payload).catch((err) => {
    console.warn('[job-worker] stream publish error:', err?.message || err);
  });
}

async function processWebsiteAnalysis(jobId, input, context) {
  const { runWebsiteAnalysisPipeline, PROGRESS_STEPS } = await import('../services/website-analysis-pipeline.js');
  const totalSteps = PROGRESS_STEPS.length;
  const stepWeight = 100 / totalSteps;

  const onProgress = (stepIndex, _label, progress, estimated, extra = {}) => {
    const base = stepIndex * stepWeight;
    const pct = Math.round(base + (progress / 100) * stepWeight);
    const currentStep = PROGRESS_STEPS[stepIndex];
    const estimatedRemaining = estimated ?? null;
    const phase = extra?.phase ?? null;
    const detail = extra?.detail ?? null;
    const eventData = {
      progress: Math.min(100, pct),
      currentStep,
      estimatedTimeRemaining: estimatedRemaining,
      ...(phase && { phase }),
      ...(detail && { detail }),
      ...(extra?.stepIndex != null && { stepIndex: extra.stepIndex }),
      ...(extra?.phaseIndex != null && { phaseIndex: extra.phaseIndex }),
      ...(extra?.totalPhases != null && { totalPhases: extra.totalPhases })
    };
    updateJobProgress(jobId, {
      progress: Math.min(100, pct),
      current_step: phase ? `${currentStep}: ${phase}` : currentStep,
      estimated_seconds_remaining: estimatedRemaining
    }).catch((e) => console.warn('Progress update failed:', e.message));
    publishJobStreamEvent(connection, jobId, 'progress-update', eventData);

    // Publish granular scrape thoughts so the UI can show a step-by-step scraping log
    if (extra?.scrapePhase != null) {
      publishJobStreamEvent(connection, jobId, 'scrape-phase', {
        phase: extra.scrapePhase,
        message: extra.scrapeMessage ?? extra.phase ?? extra.scrapePhase,
        ...(extra?.url && { url: extra.url })
      });
    }
  };

  const result = await runWebsiteAnalysisPipeline(input, context, {
    onProgress,
    isCancelled: isCancelledFactory(jobId)
  });
  return result;
}

async function processContentGeneration(jobId, input, context) {
  const userId = context.userId;
  if (!userId) throw new Error('content_generation requires userId');

  const enhancedBlogGenerationService = (await import('../services/enhanced-blog-generation.js')).default;
  const billingService = (await import('../services/billing.js')).default;

  const {
    topic,
    businessInfo,
    organizationId,
    additionalInstructions,
    options = {}
  } = input;

  if (!topic || !businessInfo || !organizationId) {
    throw new Error('topic, businessInfo, and organizationId are required');
  }

  const hasCredits = await billingService.hasCredits(userId);
  if (!hasCredits) {
    const err = new Error('Insufficient credits');
    err.code = 'INSUFFICIENT_CREDITS';
    throw err;
  }

  await updateJobProgress(jobId, {
    progress: 10,
    current_step: 'Writing...',
    estimated_seconds_remaining: 60
  }).catch(() => {});
  publishJobStreamEvent(connection, jobId, 'progress-update', {
    progress: 10,
    currentStep: 'Writing...',
    estimatedTimeRemaining: 60
  });

  const result = await enhancedBlogGenerationService.generateCompleteEnhancedBlog(
    topic,
    businessInfo,
    organizationId,
    {
      additionalInstructions,
      includeVisuals: options.includeVisuals !== false,
      ...options
    }
  );

  let savedPost = null;
  if (options.autoSave !== false) {
    try {
      savedPost = await enhancedBlogGenerationService.saveEnhancedBlogPost(
        userId,
        organizationId,
        result,
        { status: options.status || 'draft' }
      );
      try {
        await billingService.useCredit(userId, 'generation');
      } catch (e) {
        console.warn('Credit deduct failed:', e.message);
      }
    } catch (e) {
      console.warn('Save failed:', e.message);
    }
  }

  return {
    success: true,
    data: result,
    savedPost,
    enhancedGeneration: true,
    metadata: {
      generationTime: result.generationMetadata?.duration,
      tokensUsed: result.generationMetadata?.tokensUsed,
      qualityPrediction: result.qualityPrediction,
      dataCompleteness: result.organizationContext?.dataCompleteness,
      visualSuggestions: result.visualContentSuggestions?.length || 0
    },
    imageGeneration: {
      hasPlaceholders: result._hasImagePlaceholders || false,
      needsImageGeneration: !!(result._hasImagePlaceholders && savedPost?.id),
      blogPostId: savedPost?.id || null,
      topic: result._topicForImages || null,
      organizationId: result._organizationIdForImages || null
    }
  };
}

const processor = async (bullJob) => {
  const { jobId } = bullJob.data;
  const row = await getJobRow(jobId);
  if (!row) {
    console.warn(`Job ${jobId} not found in DB, skipping`);
    return;
  }
  if (row.status !== 'queued') {
    console.warn(`Job ${jobId} not queued (${row.status}), skipping`);
    return;
  }

  const input = row.input || {};
  const context = {
    userId: row.user_id || null,
    sessionId: row.session_id || null,
    tenantId: row.tenant_id || null
  };

  await updateJobProgress(jobId, {
    status: 'running',
    progress: 0,
    current_step: null,
    started_at: new Date()
  });
  publishJobStreamEvent(connection, jobId, 'step-change', {
    progress: 0,
    currentStep: null,
    estimatedTimeRemaining: null
  });

  if (await isJobCancelled(jobId)) {
    await updateJobProgress(jobId, {
      status: 'failed',
      error: 'Cancelled',
      finished_at: new Date()
    });
    publishJobStreamEvent(connection, jobId, 'failed', { error: 'Cancelled', errorCode: null });
    return;
  }

  try {
    let result;
    if (row.type === 'website_analysis') {
      result = await processWebsiteAnalysis(jobId, input, context);
    } else if (row.type === 'content_generation') {
      result = await processContentGeneration(jobId, input, context);
    } else {
      throw new Error(`Unknown job type: ${row.type}`);
    }

    if (await isJobCancelled(jobId)) {
      await updateJobProgress(jobId, {
        status: 'failed',
        error: 'Cancelled',
        finished_at: new Date()
      });
      publishJobStreamEvent(connection, jobId, 'failed', { error: 'Cancelled', errorCode: null });
      return;
    }

    await updateJobProgress(jobId, {
      status: 'succeeded',
      progress: 100,
      current_step: null,
      estimated_seconds_remaining: null,
      result,
      error: null,
      finished_at: new Date()
    });
    publishJobStreamEvent(connection, jobId, 'complete', { result });
  } catch (err) {
    const cancelled = await isJobCancelled(jobId);
    const errorMessage = cancelled ? 'Cancelled' : (err.message || 'Job failed');
    const errorCode = err.code || null;
    await updateJobProgress(jobId, {
      status: 'failed',
      error: errorMessage,
      error_code: errorCode,
      finished_at: new Date()
    });
    publishJobStreamEvent(connection, jobId, 'failed', { error: errorMessage, errorCode });
    if (!cancelled) throw err;
  }
};

const worker = new Worker(QUEUE_NAME, processor, {
  connection,
  concurrency: 3
});

worker.on('completed', (job) => console.log(`Job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`Job ${job?.id} failed:`, err?.message));

async function shutdown() {
  await worker.close();
  connection.disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log(`Worker started for queue "${QUEUE_NAME}". Processing: ${JOB_TYPES.join(', ')}.`);
