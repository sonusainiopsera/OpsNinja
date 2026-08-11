/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/contract/.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@opsninja/db$': '<rootDir>/../../packages/db/src/index.ts',
    '^@opsninja/db/(.*)$': '<rootDir>/../../packages/db/src/$1',
    '^@opsninja/observability$': '<rootDir>/../../packages/observability/src/index.ts',
    '^@opsninja/crypto$': '<rootDir>/../../packages/crypto/src/index.ts',
    '^@opsninja/api-types$': '<rootDir>/../../packages/api-types/src/index.ts',
    '^@opsninja/api-types/(.*)$': '<rootDir>/../../packages/api-types/src/$1',
  },
};
