/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@opsninja/db$': '<rootDir>/../../../packages/db/src/index.ts',
    '^@opsninja/db/(.*)$': '<rootDir>/../../../packages/db/src/$1',
    '^@opsninja/api-types$': '<rootDir>/../../../packages/api-types/src/index.ts',
    '^@opsninja/api-types/(.*)$': '<rootDir>/../../../packages/api-types/src/$1',
  },
};
