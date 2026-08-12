/**
 * Jira webhook payload fixtures for WO-098 isolation tests.
 *
 * Provides pre-built signed and unsigned payloads for:
 *   - Valid payload referencing a link owned by Tenant A (used as baseline)
 *   - Valid payload referencing a link owned by Tenant B (cross-tenant attempt)
 *   - Invalid HMAC signature
 *   - Missing signature headers
 *   - Stale timestamp (> 5 minutes old)
 *   - Duplicate jira_event_id (replay within 7-day window)
 *   - Valid Tenant A signature but Tenant B issue key (mixed credentials)
 */

import { createHmac } from 'crypto';

// ---------------------------------------------------------------------------
// Test secrets and IDs
// ---------------------------------------------------------------------------

export const TENANT_A_ID             = 'f0000000-0000-0000-0000-000000000001';
export const TENANT_B_ID             = 'f0000000-0000-0000-0000-000000000002';
export const TENANT_A_CONNECTION_ID  = 'f2000010-0000-0000-0000-000000000001';
export const TENANT_B_CONNECTION_ID  = 'f2000010-0000-0000-0000-000000000002';
export const TENANT_A_JIRA_LINK_ID   = 'f2000020-0000-0000-0000-000000000001';
export const TENANT_B_JIRA_LINK_ID   = 'f2000020-0000-0000-0000-000000000002';

/** HMAC secret provisioned for Tenant A's webhook connection. */
export const TENANT_A_SECRET = 'whsec_tenant_a_32bytes_padding000';
/** HMAC secret provisioned for Tenant B's webhook connection. */
export const TENANT_B_SECRET = 'whsec_tenant_b_32bytes_padding000';

export const TENANT_A_SLUG  = 'acme-corp';
export const TENANT_B_SLUG  = 'rival-inc';
export const CLOUD_ID_A     = 'cloud-aaa-111';
export const CLOUD_ID_B     = 'cloud-bbb-222';

// ---------------------------------------------------------------------------
// Signing helper
// ---------------------------------------------------------------------------

/**
 * Sign a webhook payload body using the OpsNinja Jira receiver HMAC scheme:
 *   signed = `${timestamp}.${rawBody}`
 *   signature = sha256=<hex(HMAC-SHA256(key, signed))>
 */
export function signPayload(
  body: string | Buffer,
  secret: string,
  timestampOverride?: number,
): { 'X-Hub-Signature': string; 'X-OpsNinja-Timestamp': string } {
  const ts    = timestampOverride ?? Math.floor(Date.now() / 1000);
  const raw   = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  const signed = Buffer.concat([Buffer.from(`${ts}.`), raw]);
  const hmac  = createHmac('sha256', secret).update(signed).digest('hex');
  return {
    'X-Hub-Signature':      `sha256=${hmac}`,
    'X-OpsNinja-Timestamp': String(ts),
  };
}

/** Returns a timestamp that is 6 minutes in the past (exceeds 5-min tolerance). */
export function staleTimestamp(): number {
  return Math.floor(Date.now() / 1000) - 360;
}

// ---------------------------------------------------------------------------
// Payload factory
// ---------------------------------------------------------------------------

