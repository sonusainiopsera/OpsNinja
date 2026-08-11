/**
 * TenantScopedReplicaRunner
 *
 * Mirrors the withTenantTransaction pattern from the primary unit-of-work but
 * against the read-replica pool:
 *
 *  1. Resolves the current tenant from PrincipalContext (fails loudly if absent).
 *  2. Acquires a PoolClient from the replica pool (fails with ReplicaUnavailableError).
 *  3. Opens a transaction (BEGIN).
 *  4. Issues SET LOCAL app.current_tenant so that RLS policies read the correct
 *     tenant before any query runs. Uses set_config(name, value, true) which is
 *     equivalent to SET LOCAL — scoped to the transaction and cleared on
 *     COMMIT/ROLLBACK for PgBouncer transaction-pooling compatibility.
 *  5. Runs the caller callback with the raw PoolClient.
 *  6. COMMITs on success, ROLLBACKs on any thrown error.
 *  7. Releases the connection back to the pool in all cases.
 */

import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

import { TenantContextMissingError } from '../../../data/tenant-repository';
import { getPrincipalContext } from '../../../observability/request-context';
import { REPORTING_DB } from './reporting-db.client';
import { ReplicaUnavailableError, mapReplicaError } from './reporting-errors';

@Injectable()
export class TenantScopedReplicaRunner {
  constructor(@Inject(REPORTING_DB) private readonly pool: Pool) {}

  async run<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    // Resolve tenant before acquiring a connection — fail fast without wasting a
    // pool slot when there is no context (programming error, not a user error).
    let tenantId: string;
    try {
      tenantId = getPrincipalContext().tenantId;
    } catch {
      throw new TenantContextMissingError('TenantScopedReplicaRunner');
    }

    let client: PoolClient | null = null;
    try {
      client = await this.pool.connect();
    } catch (err) {
      throw new ReplicaUnavailableError((err as Error).message);
    }

    let committed = false;
    try {
      await client.query('BEGIN');

      // SET LOCAL via set_config so the setting is transaction-scoped.
      // PgBouncer in transaction mode reuses backend connections across requests;
      // a session-level SET here would bleed tenant context into the next request.
      await client.query(
        "SELECT set_config('app.current_tenant', $1, true)",
        [tenantId],
      );

      const result = await callback(client);

      await client.query('COMMIT');
      committed = true;
      return result;
    } catch (err) {
      if (!committed) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          console.error('[reporting-replica:runner] ROLLBACK failed', {
            originalError: (err as Error).message,
            rollbackError: (rollbackErr as Error).message,
          });
        }
      }
      throw mapReplicaError(err);
    } finally {
      client.release();
    }
  }
}
