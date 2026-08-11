/**
 * Sample dashboard frame payloads for unit and integration tests.
 */

import { TENANT_A, TENANT_B, ORG_ID_1, ORG_ID_2, ORG_ID_3 } from './jwt-fixtures';

/** Full delta frame with three org breakdown entries. */
export const FULL_DELTA_FRAME = {
  type: 'delta',
  tenantId: TENANT_A,
  seq: 42,
  sentAt: '2026-08-11T12:00:00.000Z',
  payload: {
    openTickets: 150,
    orgBreakdown: [
      { organization_id: ORG_ID_1, openTickets: 60, breachingTickets: 2 },
      { organization_id: ORG_ID_2, openTickets: 50, breachingTickets: 1 },
      { organization_id: ORG_ID_3, openTickets: 40, breachingTickets: 0 },
    ],
  },
};

/** Delta frame for tenant B with one org. */
export const TENANT_B_DELTA_FRAME = {
  type: 'delta',
  tenantId: TENANT_B,
  seq: 7,
  sentAt: '2026-08-11T12:00:05.000Z',
  payload: {
    openTickets: 20,
    orgBreakdown: [
      { organization_id: ORG_ID_3, openTickets: 20, breachingTickets: 0 },
    ],
  },
};

/** Snapshot-required frame (no breakdown). */
export const SNAPSHOT_REQUIRED_FRAME = {
  type: 'snapshot_required',
  tenantId: TENANT_A,
  seq: 43,
  sentAt: '2026-08-11T12:00:10.000Z',
  payload: { reason: 'seq_gap' },
};

/** Going-away frame. */
export const GOING_AWAY_FRAME = {
  type: 'going_away',
  tenantId: null,
  seq: 0,
  sentAt: '2026-08-11T12:01:00.000Z',
  payload: { message: 'Server is restarting. Please reconnect.' },
};

/** Error frame. */
export const ERROR_FRAME = {
  type: 'error',
  tenantId: TENANT_A,
  seq: 0,
  sentAt: '2026-08-11T12:00:00.000Z',
  payload: { code: 'SCHEMA_VIOLATION', message: 'Malformed subscribe request.' },
};
