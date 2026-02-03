/**
 * Redis channel names for job stream (Phase 5). Shared by API (stream-manager) and worker.
 */

const PREFIX = 'jobs:';
const SUFFIX = ':events';

export function getJobEventsChannel(jobId) {
  return PREFIX + jobId + SUFFIX;
}

export const JOB_EVENTS_PATTERN = 'jobs:*:events';
