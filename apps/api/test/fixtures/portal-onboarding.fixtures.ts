/**
 * Test fixtures for WO-088 portal onboarding wizard tests.
 *
 * Covers:
 *   - Verified portal user fixture
 *   - Organization snapshot fixture with DevOps metadata custom fields
 *   - Tutorial content fixture
 *   - Onboarding state row factories
 *   - Step request body factories
 */

// ---------------------------------------------------------------------------
// Fixed UUIDs (deterministic across runs)
// ---------------------------------------------------------------------------

export const ONBOARDING_TENANT_ID   = 'c0000000-0000-0000-0000-000000000001';
export const ONBOARDING_ORG_ID      = 'c1000000-0000-0000-0000-000000000001';
export const ONBOARDING_USER_ID     = 'c2000000-0000-0000-0000-000000000001';
export const ONBOARDING_STATE_ID    = 'c3000000-0000-0000-0000-000000000001';
export const ONBOARDING_CHANGE_REQ_ID = 'c4000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Verified portal user fixture (AC-14)
// ---------------------------------------------------------------------------

export const VERIFIED_PORTAL_USER = {
  id:             ONBOARDING_USER_ID,
  tenantId:       ONBOARDING_TENANT_ID,
  organizationId: ONBOARDING_ORG_ID,
  email:          'alice@acmecorp.dev',
  name:           'Alice Onboarder',
  role:           'portal_user',
  onboardingRequired: true,
};

// ---------------------------------------------------------------------------
// Organization snapshot fixture with DevOps metadata custom fields (AC-14)
// ---------------------------------------------------------------------------

export const ORG_SNAPSHOT = {
  id:             ONBOARDING_ORG_ID,
  tenantId:       ONBOARDING_TENANT_ID,
  name:           'Acme Corp DevOps',
  tier:           'enterprise',
  region:         'us-east-1',
  verifiedDomains: ['acmecorp.dev', 'acmecorp.io'],
  metadata: [
    {
      key:   'cloud_provider',
      label: 'Cloud Provider',
      type:  'text',
      value: 'AWS',
    },
    {
      key:   'jira_project_key',
      label: 'Jira Project Key',
      type:  'text',
      value: 'DEVOPS',
    },
    {
      key:   'oncall_policy',
      label: 'On-Call Policy',
      type:  'select',
      value: 'pagerduty',
    },
  ],
};

// ---------------------------------------------------------------------------
// Tutorial content fixture (AC-14)
// ---------------------------------------------------------------------------

export const TUTORIAL_CONTENT = {
  contentVersion: 'v1',
  title:          'How to submit effective DevOps support requests',
  sections: [
    {
      id:      'overview',
      heading: 'Why good tickets matter',
      body:    'Clear, detailed tickets help our team resolve your issues faster.',
    },
    {
      id:      'required-fields',
      heading: 'Required information',
      body:    'Always include: environment, reproduction steps, expected vs actual behaviour.',
    },
    {
      id:      'attachments',
      heading: 'Attach logs and screenshots',
      body:    'Logs and screenshots reduce back-and-forth significantly.',
    },
  ],
};

// ---------------------------------------------------------------------------
// Onboarding state row factories
// ---------------------------------------------------------------------------

export function makeOnboardingStateRow(overrides: Partial<{
  id:          string;
  tenantId:    string;
  userId:      string;
  currentStep: string;
  steps:       Record<string, unknown>;
  version:     number;
  completedAt: Date | null;
  createdAt:   Date;
  updatedAt:   Date;
}> = {}) {
  const now = new Date('2026-01-15T10:00:00Z');
  return {
    id:          overrides.id          ?? ONBOARDING_STATE_ID,
    tenantId:    overrides.tenantId    ?? ONBOARDING_TENANT_ID,
    userId:      overrides.userId      ?? ONBOARDING_USER_ID,
    currentStep: overrides.currentStep ?? 'verify-organization',
    steps:       overrides.steps       ?? {},
    version:     overrides.version     ?? 1,
    completedAt: overrides.completedAt !== undefined ? overrides.completedAt : null,
    createdAt:   overrides.createdAt   ?? now,
    updatedAt:   overrides.updatedAt   ?? now,
  };
}

