/**
 * Playwright configuration for the OpsNinja critical-journey regression suite.
 *
 * Three projects map to the three deployed clients:
 *   agent   — web-agent at AGENT_BASE_URL (default http://localhost:3000)
 *   admin   — admin surfaces within web-agent at /admin
 *   portal  — web-portal at PORTAL_BASE_URL (default http://localhost:3001)
 *
 * Test tags:
 *   @smoke — fast promotion gate (≥40 assertions); must pass 100 % for deploy
 *   @full  — complete regression suite run on staging
 *   @synthetic — read-mostly, non-destructive; run against production synthetic tenant
 *
 * CI invocation examples:
 *   dev smoke gate:      npx playwright test --grep @smoke
 *   staging verification: npx playwright test --grep @full
 *   production synthetic: npx playwright test --grep @synthetic
 */

import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'path';

export const AGENT_BASE_URL = process.env['AGENT_BASE_URL'] ?? 'http://localhost:3000';
export const PORTAL_BASE_URL = process.env['PORTAL_BASE_URL'] ?? 'http://localhost:3001';
export const API_BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:8080';

export default defineConfig({
  testDir: '.',
  // Discover specs in journeys/, a11y/ and unit/
  testMatch: ['journeys/**/*.spec.ts', 'a11y/**/*.spec.ts', 'unit/**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  // Up to 2 retries in CI; never hidden — reported in JUnit output
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 4 : undefined,
  reporter: [
    ['list'],
    ['junit', { outputFile: resolve(__dirname, '../../test-results/e2e/junit.xml') }],
    ['html', { open: 'never', outputFolder: resolve(__dirname, '../../test-results/e2e/html') }],
  ],
  use: {
    // Capture trace / screenshot / video on failure for fast triage
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'agent',
      testMatch: ['journeys/ticket-lifecycle.spec.ts',
                  'journeys/sla-pause-resume-reminders.spec.ts',
                  'journeys/jira-round-trip.spec.ts',
                  'journeys/ai-synthesis-and-csat.spec.ts',
                  'journeys/dashboard-realtime.spec.ts',
                  'journeys/report-export.spec.ts',
                  'a11y/keyboard-navigation.spec.ts',
                  'unit/**/*.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: AGENT_BASE_URL,
        storageState: undefined,
      },
    },
    {
      name: 'portal',
      testMatch: ['journeys/ticket-lifecycle.spec.ts',
                  'a11y/keyboard-navigation.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: PORTAL_BASE_URL,
        storageState: undefined,
      },
    },
  ],
});
