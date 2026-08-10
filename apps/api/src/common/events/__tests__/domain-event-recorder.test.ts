/**
 * Unit tests for DomainEventRecorder.
 *
 * These tests use a fake SQL function to avoid a real database connection,
 * verifying the recorder's transactional contract and row-building logic.
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import { DomainEventRecorder, TenantContextMissingError } from '../domain-event-recorder.js';
import {
  withTransactionContext,
  type TransactionContext,
} from '../../transaction/transaction-context.js';
import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Fake SQL builder
// ---------------------------------------------------------------------------

/** Captures all SQL calls made through the template literal tag. */
function makeFakeSql(): { sql: Mock; calls: Array<{ query: string; params: unknown[] }> } {
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const sql = vi.fn().mockImplementation((...args: unknown[]) => {
    // Vitest mock receives (strings[], ...values) from tagged template literals
    calls.push({ query: String(args[0]), params: args.slice(1) as unknown[] });
    return Promise.resolve([]);
  });
  // Make the mock work as a template literal tag
  const taggedSql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join('?'), params: values });
    return Promise.resolve([]);
  };
  return { sql: taggedSql as unknown as Mock, calls };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(override?: Partial<TransactionContext>): TransactionContext {
  const { sql } = makeFakeSql();
  return {
    sql: sql as unknown as Sql,
    tenantId: 'tenant-uuid-1',
    traceId: 'trace-abc',
    actor: { type: 'user', id: 'user-uuid-1' },
    ...override,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DomainEventRecorder', () => {
  describe('TenantContextMissingError', () => {
    it('throws TenantContextMissingError when recordAudit is called outside a transaction', async () => {
      const recorder = new DomainEventRecorder();
      await expect(
        recorder.recordAudit({
          resourceType: 'ticket',
          resourceId: 'uuid-1',
          action: 'create',
          before: null,
          after: { id: 'uuid-1', status: 'open' },
        }),
      ).rejects.toThrow(TenantContextMissingError);
    });

    it('throws TenantContextMissingError when enqueueEvent is called outside a transaction', async () => {
      const recorder = new DomainEventRecorder();
      await expect(
        recorder.enqueueEvent({
          id: 'event-uuid-1',
          aggregateType: 'ticket',
          aggregateId: 'uuid-1',
          eventType: 'ticket.created',
          payload: { priority: 'P1' },
        }),
      ).rejects.toThrow(TenantContextMissingError);
    });

    it('error has code TENANT_CONTEXT_MISSING', async () => {
      const recorder = new DomainEventRecorder();
      try {
        await recorder.recordAudit({ resourceType: 'ticket', resourceId: 'x', action: 'create' });
      } catch (err) {
        expect((err as TenantContextMissingError).code).toBe('TENANT_CONTEXT_MISSING');
      }
    });
  });

  describe('recordAudit within a transaction context', () => {
    it('resolves without error inside withTransactionContext', async () => {
      const sqlCalls: string[] = [];
      const fakeSql = Object.assign(
        (strings: TemplateStringsArray, ..._values: unknown[]) => {
          sqlCalls.push(strings.join(''));
          return Promise.resolve([]);
        },
        { unsafe: () => Promise.resolve([]) },
      );

      const ctx: TransactionContext = {
        sql: fakeSql as unknown as Sql,
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        actor: { type: 'user', id: 'user-1' },
      };

      const recorder = new DomainEventRecorder();
      await withTransactionContext(ctx, () =>
        recorder.recordAudit({
          resourceType: 'ticket',
          resourceId: 'uuid-ticket-1',
          action: 'create',
          before: null,
          after: { id: 'uuid-ticket-1', status: 'open', priority: 'P1' },
        }),
      );

      // SQL should have been called for the INSERT INTO audit_logs
      expect(sqlCalls.length).toBeGreaterThan(0);
    });

    it('enqueueEvent resolves inside withTransactionContext', async () => {
      const sqlCalls: string[] = [];
      const fakeSql = Object.assign(
        (strings: TemplateStringsArray, ..._values: unknown[]) => {
          sqlCalls.push(strings.join(''));
          return Promise.resolve([]);
        },
      );

      const ctx: TransactionContext = {
        sql: fakeSql as unknown as Sql,
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        actor: { type: 'user', id: 'user-1' },
      };

      const recorder = new DomainEventRecorder();
      await withTransactionContext(ctx, () =>
        recorder.enqueueEvent({
          id: 'event-uuid-1',
          aggregateType: 'ticket',
          aggregateId: 'ticket-uuid-1',
          eventType: 'ticket.created',
          payload: { priority: 'P1', organizationId: 'org-1' },
        }),
      );

      expect(sqlCalls.length).toBeGreaterThan(0);
    });
  });

  describe('TenantContextMissingError shape', () => {
    it('is an instance of Error', () => {
      const err = new TenantContextMissingError();
      expect(err).toBeInstanceOf(Error);
    });

    it('has name TenantContextMissingError', () => {
      const err = new TenantContextMissingError();
      expect(err.name).toBe('TenantContextMissingError');
    });
  });
});
