/**
 * Test mocks and helpers.
 * Use for freezing time, silencing console, mocking HTTP, etc.
 */

/**
 * Run fn with system time frozen to a given date.
 * Restores real time after fn resolves.
 * @param {Date|string|number} frozen - Date to freeze to
 * @param {() => Promise<any>|any} fn - Function to run
 */
export async function withFrozenTime(frozen, fn) {
  const realDateNow = Date.now;
  const realDate = globalThis.Date;
  const at = new Date(frozen).getTime();

  globalThis.Date.now = () => at;
  globalThis.Date = class extends realDate {
    static now() {
      return at;
    }
    constructor(...args) {
      if (args.length === 0) {
        super(at);
      } else {
        super(...args);
      }
    }
  };

  try {
    return await fn();
  } finally {
    globalThis.Date.now = realDateNow;
    globalThis.Date = realDate;
  }
}

/**
 * Run fn with console.log/warn/error replaced by no-ops.
 * @param {() => Promise<any>|any} fn
 */
export async function withMockedConsole(fn) {
  const log = console.log;
  const warn = console.warn;
  const error = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.warn = warn;
    console.error = error;
  }
}

/**
 * Create a mock axios instance that returns predefined responses per URL pattern.
 * @param {Record<string, { status?: number, data?: any }>} responses - Map of URL substring -> response
 */
export function createMockAxios(responses = {}) {
  const defaultResponse = { status: 200, data: '' };
  const match = (url) => {
    for (const [key, res] of Object.entries(responses)) {
      if (url.includes && url.includes(key)) return res;
    }
    return defaultResponse;
  };
  return {
    head: async (url) => {
      const r = match(url);
      return { status: r.status ?? 200, data: r.data };
    },
    get: async (url) => {
      const r = match(url);
      return { status: r.status ?? 200, data: r.data };
    },
  };
}