/** Factory: state at step 2 (verify done, awaiting preferences). */
export function makeOnboardingStateAtPreferences() {
  return makeOnboardingStateRow({
    currentStep: 'preferences',
    version:     2,
    steps: {
      'verify-organization': {
        status:    'confirmed',
        updatedAt: '2026-01-15T10:00:00Z',
        data:      { confirmed: true },
      },
    },
  });
}

/** Factory: state with all required steps complete (awaiting POST /complete). */
export function makeOnboardingStateAllRequired() {
  return makeOnboardingStateRow({
    currentStep: 'tutorial',
    version:     3,
    steps: {
      'verify-organization': {
        status:    'confirmed',
        updatedAt: '2026-01-15T10:00:00Z',
        data:      { confirmed: true },
      },
      preferences: {
        status:    'confirmed',
        updatedAt: '2026-01-15T10:05:00Z',
        data:      { channels: ['email'], digestCadence: 'immediate' },
      },
    },
  });
}

/** Factory: fully completed onboarding state. */
export function makeCompletedOnboardingState() {
  return makeOnboardingStateRow({
    currentStep: 'complete',
    version:     5,
    completedAt: new Date('2026-01-15T10:10:00Z'),
    steps: {
      'verify-organization': {
        status:    'confirmed',
        updatedAt: '2026-01-15T10:00:00Z',
        data:      { confirmed: true },
      },
      preferences: {
        status:    'confirmed',
        updatedAt: '2026-01-15T10:05:00Z',
        data:      { channels: ['email'], digestCadence: 'immediate' },
      },
      tutorial: {
        status:         'skipped',
        updatedAt:      '2026-01-15T10:08:00Z',
        contentVersion: 'v1',
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Step request body factories
// ---------------------------------------------------------------------------

/** Valid confirm action for verify-organization step. */
export const VERIFY_ORG_CONFIRM_BODY = {
  action:  'confirm',
  version: 1,
} as const;

/** Valid change-request action for verify-organization step. */
export const VERIFY_ORG_CHANGE_REQUEST_BODY = {
  action:  'request_change',
  version: 1,
  fields: [
    {
      key:           'name',
      currentValue:  'Acme Corp',
      proposedValue: 'Acme Corporation',
      note:          'Official legal name changed',
    },
    {
      key:           'tier',
      currentValue:  'standard',
      proposedValue: 'enterprise',
      note:          'Upgraded contract',
    },
  ],
} as const;

/** Valid preferences body — email + immediate cadence. */
export const PREFERENCES_EMAIL_BODY = {
  channels:      ['email'],
  digestCadence: 'immediate',
  version:       2,
} as const;

/** Valid preferences body — webhook + daily_digest cadence. */
export const PREFERENCES_WEBHOOK_DAILY_BODY = {
  channels:      ['email', 'webhook'],
  digestCadence: 'daily_digest',
  version:       2,
} as const;

/** Empty channels — explicit opt-out (skips). */
export const PREFERENCES_OPT_OUT_BODY = {
  channels:      [],
  digestCadence: 'immediate',
  version:       2,
} as const;

/** Valid tutorial complete body. */
export const TUTORIAL_COMPLETE_BODY = {
  action:         'complete',
  contentVersion: 'v1',
  version:        3,
} as const;

/** Valid tutorial skip body. */
export const TUTORIAL_SKIP_BODY = {
  action:         'skip',
  contentVersion: 'v1',
  version:        3,
} as const;

/** Invalid preferences — unknown channel. */
export const PREFERENCES_INVALID_CHANNEL_BODY = {
  channels:      ['sms'],  // not in ALLOWED_CHANNELS
  digestCadence: 'immediate',
  version:       1,
};

/** Stale-version body for conflict testing. */
export const STALE_VERSION_BODY = {
  action:  'confirm',
  version: 999,
} as const;
