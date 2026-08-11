'use strict';

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./apps/api/tsconfig.json', './packages/shared/tsconfig.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'boundaries'],
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
  settings: {
    'boundaries/elements': [
      { type: 'shared', pattern: 'packages/shared/src/**/*' },
      { type: 'common', pattern: 'apps/api/src/common/**/*' },
      { type: 'observability', pattern: 'apps/api/src/observability/**/*' },
      { type: 'config', pattern: 'apps/api/src/config/**/*' },
      { type: 'health', pattern: 'apps/api/src/health/**/*' },
      { type: 'openapi', pattern: 'apps/api/src/openapi/**/*' },
      { type: 'identity', pattern: 'apps/api/src/modules/identity/**/*' },
      { type: 'organizations', pattern: 'apps/api/src/modules/organizations/**/*' },
      { type: 'tickets', pattern: 'apps/api/src/modules/tickets/**/*' },
      { type: 'sla', pattern: 'apps/api/src/modules/sla/**/*' },
      { type: 'views', pattern: 'apps/api/src/modules/views/**/*' },
      { type: 'reporting', pattern: 'apps/api/src/modules/reporting/**/*' },
      { type: 'integrations', pattern: 'apps/api/src/modules/integrations/**/*' },
    ],
    'boundaries/ignore': ['**/*.spec.ts', '**/test/**'],
  },
  rules: {
    // Enforce zero `any` usage — fails the build
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-call': 'error',
    '@typescript-eslint/no-unsafe-return': 'error',
    '@typescript-eslint/no-unsafe-argument': 'error',

    // Module boundary enforcement:
    // Domain modules MUST NOT import repositories or schema files from other domain modules.
    // This prevents cross-module database access at the lint level.
    'boundaries/element-types': [
      'error',
      {
        default: 'allow',
        rules: [
          // Cross-module imports of repository/schema/entity files are forbidden
          {
            from: [
              'identity',
              'organizations',
              'tickets',
              'sla',
              'views',
              'reporting',
              'integrations',
            ],
            disallow: [
              [
                'identity',
                { specifiers: { matchValue: '\\.(repository|schema|entity)\\.ts$' } },
              ],
              [
                'organizations',
                { specifiers: { matchValue: '\\.(repository|schema|entity)\\.ts$' } },
              ],
              [
                'tickets',
                { specifiers: { matchValue: '\\.(repository|schema|entity)\\.ts$' } },
              ],
              [
                'sla',
                { specifiers: { matchValue: '\\.(repository|schema|entity)\\.ts$' } },
              ],
              [
                'views',
                { specifiers: { matchValue: '\\.(repository|schema|entity)\\.ts$' } },
              ],
              [
                'reporting',
                { specifiers: { matchValue: '\\.(repository|schema|entity)\\.ts$' } },
              ],
              [
                'integrations',
                { specifiers: { matchValue: '\\.(repository|schema|entity)\\.ts$' } },
              ],
            ],
          },
        ],
      },
    ],
  },
  overrides: [
    {
      // Relax rules for test files
      files: ['**/*.spec.ts', '**/test/**/*.ts'],
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
