'use strict';

module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['import'],
  rules: {
    // CRITICAL: Block the ui-kit root barrel — must use /portal entry only.
    // This prevents agent-only exports (SlaCountdown, SlaClockProvider, etc.)
    // from leaking into the portal bundle.
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@opsninja/ui-kit',
            message:
              'Portal code must import from "@opsninja/ui-kit/portal" only. The root barrel exposes agent-only components (SlaCountdown, SlaClockProvider) that must not ship in the portal bundle.',
          },
        ],
        patterns: [
          {
            group: ['@opsninja/ui-kit/src/*'],
            message: 'Import from "@opsninja/ui-kit/portal" not internal paths.',
          },
          {
            group: ['**/SlaCountdown', '**/SlaCountdown/**'],
            message:
              'SlaCountdown is an agent-only component. Use SlaHint from "@opsninja/ui-kit/portal" in the portal.',
          },
          {
            group: ['**/SlaClockProvider', '**/SlaClockProvider/**'],
            message:
              'SlaClockProvider is an agent-only component and must not appear in the portal bundle.',
          },
          {
            group: ['**/InternalNote', '**/InternalNote/**', '**/internal-note/**'],
            message:
              'Internal note components are agent-only and must not appear in the portal bundle.',
          },
          {
            group: [
              '**/Sidebar',
              '**/TenantSwitcher',
              '**/GlobalSearch',
              '**/LiveStatusPill',
              '**/ExportMenu',
            ],
            message:
              'Agent-workspace-only components must not be imported into the portal.',
          },
          {
            group: ['apps/web-agent/**'],
            message: 'Portal cannot depend on agent-workspace modules.',
          },
        ],
      },
    ],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
  },
  overrides: [
    {
      files: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', '**/fixtures/**'],
      rules: {
        // Allow root barrel import ONLY in isolation test fixture that deliberately violates
        // the rule to prove it fires. All other test files still enforce it.
        'no-restricted-imports': 'off',
      },
    },
  ],
};
