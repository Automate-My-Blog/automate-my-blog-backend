/**
 * Fixture data for calendar testbed (staging.automatemyblog.com/calendar-testbed).
 * Used when ?testbed=1 or X-Calendar-Testbed: 1 to bypass purchase/worker requirements.
 * Shape matches content_ideas from content-calendar generation.
 * Length matches CONTENT_CALENDAR_DAYS (default 7).
 */

const CONTENT_CALENDAR_DAYS = parseInt(process.env.CONTENT_CALENDAR_DAYS, 10) || 7;
const FORMATS = ['how-to', 'listicle', 'guide', 'case-study', 'comparison', 'checklist'];

const FIXTURE_IDEAS = Array.from({ length: CONTENT_CALENDAR_DAYS }, (_, i) => ({
  dayNumber: i + 1,
  title: `Sample blog post idea for day ${i + 1}`,
  searchIntent: `Users search for solutions to common problems in their industry`,
  format: FORMATS[i % FORMATS.length],
  keywords: i % 3 === 0 ? ['keyword1', 'keyword2'] : []
}));

/**
 * Returns fixture N-day content ideas for testbed mode (default 7 days).
 * @returns {Array<{dayNumber: number, title: string, searchIntent?: string, format?: string, keywords?: string[]}>}
 */
export function getFixtureContentIdeas() {
  return [...FIXTURE_IDEAS];
}

/**
 * Check if request is in calendar testbed mode.
 * Enable via query ?testbed=1 or header X-Calendar-Testbed: 1.
 * Only enabled when ENABLE_CALENDAR_TESTBED is set (staging) to avoid production use.
 */
export function isCalendarTestbed(req) {
  if (process.env.ENABLE_CALENDAR_TESTBED !== '1' && process.env.ENABLE_CALENDAR_TESTBED !== 'true') {
    return false;
  }
  return (
    req?.query?.testbed === '1' ||
    req?.headers?.['x-calendar-testbed'] === '1'
  );
}
