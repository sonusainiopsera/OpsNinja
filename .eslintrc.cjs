/**
 * ESLint configuration for the OpsNinja monorepo.
 *
 * Key rules for data-access boundaries:
 *
 *   no-restricted-imports (applied to all files OUTSIDE apps/api/src/data):
 *     Prevents importing @opsninja/db pool or createTransactionHandle outside
 *     the data module. This enforces the architectural constraint that only the
 *     unit-of-work and tenant-repository files may acquire raw database connections.
 *
 *   Rationale (from architecture.md):
 *     "No code path outside apps/api/src/data may obtain a database connection,
 *     enforced by lint and code review."
 */

'use strict';

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: [
      './tsconfig.base.json',
      './apps/api/tsconfig.json',
      './packages/db/tsconfig.json',
      './packages/filter-compiler/tsconfig.json',
      './packages/observability/tsconfig.json',
      './packages/crypto/tsconfig.json',
      './packages/test-seed/tsconfig.json',
      './packages/events/tsconfig.json',
      './apps/workers/notification-worker/tsconfig.json',
    ],
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  rules: {
    // -----------------------------------------------------------------------
    // TypeScript
    // -----------------------------------------------------------------------
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/no-misused-promises': 'error',

    // -----------------------------------------------------------------------
    // Import order
    // -----------------------------------------------------------------------
    'import/order': [
      'warn',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc' },
      },
    ],
  },

  overrides: [
    // -----------------------------------------------------------------------
    // Data-access boundary: apply to ALL files EXCEPT the data module itself.
    //
    // Restricts direct imports of raw pool/connection utilities to the data
    // layer. Services, controllers, and other modules must go through
    // TenantRepository subclasses or withTenantTransaction.
    // -----------------------------------------------------------------------
    {
      // Match everything except the data module and the db package itself.
      files: ['**/*.ts'],
      excludedFiles: [
        'apps/api/src/data/**/*.ts',
        // Identity repositories access the DB directly (auth runs outside tenant context).
        'apps/api/src/modules/identity/repositories/**/*.ts',
        // Auth guard / audit service write to audit_logs before a tenant transaction opens.
        'apps/api/src/common/auth/**/*.ts',
        'packages/db/src/**/*.ts',
        '**/*.spec.ts',
        '**/*.e2e-spec.ts',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@opsninja/db'],
                importNames: ['pool', 'createPool', 'createTransactionHandle', 'db'],
                message:
                  'Direct database pool/client imports are restricted to apps/api/src/data. ' +
                  'Use TenantRepository subclasses or withTenantTransaction instead.',
              },
            ],
          },
        ],
      },
    },

    // -----------------------------------------------------------------------
    // Filter-compiler boundary: ticket/views/reporting modules must not import
    // @opsninja/filter-compiler internals directly — only through the public
    // index. This prevents bypassing validation by calling compile() directly.
    // -----------------------------------------------------------------------
    {
      files: [
        'apps/api/src/modules/views/**/*.ts',
        'apps/api/src/modules/reporting/**/*.ts',
        'apps/api/src/modules/tickets/**/*.ts',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@opsninja/filter-compiler/src/*'],
                message:
                  'Import from @opsninja/filter-compiler (public index) only, not internal paths. ' +
                  'Use parseFilterAst + compileToPredicate from the package root.',
              },
            ],
          },
        ],
      },
    },

    // -----------------------------------------------------------------------
    // Reporting module boundary: the reporting module may not import the
    // primary DB pool/client. It owns a dedicated read-replica pool injected
    // under REPORTING_DB. Cross-module reads go through service interfaces.
    // The infrastructure sub-directory is exempt because reporting-db.client.ts
    // legitimately creates a pg.Pool from the 'pg' package directly (not from
    // @opsninja/db), and the ESLint rule already restricts @opsninja/db imports.
    // -----------------------------------------------------------------------
    {
      files: ['apps/api/src/modules/reporting/**/*.ts'],
      excludedFiles: [
        'apps/api/src/modules/reporting/infrastructure/reporting-db.client.ts',
        '**/*.spec.ts',
        '**/*.e2e-spec.ts',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@opsninja/db'],
                importNames: ['pool', 'createPool', 'createTransactionHandle', 'db'],
                message:
                  'Reporting module must not use the primary DB client. ' +
                  'Use the REPORTING_DB injection token instead.',
              },
              {
                group: ['@opsninja/filter-compiler/src/*'],
                message:
                  'Import from @opsninja/filter-compiler (public index) only, not internal paths.',
              },
            ],
          },
        ],
      },
    },

    // -----------------------------------------------------------------------
    // Test files: relax some strict rules for test helpers and mocks.
    // -----------------------------------------------------------------------
    {
      files: ['**/*.spec.ts', '**/*.e2e-spec.ts', '**/test/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-floating-promises': 'off',
      },
    },
  ],

  ignorePatterns: ['dist/', 'node_modules/', 'coverage/', '*.js'],
};
