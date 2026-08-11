'use strict';

/**
 * Portal ESLint config — import boundary enforcement.
 *
 * CRITICAL: The portal may ONLY import from the portal-safe ui-kit entry point.
 * Importing the root barrel (@opsninja/ui-kit) or any agent-only module is a
 * trust-boundary violation and must fail lint.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'next/core-web-vitals',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          // Block the root barrel — must use @opsninja/ui-kit/portal
          {
            group: ['@opsninja/ui-kit'],
            importNamePattern: '^(?!.*portal).*$',
            message:
              'Portal must import from @opsninja/ui-kit/portal (portal-safe subset), not the root barrel.',
          },
          // Block agent-only components by name
          {
            group: ['**/SlaCountdown/**', '**/SlaClockProvider*'],
            message:
              'SlaCountdown and SlaClockProvider are agent-only. Use SlaHint from @opsninja/ui-kit/portal.',
          },
          // Block agent shell components
          {
            group: [
              '**/components/shell/Sidebar*',
              '**/components/shell/TenantSwitcher*',
              '**/components/shell/GlobalSearch*',
              '**/components/shell/LiveStatusPill*',
              '**/components/shell/ExportMenu*',
              '**/AppShell*',
            ],
            message:
              'Agent-only shell components (Sidebar, TenantSwitcher, GlobalSearch, LiveStatusPill, ExportMenu) must not be imported in the portal.',
          },
          // Block internal-note components
          {
            group: ['**/*InternalNote*', '**/*internal-note*', '**/*NotePrivate*'],
            message:
              'Internal note components are agent-only and must not be imported in the portal.',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      // Allow the deliberately violating lint fixture to exist without being linted
      files: ['test/fixtures/lint-violation-fixture.ts'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
};
