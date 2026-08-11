/**
 * tickets-lifecycle.service.spec.ts — unit tests for TicketsService update/resolve.
 *
 * Covers:
 *   - UpdateTicketSchema / ResolveTicketSchema validation (strict mode, required fields)
 *   - TicketsService.update: no-op returns early, field changes, status changes
 *   - TicketsService.update: illegal transition → 422, version conflict → 409
 *   - TicketsService.resolve: success path, idempotent on already-resolved, 422 from closed
 *   - TicketsService.resolve: version conflict → 409
 *   - Audit and outbox are called exactly once per committed mutation
 *
 * All tests use in-memory fakes; no real DB, no NestJS container, no sleeps.
 * Tests are independent and parallel-safe (no shared mutable state).
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { UpdateTicketSchema } from './dto/update-ticket.dto';
import { ResolveTicketSchema } from './dto/resolve-ticket.dto';
import { TicketsService } from './tickets.service';
import type { PrincipalContext } from '../../observability/request-context';

// ---------------------------------------------------------------------------
// DTO validation (pure — no service needed)
// ---------------------------------------------------------------------------

describe('UpdateTicketSchema', () => {
  it('accepts a valid minimal payload (version only with one field)', () => {
    const result = UpdateTicketSchema.safeParse({ version: 1, subject: 'New subject' });
    expect(result.success).toBe(true);
  });

  it('requires version', () => {
    const result = UpdateTicketSchema.safeParse({ subject: 'New subject' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown properties (.strict)', () => {
    const result = UpdateTicketSchema.safeParse({ version: 1, tenant_id: 'x' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status value', () => {
    const result = UpdateTicketSchema.safeParse({ version: 1, status: 'invalid_status' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid priority value', () => {
    const result = UpdateTicketSchema.safeParse({ version: 1, priority: 'CRITICAL' });
    expect(result.success).toBe(false);
  });

  it('accepts null assignee_user_id (unassign)', () => {
    const result = UpdateTicketSchema.safeParse({ version: 1, assignee_user_id: null });
    expect(result.success).toBe(true);
  });

  it('rejects more than 20 tag_ids', () => {
    const result = UpdateTicketSchema.safeParse({
      version: 1,
      tag_ids: Array.from({ length: 21 }, () => '00000000-0000-0000-0000-000000000001'),
    });
    expect(result.success).toBe(false);
  });
});

describe('ResolveTicketSchema', () => {
  it('accepts a valid payload', () => {
    const result = ResolveTicketSchema.safeParse({ version: 1, resolution_note: 'Fixed it.' });
    expect(result.success).toBe(true);
  });

  it('requires version', () => {
    const result = ResolveTicketSchema.safeParse({ resolution_note: 'Fixed it.' });
    expect(result.success).toBe(false);
  });

  it('requires resolution_note', () => {
    const result = ResolveTicketSchema.safeParse({ version: 1 });
    expect(result.success).toBe(false);
  });

  it('rejects empty resolution_note', () => {
    const result = ResolveTicketSchema.safeParse({ version: 1, resolution_note: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown properties (.strict)', () => {
    const result = ResolveTicketSchema.safeParse({ version: 1, resolution_note: 'ok', foo: 'bar' });
    expect(result.success).toBe(false);
  });

  it('accepts optional category_id', () => {
    const result = ResolveTicketSchema.safeParse({
      version: 1,
      resolution_note: 'Fixed',
      category_id: '00000000-0000-0000-0000-000000000001',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeTicket(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ticket-001',
    tenantId: 'tenant-001',
    organizationId: 'org-001',
    requesterContactId: null,
    assigneeId: null,
    assignmentGroupId: null,
    categoryId: null,
    subject: 'Existing subject',
    description: null,
    status: 'open',
    priority: 'P3',
    ticketNumber: 1,
    version: 2,
    customFields: {},
    aiStatus: null,
    affectedAreaTags: null,
    aiSummary: null,
    resolvedAt: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  } as any;
}

function makeRepoStub(overrides: Record<string, unknown> = {}) {
  return {
    findById: jest.fn().mockResolvedValue(makeTicket()),
    updateTicket: jest.fn().mockResolvedValue(makeTicket({ version: 3 })),
    getCurrentVersion: jest.fn().mockResolvedValue(5),
    appendStatusHistory: jest.fn().mockResolvedValue(undefined),
    emitEvent: jest.fn().mockResolvedValue(undefined),
    filterValidTagIds: jest.fn().mockResolvedValue([]),
    loadEnrichment: jest.fn().mockResolvedValue({
      organization: { id: 'org-001', name: 'Acme Corp', slaTier: 'standard' },
      requester: null,
      assignee: null,
      tags: [],
    }),
    assertOrganizationActive: jest.fn().mockResolvedValue(undefined),
    contactBelongsToOrg: jest.fn().mockResolvedValue(true),
    createTicket: jest.fn(),
    ...overrides,
  } as any;
}

function makeAuditWriterStub() {
  return { append: jest.fn().mockResolvedValue(undefined) } as any;
}

function makeAgentPrincipal(permissions: string[] = ['ticket:update', 'ticket:read']): PrincipalContext {
  return {
    userId: 'user-001',
    tenantId: 'tenant-001',
    principalKind: 'staff',
    roles: ['agent'],
    orgScopeIds: ['org-001'],
    permissions,
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
    permissions: ['ticket:update', 'ticket:close', 'ticket:read', 'ticket:create'],
    traceId: 'trace-admin',
  } as PrincipalContext;
}

// ---------------------------------------------------------------------------
// TicketsService.update
// ---------------------------------------------------------------------------

describe('TicketsService.update', () => {
  const VALID_UPDATE_DTO = { version: 2, subject: 'Updated subject' };

  it('calls updateTicket with the correct tenantId and ticketId', async () => {
    const repo = makeRepoStub();
    const svc = new TicketsService(repo, makeAuditWriterStub());
    await svc.update(makeAgentPrincipal(), 'ticket-001', VALID_UPDATE_DTO);

    expect(repo.updateTicket).toHaveBeenCalledWith(
      'tenant-001',
      'ticket-001',
      2,
      expect.objectContaining({ subject: 'Updated subject' }),
      undefined,
    );
  });

  it('throws 404 when ticket not found', async () => {
    const repo = makeRepoStub({ findById: jest.fn().mockResolvedValue(null) });
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await expect(svc.update(makeAgentPrincipal(), 'unknown-id', VALID_UPDATE_DTO))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns current DTO without writes when nothing changed', async () => {
    // Same subject as existing ticket
    const repo = makeRepoStub();
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await svc.update(makeAgentPrincipal(), 'ticket-001', { version: 2, subject: 'Existing subject' });

    expect(repo.updateTicket).not.toHaveBeenCalled();
    expect(repo.emitEvent).not.toHaveBeenCalled();
  });

  it('throws 409 VERSION_CONFLICT when updateTicket returns VERSION_CONFLICT', async () => {
    const repo = makeRepoStub({
      updateTicket: jest.fn().mockResolvedValue('VERSION_CONFLICT'),
    });
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await expect(svc.update(makeAgentPrincipal(), 'ticket-001', VALID_UPDATE_DTO))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('includes current_version in the 409 error body', async () => {
    const repo = makeRepoStub({
      updateTicket: jest.fn().mockResolvedValue('VERSION_CONFLICT'),
      getCurrentVersion: jest.fn().mockResolvedValue(7),
    });
    const svc = new TicketsService(repo, makeAuditWriterStub());

    const err = await svc.update(makeAgentPrincipal(), 'ticket-001', VALID_UPDATE_DTO).catch(e => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.response.error.details[0].currentVersion).toBe(7);
  });

  it('throws 422 INVALID_TRANSITION for illegal status change', async () => {
    const repo = makeRepoStub({ findById: jest.fn().mockResolvedValue(makeTicket({ status: 'closed' })) });
    const svc = new TicketsService(repo, makeAuditWriterStub());

    // closed → new is not in the transition table
    await expect(
      svc.update(makeAdminPrincipal(), 'ticket-001', { version: 2, status: 'new' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws 403 TRANSITION_PERMISSION_DENIED when agent lacks ticket:close', async () => {
    const repo = makeRepoStub({ findById: jest.fn().mockResolvedValue(makeTicket({ status: 'open' })) });
    const svc = new TicketsService(repo, makeAuditWriterStub());

    // open → closed requires ticket:close; agent only has ticket:update
    await expect(
      svc.update(makeAgentPrincipal(['ticket:update']), 'ticket-001', { version: 2, status: 'closed' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('emits ticket.updated and ticket.status_changed events on status change', async () => {
    const repo = makeRepoStub({
      findById: jest.fn().mockResolvedValue(makeTicket({ status: 'new' })),
    });
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await svc.update(makeAgentPrincipal(), 'ticket-001', { version: 2, status: 'open' });

    const eventTypes = repo.emitEvent.mock.calls.map((c: any[]) => c[2]);
    expect(eventTypes).toContain('ticket.updated');
    expect(eventTypes).toContain('ticket.status_changed');
  });

  it('emits ticket.priority_changed when priority changes', async () => {
    const repo = makeRepoStub();
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await svc.update(makeAgentPrincipal(), 'ticket-001', { version: 2, priority: 'P1' });

    const eventTypes = repo.emitEvent.mock.calls.map((c: any[]) => c[2]);
    expect(eventTypes).toContain('ticket.priority_changed');
  });

  it('appends status history when status changes', async () => {
    const repo = makeRepoStub({
      findById: jest.fn().mockResolvedValue(makeTicket({ status: 'new' })),
    });
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await svc.update(makeAgentPrincipal(), 'ticket-001', {
      version: 2,
      status: 'open',
      transition_reason: 'Customer called in',
    });

    expect(repo.appendStatusHistory).toHaveBeenCalledWith(
      'tenant-001',
      'ticket-001',
      'new',
      'open',
      'user-001',
      'Customer called in',
    );
  });

  it('does not append status history when status does not change', async () => {
    const repo = makeRepoStub();
    const svc = new TicketsService(repo, makeAuditWriterStub());

    // Only changing subject, not status
    await svc.update(makeAgentPrincipal(), 'ticket-001', { version: 2, subject: 'Changed subject' });

    expect(repo.appendStatusHistory).not.toHaveBeenCalled();
  });

  it('writes audit record on successful update', async () => {
    const repo = makeRepoStub();
    const audit = makeAuditWriterStub();
    const svc = new TicketsService(repo, audit);

    await svc.update(makeAgentPrincipal(), 'ticket-001', VALID_UPDATE_DTO);

    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'ticket', action: 'update' }),
    );
  });
});

// ---------------------------------------------------------------------------
// TicketsService.resolve
// ---------------------------------------------------------------------------

describe('TicketsService.resolve', () => {
  const VALID_RESOLVE_DTO = { version: 2, resolution_note: 'Issue confirmed fixed.' };

  it('resolves an open ticket successfully', async () => {
    const resolvedTicket = makeTicket({ status: 'resolved', version: 3, resolvedAt: new Date(), aiStatus: 'pending' });
    const repo = makeRepoStub({
      findById: jest.fn().mockResolvedValue(makeTicket({ status: 'open' })),
      updateTicket: jest.fn().mockResolvedValue(resolvedTicket),
    });
    const svc = new TicketsService(repo, makeAuditWriterStub());

    const result = await svc.resolve(makeAgentPrincipal(), 'ticket-001', VALID_RESOLVE_DTO);

    expect(result.status).toBe('resolved');
    expect(repo.updateTicket).toHaveBeenCalledWith(
      'tenant-001',
      'ticket-001',
      2,
      expect.objectContaining({ status: 'resolved', aiStatus: 'pending' }),
    );
  });

  it('is idempotent — already-resolved ticket returns 200 without writes', async () => {
    const repo = makeRepoStub({
      findById: jest.fn().mockResolvedValue(makeTicket({ status: 'resolved' })),
    });
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await svc.resolve(makeAgentPrincipal(), 'ticket-001', VALID_RESOLVE_DTO);

    expect(repo.updateTicket).not.toHaveBeenCalled();
    expect(repo.emitEvent).not.toHaveBeenCalled();
    expect(repo.appendStatusHistory).not.toHaveBeenCalled();
  });

  it('throws 422 when ticket is already closed (cannot resolve from closed)', async () => {
    const repo = makeRepoStub({
      findById: jest.fn().mockResolvedValue(makeTicket({ status: 'closed' })),
    });
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await expect(svc.resolve(makeAdminPrincipal(), 'ticket-001', VALID_RESOLVE_DTO))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws 404 when ticket not found', async () => {
    const repo = makeRepoStub({ findById: jest.fn().mockResolvedValue(null) });
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await expect(svc.resolve(makeAgentPrincipal(), 'unknown-id', VALID_RESOLVE_DTO))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws 409 VERSION_CONFLICT on stale version', async () => {
    const repo = makeRepoStub({
      findById: jest.fn().mockResolvedValue(makeTicket({ status: 'open' })),
      updateTicket: jest.fn().mockResolvedValue('VERSION_CONFLICT'),
    });
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await expect(svc.resolve(makeAgentPrincipal(), 'ticket-001', VALID_RESOLVE_DTO))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('emits exactly one ticket.resolved event', async () => {
    const resolvedTicket = makeTicket({ status: 'resolved', version: 3, aiStatus: 'pending' });
    const repo = makeRepoStub({
      findById: jest.fn().mockResolvedValue(makeTicket({ status: 'open' })),
      updateTicket: jest.fn().mockResolvedValue(resolvedTicket),
    });
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await svc.resolve(makeAgentPrincipal(), 'ticket-001', VALID_RESOLVE_DTO);

    const resolvedEvents = repo.emitEvent.mock.calls.filter(
      (c: any[]) => c[2] === 'ticket.resolved',
    );
    expect(resolvedEvents).toHaveLength(1);
  });

  it('outbox payload does not include raw resolution_note (PII protection)', async () => {
    const resolvedTicket = makeTicket({ status: 'resolved', version: 3, aiStatus: 'pending' });
    const repo = makeRepoStub({
      findById: jest.fn().mockResolvedValue(makeTicket({ status: 'open' })),
      updateTicket: jest.fn().mockResolvedValue(resolvedTicket),
    });
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await svc.resolve(makeAgentPrincipal(), 'ticket-001', {
      version: 2,
      resolution_note: 'SENSITIVE_CUSTOMER_DATA',
    });

    const resolvedCall = repo.emitEvent.mock.calls.find((c: any[]) => c[2] === 'ticket.resolved');
    const payload = resolvedCall?.[3] as Record<string, unknown>;
    expect(JSON.stringify(payload)).not.toContain('SENSITIVE_CUSTOMER_DATA');
  });

  it('appends status history with resolution_note as reason', async () => {
    const resolvedTicket = makeTicket({ status: 'resolved', version: 3, aiStatus: 'pending' });
    const repo = makeRepoStub({
      findById: jest.fn().mockResolvedValue(makeTicket({ status: 'open' })),
      updateTicket: jest.fn().mockResolvedValue(resolvedTicket),
    });
    const svc = new TicketsService(repo, makeAuditWriterStub());

    await svc.resolve(makeAgentPrincipal(), 'ticket-001', {
      version: 2,
      resolution_note: 'Fixed in v2.3.1',
    });

    expect(repo.appendStatusHistory).toHaveBeenCalledWith(
      'tenant-001',
      'ticket-001',
      'open',
      'resolved',
      'user-001',
      'Fixed in v2.3.1',
    );
  });

  it('writes audit record on successful resolve', async () => {
    const resolvedTicket = makeTicket({ status: 'resolved', version: 3, aiStatus: 'pending' });
    const repo = makeRepoStub({
      findById: jest.fn().mockResolvedValue(makeTicket({ status: 'open' })),
      updateTicket: jest.fn().mockResolvedValue(resolvedTicket),
    });
    const audit = makeAuditWriterStub();
    const svc = new TicketsService(repo, audit);

    await svc.resolve(makeAgentPrincipal(), 'ticket-001', VALID_RESOLVE_DTO);

    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'ticket', action: 'resolve' }),
    );
  });
});