export function makeIssueUpdatedPayload(opts: {
  eventId:    number;
  cloudId:    string;
  issueKey:   string;
  tenantSlug: string;
}): string {
  return JSON.stringify({
    id:               opts.eventId,
    timestamp:        Date.now(),
    webhookEvent:     'jira:issue_updated',
    cloudId:          opts.cloudId,
    tenantSlug:       opts.tenantSlug,
    issue_event_type_name: 'issue_generic',
    issue: {
      id:  '10001',
      key: opts.issueKey,
      fields: {
        summary: 'Test issue',
        status:  { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        priority: { name: 'Medium' },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Fixture catalogue
// ---------------------------------------------------------------------------

/** 1. Valid signed payload for Tenant A's connection — happy path baseline. */
export const FIXTURE_VALID_TENANT_A = (() => {
  const body = makeIssueUpdatedPayload({
    eventId:    200001,
    cloudId:    CLOUD_ID_A,
    issueKey:   'ACME-100',
    tenantSlug: TENANT_A_SLUG,
  });
  return { body, headers: signPayload(body, TENANT_A_SECRET) };
})();

/** 2. Valid signed payload for Tenant B's connection. */
export const FIXTURE_VALID_TENANT_B = (() => {
  const body = makeIssueUpdatedPayload({
    eventId:    200002,
    cloudId:    CLOUD_ID_B,
    issueKey:   'RIVAL-200',
    tenantSlug: TENANT_B_SLUG,
  });
  return { body, headers: signPayload(body, TENANT_B_SECRET) };
})();

/**
 * 3. Tenant A signature but Tenant B issue key.
 *    A valid HMAC from Tenant A's secret but the payload references
 *    Tenant B's cloudId — ownership check must reject this.
 */
export const FIXTURE_CROSS_TENANT_KEY = (() => {
  const body = makeIssueUpdatedPayload({
    eventId:    200003,
    cloudId:    CLOUD_ID_B,          // Tenant B's cloud
    issueKey:   'RIVAL-999',          // Tenant B's project key
    tenantSlug: TENANT_A_SLUG,        // but routed to Tenant A
  });
  return { body, headers: signPayload(body, TENANT_A_SECRET) };
})();

/** 4. Invalid HMAC signature (garbled). */
export const FIXTURE_BAD_SIGNATURE = (() => {
  const body = makeIssueUpdatedPayload({
    eventId:    200004,
    cloudId:    CLOUD_ID_A,
    issueKey:   'ACME-101',
    tenantSlug: TENANT_A_SLUG,
  });
  const headers = signPayload(body, TENANT_A_SECRET);
  return {
    body,
    headers: {
      ...headers,
      'X-Hub-Signature': 'sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
  };
})();

/** 5. Missing signature headers entirely. */
export const FIXTURE_MISSING_SIGNATURE = (() => {
  const body = makeIssueUpdatedPayload({
    eventId:    200005,
    cloudId:    CLOUD_ID_A,
    issueKey:   'ACME-102',
    tenantSlug: TENANT_A_SLUG,
  });
  return { body, headers: {} as Record<string, string> };
})();

/** 6. Stale timestamp (6 minutes ago, exceeds 5-minute tolerance). */
export const FIXTURE_STALE_TIMESTAMP = (() => {
  const body = makeIssueUpdatedPayload({
    eventId:    200006,
    cloudId:    CLOUD_ID_A,
    issueKey:   'ACME-103',
    tenantSlug: TENANT_A_SLUG,
  });
  return { body, headers: signPayload(body, TENANT_A_SECRET, staleTimestamp()) };
})();

/**
 * 7. Duplicate of FIXTURE_VALID_TENANT_A — same eventId, used to test
 *    idempotency: second delivery must not re-enqueue or mutate state.
 */
export const FIXTURE_DUPLICATE_EVENT_ID = (() => {
  const body = makeIssueUpdatedPayload({
    eventId:    200001,  // same id as FIXTURE_VALID_TENANT_A
    cloudId:    CLOUD_ID_A,
    issueKey:   'ACME-100',
    tenantSlug: TENANT_A_SLUG,
  });
  return { body, headers: signPayload(body, TENANT_A_SECRET) };
})();

/** 8. Valid Tenant A signature but referencing unknown link ID (foreign tenant resource). */
export const FIXTURE_FOREIGN_LINK_ID = (() => {
  const payload = {
    id:           200007,
    timestamp:    Date.now(),
    webhookEvent: 'jira:issue_updated',
    cloudId:      CLOUD_ID_A,
    tenantSlug:   TENANT_A_SLUG,
    opsninja_link_id: TENANT_B_JIRA_LINK_ID,  // belongs to Tenant B
    issue: {
      id:  '10009',
      key: 'ACME-999',
      fields: { summary: 'Foreign link test', status: { name: 'Open', statusCategory: { key: 'new' } } },
    },
  };
  const body = JSON.stringify(payload);
  return { body, headers: signPayload(body, TENANT_A_SECRET) };
})();

// ---------------------------------------------------------------------------
// Expired variants (for boundary testing)
// ---------------------------------------------------------------------------

/** Timestamp exactly at the tolerance boundary (299 seconds ago — should pass). */
export const FIXTURE_NEAR_EXPIRY_VALID = (() => {
  const body = makeIssueUpdatedPayload({
    eventId:    200008,
    cloudId:    CLOUD_ID_A,
    issueKey:   'ACME-104',
    tenantSlug: TENANT_A_SLUG,
  });
  const ts = Math.floor(Date.now() / 1000) - 299;
  return { body, headers: signPayload(body, TENANT_A_SECRET, ts) };
})();

/** Timestamp exactly one second past the tolerance boundary (301 seconds ago — must fail). */
export const FIXTURE_JUST_EXPIRED = (() => {
  const body = makeIssueUpdatedPayload({
    eventId:    200009,
    cloudId:    CLOUD_ID_A,
    issueKey:   'ACME-105',
    tenantSlug: TENANT_A_SLUG,
  });
  const ts = Math.floor(Date.now() / 1000) - 301;
  return { body, headers: signPayload(body, TENANT_A_SECRET, ts) };
})();
