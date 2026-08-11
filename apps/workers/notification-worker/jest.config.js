/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'src/__tests__/.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@opsninja/db$': '<rootDir>/../../../packages/db/src/index.ts',
    '^@opsninja/observability$': '<rootDir>/../../../packages/observability/src/index.ts',
  },
};
