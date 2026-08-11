'use strict';

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'src/.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
      },
    ],
  },
  moduleNameMapper: {
    '^@opsninja/db$': '<rootDir>/../../packages/db/src/index.ts',
    '^@opsninja/db/(.*)$': '<rootDir>/../../packages/db/src/$1',
    '^@opsninja/crypto$': '<rootDir>/../../packages/crypto/src/index.ts',
    '^@opsninja/crypto/(.*)$': '<rootDir>/../../packages/crypto/src/$1',
    '^@opsninja/filter-compiler$': '<rootDir>/../../packages/filter-compiler/src/index.ts',
    '^@opsninja/filter-compiler/(.*)$': '<rootDir>/../../packages/filter-compiler/src/$1',
    '^@opsninja/observability$': '<rootDir>/../../packages/observability/src/index.ts',
    '^@opsninja/observability/(.*)$': '<rootDir>/../../packages/observability/src/$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts',
    '!src/**/*.module.ts',
  ],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    },
  },
};
