/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  testTimeout: 60_000,
  moduleNameMapper: {
    '^@opsninja/db$': '<rootDir>/../../packages/db/src/index.ts',
    '^@opsninja/db/(.*)$': '<rootDir>/../../packages/db/src/$1',
    '^@opsninja/observability$': '<rootDir>/../../packages/observability/src/index.ts',
    '^@opsninja/observability/(.*)$': '<rootDir>/../../packages/observability/src/$1',
  },
};
