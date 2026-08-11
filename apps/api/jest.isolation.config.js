/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: [
    'test/isolation-contract\\.e2e-spec\\.ts$',
    'test/portal-isolation\\.e2e-spec\\.ts$',
    'test/tenant-isolation\\.e2e-spec\\.ts$',
  ],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  testTimeout: 60000,
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
  moduleNameMapper: {
    '^@opsninja/db$': '<rootDir>/../../packages/db/src/index.ts',
    '^@opsninja/db/(.*)$': '<rootDir>/../../packages/db/src/$1',
    '^@opsninja/observability$': '<rootDir>/../../packages/observability/src/index.ts',
    '^@opsninja/crypto$': '<rootDir>/../../packages/crypto/src/index.ts',
  },
  // Runtime budget: isolation harness must complete within 120 seconds
  testTimeout: 120000,
};
