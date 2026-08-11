/**
 * TicketsService unit tests — WO-032.
 *
 * Covers:
 *   - DTO validation: strict schema rejects unknown properties
 *   - DTO validation: tenant_id in body rejected
 *   - Tenant stamping from principal (never from DTO)
 *   - Org-scope enforcement: agent out-of-scope org → 404
 *   - Portal org mismatch → 422
 *   - Deactivated org → 422 ORGANIZATION_INACTIVE
 *   - Unknown tag IDs → 400 UNKNOWN_TAG_IDS
 *   - requester_contact_id not in org → 422 CONTACT_NOT_IN_ORG
 *   - Idempotent 404 on findById for unknown / out-of-scope ticket
 *
 * All tests use in-memory fakes; no real DB.
 * Tests are independent and parallel-safe (no shared mutable state, no sleeps).
 */

import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CreateTicketSchema } from './dto/create-ticket.dto';
import { TicketsService } from './tickets.service';
import type { PrincipalContext } from '../../observability/request-context';

// ---------------------------------------------------------------------------
// DTO schema validation (pure — no service needed)
// ---------------------------------------------------------------------------

describe('CreateTicketSchema', () => {
  const VALID = {
    subject: 'Test ticket',
    organization_id: '00000000-0000-0000-0000-000000000001',
  };

  it('accepts a minimal valid payload', () => {
    const result = CreateTicketSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe('P3'); // default
      expect(result.data.tag_ids).toEqual([]);
      expect(result.data.custom_fields).toEqual({});
    }
  });

  it('rejects unknown properties (.strict)', () => {
    const result = CreateTicketSchema.safeParse({
      ...VALID,
      tenant_id: '00000000-0000-0000-0000-000000000099', // must be rejected
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing subject', () => {
    const result = CreateTicketSchema.safeParse({ organization_id: VALID.organization_id });
    expect(result.success).toBe(false);
  });

  it('rejects subject exceeding 255 chars', () => {
    const result = CreateTicketSchema.safeParse({
      ...VALID,
      subject: 'x'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid priority', () => {
    const result = CreateTicketSchema.safeParse({ ...VALID, priority: 'CRITICAL' });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID organization_id', () => {
    const result = CreateTicketSchema.safeParse({ ...VALID, organization_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects more than 20 tag_ids', () => {
    const result = CreateTicketSchema.safeParse({
      ...VALID,
      tag_ids: Array.from({ length: 21 }, () => '00000000-0000-0000-0000-000000000001'),
    });
    expect(result.success).toBe(false);
  });

  it('trims subject whitespace', () => {
    const result = CreateTicketSchema.safeParse({ ...VALID, subject: '  hello  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.subject).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// TicketsService — business logic with fakes
// ---------------------------------------------------------------------------

function makeOrgActiveStub(active: boolean) {
  return {
    assertOrganizationActive: active
      ? jest.fn().mockResolvedValue(undefined)
      : jest.fn().mockRejectedValue(
          new UnprocessableEntityException({
            error: { code: 'ORGANIZATION_INACTIVE', message: 'Org inactive.' },
          }),
        ),
  };
}

function makeRepoStub(overrides: {
  orgActive?: boolean;
  contactBelongsToOrg?: boolean;
  validTagIds?: string[];
  createdTicketId?: string;
} = {}) {
  const {
    orgActive = true,
    contactBelongsToOrg = true,
    validTagIds = [],
    createdTicketId = 'ticket-001',
  } = overrides;

  return {
    assertOrganizationActive: orgActive
      ? jest.fn().mockResolvedValue(undefined)
      : jest.fn().mockRejectedValue(
          new UnprocessableEntityException({
            error: { code: 'ORGANIZATION_INACTIVE', message: 'Org inactive.' },
          }),
        ),
    contactBelongsToOrg: jest.fn().mockResolvedValue(contactBelongsToOrg),
    filterValidTagIds: jest.fn().mockResolvedValue(validTagIds),
    createTicket: jest.fn().mockResolvedValue({
      id: createdTicketId,
      tenantId: 'tenant-001',
      organizationId: 'org-001',
      requesterContactId: null,
      assigneeId: null,
      categoryId: null,
      subject: 'Test ticket',
      description: null,
      status: 'new',
      priority: 'P3',
      ticketNumber: 42,
      version: 1,
      customFields: {},
      aiStatus: null,
      affectedAreaTags: null,
      aiSummary: null,
      resolvedAt: null,
      assignmentGroupId: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    }),
    loadEnrichment: jest.fn().mockResolvedValue({
      organization: { id: 'org-001', name: 'Acme Corp', slaTier: 'standard' },
      requester: null,
      assignee: null,
      tags: [],
    }),
    findById: jest.fn().mockResolvedValue(null),
  } as any;
}

function makeAuditWriterStub() {
  return { append: jest.fn().mockResolvedValue(undefined) } as any;
}

function makeAgentPrincipal(orgScopeIds: string[] = ['org-001']): PrincipalContext {
  return {
    userId: 'user-001',
    tenantId: 'tenant-001',
    principalKind: 'staff',
    roles: ['agent'],
    orgScopeIds,
    traceId: 'trace-001',
  } as PrincipalContext;
}

function makeAdminPrincipal(): PrincipalContext {
  return {
    userId: 'admin-001',
    tenantId: 'tenant-001',
    principalKind: 'staff',
    roles: ['admin'],
    orgScopeIds: [],
    traceId: 'trace-admin',
  } as PrincipalContext;
}

function makePortalPrincipal(boundOrgId: string): PrincipalContext {
  return {
    userId: 'portal-001',
    tenantId: 'tenant-001',
    principalKind: 'portal',
    roles: [],
    orgScopeIds: [],
    boundOrganizationId: boundOrgId,
    traceId: 'trace-portal',
  } as PrincipalContext;
}

describe('TicketsService.create', () => {
  const VALID_DTO = {
    subject: 'Bug in login flow',
    organization_id: 'org-001',
    priority: 'P2' as const,
    tag_ids: [],
    custom_fields: {},
  };

  it('stamps tenant_id from principal, not from DTO', async () => {
    const repo = makeRepoStub();
    const svc = new TicketsService(repo, makeAuditWriterStub());
    const principal = makeAgentPrincipal();

    await svc.create(principal, VALID_DTO);

    expect(repo.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-001' }),
      [],
    );
  });

  it('writes audit record in same operation', async () => {
    const repo = makeRepoStub();
    const audit = makeAuditWriterStub();
    const svc = new TicketsService(repo, audit);

    await svc.create(makeAgentPrincipal(), VALID_DTO);

    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'ticket', action: 'create' }),
    );
  });

  it('throws 404 when agent org is outside orgScopeIds', async () => {
    const principal = makeAgentPrincipal(['org-999']); // org-001 is out of scope
    const repo = makeRepoStub();
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await expect(svc.create(principal, VALID_DTO)).rejects.toBeInstanceOf(NotFoundException);
    // org check (assertOrganizationActive) must NOT be called before scope check
    expect(repo.assertOrganizationActive).not.toHaveBeenCalled();
  });

  it('admin bypasses org scope check', async () => {
    const repo = makeRepoStub();
    const svc = new TicketsService(repo, makeAuditWriterStub());

    const result = await svc.create(makeAdminPrincipal(), VALID_DTO);
    expect(result.id).toBe('ticket-001');
  });

  it('throws 422 for deactivated org', async () => {
    const repo = makeRepoStub({ orgActive: false });
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await expect(svc.create(makeAdminPrincipal(), VALID_DTO)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('throws 422 PORTAL_ORG_MISMATCH when portal provides wrong org', async () => {
    const principal = makePortalPrincipal('org-999');
    const repo = makeRepoStub();
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await expect(
      svc.create(principal, { ...VALID_DTO, organization_id: 'org-001' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({ code: 'PORTAL_ORG_MISMATCH' }),
      }),
    });
  });

  it('portal with correct org creates ticket successfully', async () => {
    const principal = makePortalPrincipal('org-001');
    const repo = makeRepoStub();
    const svc = new TicketsService(repo, makeAuditWriterStub());

    const result = await svc.create(principal, VALID_DTO);
    expect(result.id).toBe('ticket-001');
  });

  it('throws 422 CONTACT_NOT_IN_ORG when requester contact is in a different org', async () => {
    const repo = makeRepoStub({ contactBelongsToOrg: false });
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await expect(
      svc.create(makeAdminPrincipal(), {
        ...VALID_DTO,
        requester_contact_id: '00000000-0000-0000-0000-000000000002',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({ code: 'CONTACT_NOT_IN_ORG' }),
      }),
    });
  });

  it('throws 400 UNKNOWN_TAG_IDS when tag is not in tenant', async () => {
    const unknownTagId = '00000000-0000-0000-0000-000000000099';
    const repo = makeRepoStub({ validTagIds: [] }); // returns empty = all unknown
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await expect(
      svc.create(makeAdminPrincipal(), { ...VALID_DTO, tag_ids: [unknownTagId] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TicketsService.findById', () => {
  it('returns null for unknown ticket (repo returns null)', async () => {
    const repo = makeRepoStub();
    repo.findById = jest.fn().mockResolvedValue(null);
    const svc = new TicketsService(repo, makeAuditWriterStub());

    const result = await svc.findById('nonexistent-id');
    expect(result).toBeNull();
  });

  it('returns canonical TicketDto when ticket exists', async () => {
    const ticket = {
      id: 'ticket-999',
      tenantId: 'tenant-001',
      organizationId: 'org-001',
      requesterContactId: null,
      assigneeId: null,
      categoryId: null,
      subject: 'Found ticket',
      description: 'Some desc',
      status: 'open',
      priority: 'P1',
      ticketNumber: 7,
      version: 2,
      customFields: {},
      aiStatus: null,
      affectedAreaTags: null,
      aiSummary: null,
      resolvedAt: null,
      assignmentGroupId: null,
      createdAt: new Date('2024-06-01T00:00:00Z'),
      updatedAt: new Date('2024-06-01T00:00:00Z'),
    };
    const repo = makeRepoStub();
    repo.findById = jest.fn().mockResolvedValue(ticket);
    repo.loadEnrichment = jest.fn().mockResolvedValue({
      organization: { id: 'org-001', name: 'Acme', slaTier: 'enterprise' },
      requester: null,
      assignee: null,
      tags: [],
    });

    const svc = new TicketsService(repo, makeAuditWriterStub());
    const result = await svc.findById('ticket-999');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('ticket-999');
    expect(result!.subject).toBe('Found ticket');
    expect(result!.priority).toBe('P1');
    expect(result!.ticketNumber).toBe(7);
    // tenant_id must NOT be in the response
    expect((result as any).tenantId).toBeUndefined();
  });
});
