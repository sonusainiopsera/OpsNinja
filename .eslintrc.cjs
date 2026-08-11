'use strict';

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json', './apps/*/tsconfig.json', './packages/*/tsconfig.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',

    // ─── Data-access boundary rule ────────────────────────────────────────────
    // Only files inside apps/api/src/data/** may import the raw pool from
    // packages/db. All other code must use UnitOfWork / TenantRepository so that
    // every query runs inside the bound tenant transaction.
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@opsninja/db', '@opsninja/db/*'],
            importNames: ['pool', 'createPool', 'Pool', 'pgPool', 'drizzlePool'],
            message:
              'Raw database pool access is restricted to apps/api/src/data/**. ' +
              'Use UnitOfWork.withTenantTransaction() or extend TenantRepository instead.',
          },
        ],
      },
    ],
  },

  overrides: [
    // ─── Data module: lift raw-pool restriction ────────────────────────────────
    {
      files: ['apps/api/src/data/**/*.ts'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },

    // ─── Test files: relax some rules ─────────────────────────────────────────
    {
      files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        'no-restricted-imports': 'off',
      },
    },

    // ─── JavaScript config files ───────────────────────────────────────────────
    {
      files: ['*.cjs', '*.js'],
      env: { node: true },
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-require-imports': 'off',
      },
    },
  ],
};
