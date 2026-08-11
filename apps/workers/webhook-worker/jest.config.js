'use strict';

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'src/.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@opsninja/db$': '<rootDir>/../../../packages/db/src/index.ts',
    '^@opsninja/crypto$': '<rootDir>/../../../packages/crypto/src/index.ts',
    '^@opsninja/observability$': '<rootDir>/../../../packages/observability/src/index.ts',
    '^@opsninja/webhooks$': '<rootDir>/../../../packages/webhooks/src/index.ts',
  },
};
