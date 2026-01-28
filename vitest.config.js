import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    setupFiles: ['tests/setup.js'],
    include: ['tests/**/*.test.js'],
    exclude: ['**/node_modules/**', '**/test-*.js', '**/*-test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      include: [
        'utils/**/*.js',
        'services/**/*.js',
        'jobs/**/*.js',
      ],
      exclude: [
        '**/*.test.js',
        '**/test-*.js',
        '**/index.js',
        'tests/**',
        'services/database.js',
        'services/auth-database.js',
      ],
    },
    testTimeout: 5000,
    hookTimeout: 5000,
    isolate: true,
  },
});
