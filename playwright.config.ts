import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
import { env } from './config/env';

const isCI = !!process.env.CI;

// BDD is used for the UI project only. `bddgen` turns the .feature files into Playwright specs.
const uiTestDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: ['features/steps/**/*.ts', 'src/fixtures/ui.fixtures.ts'],
  outputDir: '.features-gen/ui',
});

export default defineConfig({
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: isCI ? [['blob'], ['github'], ['list']] : [['list'], ['html', { open: 'never' }]],
  use: {
    // Retries are off locally, so keep the trace of a failure instead of waiting for a retry.
    trace: isCI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: 'ui',
      testDir: uiTestDir,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: env.sauce.baseUrl,
        testIdAttribute: 'data-test',
      },
    },
    {
      name: 'a11y',
      testDir: 'tests/a11y',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: env.sauce.baseUrl,
        testIdAttribute: 'data-test',
      },
    },
    {
      name: 'api',
      testDir: 'tests/api',
      // The shared Heroku sandbox can be slow on cold start.
      timeout: 60_000,
      use: {
        baseURL: env.booker.baseUrl,
        // restful-booker answers 418 to some Accept values (for example text/html), so pin JSON.
        extraHTTPHeaders: { Accept: 'application/json' },
      },
    },
    {
      name: 'unit',
      testDir: 'tests/unit',
    },
  ],
});
