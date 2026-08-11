/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: [
    // Pre-existing isolation contracts
    'test/isolation-contract\\.e2e-spec\\.ts$',
    'test/portal-isolation\\.e2e-spec\\.ts$',
    'test/tenant-isolation\\.e2e-spec\\.ts$',
    // WO-043: Ticketing isolation matrix suite
    'test/isolation/table-matrix\\.spec\\.ts$',
    'test/isolation/route-matrix\\.spec\\.ts$',
    'test/isolation/org-scope\\.spec\\.ts$',
    'test/isolation/portal-visibility\\.spec\\.ts$',
    // WO-043: Ticket lifecycle e2e
    'test/e2e/ticket-lifecycle\\.spec\\.ts$',
    // WO-043: Suite helper unit tests (always run, DB-independent)
    'test/unit/suite-helpers\\.spec\\.ts$',
    // WO-098: Cross-Tenant Isolation and RBAC Negative Test Suite
    'test/isolation/rest-cross-tenant\\.spec\\.ts$',
    'test/isolation/rls-raw-sql\\.spec\\.ts$',
    'test/isolation/db-role-privileges\\.spec\\.ts$',
    'test/isolation/saved-view-filter-injection\\.spec\\.ts$',
    'test/isolation/jira-webhook-ownership\\.spec\\.ts$',
    'test/isolation/outbound-webhook-ssrf\\.spec\\.ts$',
  ],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
  moduleNameMapper: {
    '^@opsninja/db$': '<rootDir>/../../packages/db/src/index.ts',
    '^@opsninja/db/(.*)$': '<rootDir>/../../packages/db/src/$1',
    '^@opsninja/observability$': '<rootDir>/../../packages/observability/src/index.ts',
    '^@opsninja/crypto$': '<rootDir>/../../packages/crypto/src/index.ts',
  },
  // Runtime budget: full ticketing isolation suite must complete within 12 minutes
  testTimeout: 120000,
  // JUnit output for CI triage
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: '<rootDir>/test-results/isolation',
      outputName:      'isolation-results.xml',
      classNameTemplate: '{classname}',
      titleTemplate:   '{title}',
      ancestorSeparator: ' › ',
      addFileAttribute: 'true',
    }],
  ],
  // 70% changed-line coverage gate for tickets, views, and filter-compiler packages
  coverageThreshold: {
    global: { lines: 70 },
  },
};
