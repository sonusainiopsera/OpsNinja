/**
 * Dashboard frame payload fixtures for Realtime Gateway tests.
 *
 * Used by both unit tests (org-scope filter) and integration tests
 * (publish to Redis, assert delivery).
 */

import type { RedisPublishPayload, DeltaPayload } from '../../src/gateway/frame.types';
import { TENANT_A_ID, ORG_1_ID, ORG_2_ID } from './jwt.fixtures';

// ---------------------------------------------------------------------------
// Canned delta payload with two orgs
// ---------------------------------------------------------------------------

export const CANNED_DELTA_PAYLOAD: DeltaPayload = {
  globalCounters: {
    activeP1: 3,
    activeP2: 12,
    openTotal: 47,
    approachingBreach: 5,
  },
  orgBreakdown: [
    {
      organizationId: ORG_1_ID,
      counters: { activeP1: 2, activeP2: 5, open: 15 },
    },
    {
      organizationId: ORG_2_ID,
      counters: { activeP1: 1, activeP2: 7, open: 32 },
    },
  ],
};

// ---------------------------------------------------------------------------
// Canned Redis publish payload for tenant A
// ---------------------------------------------------------------------------

export const CANNED_REDIS_PUBLISH: RedisPublishPayload = {
  tenantId: TENANT_A_ID,
  seq: 42,
  sentAt: '2026-08-11T12:00:00.000Z',
  globalCounters: CANNED_DELTA_PAYLOAD.globalCounters,
  orgBreakdown: CANNED_DELTA_PAYLOAD.orgBreakdown,
};

// ---------------------------------------------------------------------------
// Single-org delta payload (only ORG_1_ID)
// ---------------------------------------------------------------------------

export const CANNED_DELTA_ORG1_ONLY: DeltaPayload = {
  globalCounters: CANNED_DELTA_PAYLOAD.globalCounters,
  orgBreakdown: [
    {
      organizationId: ORG_1_ID,
      counters: { activeP1: 2, activeP2: 5, open: 15 },
    },
  ],
};

// ---------------------------------------------------------------------------
// Delta payload with no org breakdown
// ---------------------------------------------------------------------------

export const CANNED_DELTA_TENANT_ONLY: DeltaPayload = {
  globalCounters: CANNED_DELTA_PAYLOAD.globalCounters,
  orgBreakdown: [],
};
