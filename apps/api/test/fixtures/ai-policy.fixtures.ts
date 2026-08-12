/**
 * ai-policy.fixtures.ts — deterministic test data for WO-063 (AC11).
 *
 * Three tenant profiles:
 *   1. HEALTHY_TENANT       — AI enabled, budget set, usage well under threshold
 *   2. EXHAUSTED_TENANT     — AI enabled but budget fully consumed
 *   3. DISABLED_TENANT      — AI disabled entirely
 *
 * Also exports canned settings/usage row shapes and principal fixtures.
 */

// ---------------------------------------------------------------------------
// Fixed UUIDs
// ---------------------------------------------------------------------------

export const AI_TENANT_HEALTHY    = 'aaaa0001-0000-4000-8000-000000000010';
export const AI_TENANT_EXHAUSTED  = 'aaaa0002-0000-4000-8000-000000000010';
export const AI_TENANT_DISABLED   = 'aaaa0003-0000-4000-8000-000000000010';
export const AI_TENANT_NO_BUDGET  = 'aaaa0004-0000-4000-8000-000000000010';
export const AI_OPERATOR_ID       = 'ffffffff-0000-4000-8000-000000000010';

// ---------------------------------------------------------------------------
// Tenant AI settings rows
// ---------------------------------------------------------------------------

export const AI_SETTINGS_HEALTHY = {
  tenantId:           AI_TENANT_HEALTHY,
  aiEnabled:          true,
  monthlyTokenBudget: 100_000,
  warnThresholdPct:   80,
  warnedAt:           null as Date | null,
  version:            1,
  updatedAt:          new Date('2024-06-01T00:00:00.000Z'),
};

export const AI_SETTINGS_EXHAUSTED = {
  tenantId:           AI_TENANT_EXHAUSTED,
  aiEnabled:          true,
  monthlyTokenBudget: 100,        // very small budget — exhausted after one request
  warnThresholdPct:   80,
  warnedAt:           new Date('2024-06-15T08:00:00.000Z'),
  version:            2,
  updatedAt:          new Date('2024-06-15T08:00:00.000Z'),
};

export const AI_SETTINGS_DISABLED = {
  tenantId:           AI_TENANT_DISABLED,
  aiEnabled:          false,
  monthlyTokenBudget: null as number | null,
  warnThresholdPct:   80,
  warnedAt:           null as Date | null,
  version:            1,
  updatedAt:          new Date('2024-06-01T00:00:00.000Z'),
};

export const AI_SETTINGS_NO_BUDGET = {
  tenantId:           AI_TENANT_NO_BUDGET,
  aiEnabled:          true,
  monthlyTokenBudget: null as number | null,
  warnThresholdPct:   80,
  warnedAt:           null as Date | null,
  version:            1,
  updatedAt:          new Date('2024-06-01T00:00:00.000Z'),
};

// ---------------------------------------------------------------------------
// Tenant AI usage rows
// ---------------------------------------------------------------------------

/** Usage under warn threshold (50 000 / 100 000 = 50%). */
export const AI_USAGE_HEALTHY = {
  id:                  'u1000001-0000-4000-8000-000000000010',
  tenantId:            AI_TENANT_HEALTHY,
  period:              '2024-06',
  inputTokens:         40_000,
  outputTokens:        10_000,
  requestCount:        42,
  estimatedCostMicros: 165_000,
  createdAt:           new Date('2024-06-01T00:00:00.000Z'),
  updatedAt:           new Date('2024-06-15T12:00:00.000Z'),
};

/** Usage at warn threshold (80 000 / 100 000 = 80%). */
export const AI_USAGE_AT_WARN_THRESHOLD = {
  id:                  'u1000002-0000-4000-8000-000000000010',
  tenantId:            AI_TENANT_HEALTHY,
  period:              '2024-06',
  inputTokens:         64_000,
  outputTokens:        16_000,
  requestCount:        80,
  estimatedCostMicros: 432_000,
  createdAt:           new Date('2024-06-01T00:00:00.000Z'),
  updatedAt:           new Date('2024-06-20T12:00:00.000Z'),
};

/** Usage exactly at budget (100 / 100 = 100%). */
export const AI_USAGE_EXHAUSTED = {
  id:                  'u1000003-0000-4000-8000-000000000010',
  tenantId:            AI_TENANT_EXHAUSTED,
  period:              '2024-06',
  inputTokens:         80,
  outputTokens:        20,
  requestCount:        1,
  estimatedCostMicros: 285,
  createdAt:           new Date('2024-06-01T00:00:00.000Z'),
  updatedAt:           new Date('2024-06-01T00:00:00.000Z'),
};

// ---------------------------------------------------------------------------
// PrincipalContext fixtures for API tests
// ---------------------------------------------------------------------------

export const AI_PRINCIPAL_ADMIN = {
  userId:       AI_OPERATOR_ID,
  tenantId:     AI_TENANT_HEALTHY,
  principalKind: 'staff' as const,
  roles:        ['admin'],
  orgScopeIds:  [] as string[],
  traceId:      'trace-ai-001',
};

export const AI_PRINCIPAL_AGENT = {
  userId:       'agent-00001-0000-4000-8000-000000000010',
  tenantId:     AI_TENANT_HEALTHY,
  principalKind: 'staff' as const,
  roles:        ['agent'],
  orgScopeIds:  [] as string[],
  traceId:      'trace-ai-002',
};

export const AI_PRINCIPAL_ADMIN_EXHAUSTED = {
  userId:       AI_OPERATOR_ID,
  tenantId:     AI_TENANT_EXHAUSTED,
  principalKind: 'staff' as const,
  roles:        ['admin'],
  orgScopeIds:  [] as string[],
  traceId:      'trace-ai-003',
};
