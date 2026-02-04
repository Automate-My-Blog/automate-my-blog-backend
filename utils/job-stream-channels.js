/**
 * Redis channel names for job stream (Phase 5). Shared by API (stream-manager) and worker.
 */

const PREFIX = 'jobs:';
const SUFFIX = ':events';
const NARRATIVE_SUFFIX = ':narrative';

export function getJobEventsChannel(jobId) {
  return PREFIX + jobId + SUFFIX;
}

export function getJobNarrativeChannel(jobId) {
  return PREFIX + jobId + NARRATIVE_SUFFIX;
}

export const JOB_EVENTS_PATTERN = 'jobs:*:events';
export const JOB_NARRATIVE_PATTERN = 'jobs:*:narrative';
