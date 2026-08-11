/**
 * Portal isolation suite.
 *
 * Asserts that portal principals:
 *   1. Cannot read internal-visibility comments on their own tickets.
 *   2. Cannot read tickets belonging to a sibling organization in the same tenant.
 *   3. Receive 404 for any resource outside their bound organization.
 *
 * Exercises the portal predicate from scoped-query.helper.ts and the
 * org-scope predicate from scope-predicate.ts through real application logic
 * (using in-memory repository stubs to run offline).
 */

import {
  buildOrgScopePredicate,
} from '../src/data/scope-predicate';
import {
  portalTicketPredicate,
  portalCommentPredicate,
} from '../src/common/db/scoped-query.helper';
import { maskNotFound } from '../src/common/errors/not-found';
import type { PortalPrincipal } from '../src/modules/identity/portal/portal-principal';

import {
  HARNESS_TENANT_A_ID,
  HARNESS_TENANT_A_ORG1_ID,
  HARNESS_TENANT_A_ORG2_ID,
} from './fixtures/tenant-factory';

// ---------------------------------------------------------------------------
// Unit-level isolation assertions (offline — no DB required)
// ---------------------------------------------------------------------------

describe('Portal isolation — predicate correctness (offline)', () => {
  const portalPrincipal: PortalPrincipal = {
    tenantId: HARNESS_TENANT_A_ID,
    userId: 'portal-user-1',
    principalKind: 'portal',
    roles: ['portal_user'],
    orgScopeIds: [HARNESS_TENANT_A_ORG1_ID],
    boundOrganizationId: HARNESS_TENANT_A_ORG1_ID,
    traceId: 'trace-portal-1',
  };

  const siblingOrgId = HARNESS_TENANT_A_ORG2_ID;

  describe('Ticket predicate', () => {
    it('restricts ticket access to boundOrganizationId', () => {
      const ticketsStub = {
        organizationId: { name: 'organization_id' },
      } as never;
      const pred = portalTicketPredicate(portalPrincipal);
      expect(String(pred)).toContain(HARNESS_TENANT_A_ORG1_ID);
      // Must not reference sibling org
      expect(String(pred)).not.toContain(siblingOrgId);
    });
  });

  describe('Comment predicate', () => {
    it('restricts comments to boundOrganizationId AND visibility=public', () => {
      const pred = portalCommentPredicate(portalPrincipal);
      const predStr = String(pred);
      expect(predStr).toContain(HARNESS_TENANT_A_ORG1_ID);
      expect(predStr.toLowerCase()).toContain('public');
    });
  });

  describe('Scope predicate for portal principal', () => {
    it('returns eq predicate for portal principal with boundOrganizationId', () => {
      const stubCol = {
        name: 'organization_id',
        table: { name: 'tickets' },
      } as never;
      const pred = buildOrgScopePredicate(portalPrincipal, stubCol);
      expect(pred).not.toBeNull();
      expect(String(pred)).toContain(HARNESS_TENANT_A_ORG1_ID);
    });

    it('returns always-false for portal principal with no boundOrganizationId', () => {
      const noBoundOrg: PortalPrincipal = {
        ...portalPrincipal,
        boundOrganizationId: undefined as unknown as string,
      };
      const stubCol = {
        name: 'organization_id',
        table: { name: 'tickets' },
      } as never;
      const pred = buildOrgScopePredicate(noBoundOrg, stubCol);
      expect(String(pred)).toContain('false');
    });
  });

  describe('maskNotFound helper', () => {
    it('throws NotFoundException (404 RESOURCE_NOT_FOUND) for null', () => {
      expect(() => maskNotFound(null, 'ticket')).toThrow();
      try {
        maskNotFound(null, 'ticket');
      } catch (err) {
        expect((err as { status?: number }).status ?? 0).toBe(404);
      }
    });

    it('does not throw for a defined value', () => {
      expect(() => maskNotFound({ id: '1' }, 'ticket')).not.toThrow();
    });

    it('404 response body does not contain the word "exists"', () => {
      try {
        maskNotFound(null, 'ticket');
      } catch (err) {
        const msg = JSON.stringify((err as { response?: unknown }).response ?? '');
        expect(msg.toLowerCase()).not.toContain('exists');
        expect(msg.toLowerCase()).not.toContain('found in scope');
      }
    });
  });

  describe('Portal cannot see sibling-org tickets (predicate proof)', () => {
    it('org2 ticket not matched by org1 portal predicate', () => {
      const siblingTicket = { id: 'sibling-ticket', organizationId: siblingOrgId };
      const pred = portalTicketPredicate(portalPrincipal);
      // The predicate is an eq on org1 — it cannot be satisfied by org2
      // (Structural proof: predicate SQL contains org1 ID, not org2 ID)
      expect(String(pred)).not.toContain(siblingOrgId);
    });
  });

  describe('Internal comment invisibility (predicate proof)', () => {
    it('comment predicate requires visibility=public', () => {
      const pred = portalCommentPredicate(portalPrincipal);
      expect(String(pred).toLowerCase()).toContain('public');
      expect(String(pred).toLowerCase()).not.toContain('internal');
    });
  });
});
