/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@opsninja/db$': '<rootDir>/../../packages/db/src/index.ts',
    '^@opsninja/db/(.*)$': '<rootDir>/../../packages/db/src/$1',
    '^@opsninja/observability$': '<rootDir>/../../packages/observability/src/index.ts',
    '^@opsninja/observability/(.*)$': '<rootDir>/../../packages/observability/src/$1',
  },
};
