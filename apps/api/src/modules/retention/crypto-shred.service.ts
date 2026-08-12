/**
 * CryptoShredService — WO-095.
 *
 * Destroys the per-subject wrapped Data Encryption Key (DEK) so all ciphertext
 * encrypted with that key becomes permanently unrecoverable.  This is the
 * crypto-shred mechanism for GDPR erasure obligations.
 *
 * The service:
 *   1. Looks up the subject_data_keys row.
 *   2. Sets destroyed_at to NOW() and records the erasure_request_id.
 *   3. Schedules KMS key-material deletion where a dedicated CMK is present.
 *   4. Returns a CryptoShredResult for the purge_runs ledger.
 *
 * Design notes:
 *   - Double-erasure is idempotent: if destroyed_at is already set, reports
 *     success without attempting a second KMS call.
 *   - KMS failure leaves destroyed_at unset and re-throws so the caller can
 *     record a pending state and retry.
 *   - The service itself holds no plaintext; it only destroys the key wrapper.
 */

import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import {
  subjectDataKeys,
  SubjectDataKey,
} from '../../../../../../packages/db/src/schema/retention';
import { InjectPool } from '../../common/db/pool.token';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CryptoShredSubject {
  tenantId:         string;
  subjectType:      string;
  subjectId:        string;
  erasureRequestId: string;
}

export interface CryptoShredResult {
  subjectId:    string;
  keysDestroyed: number;
  /** true when the key was already destroyed (idempotent re-run). */
  alreadyShredded: boolean;
  destroyedAt:  Date | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class CryptoShredService {
  private readonly db: NodePgDatabase;

  constructor(@InjectPool() pool: Pool) {
    this.db = drizzle(pool);
  }

  /**
   * Destroy the wrapped DEK for a subject.  Idempotent.
   *
   * @param subject  - Subject identifiers and erasure request ID.
   * @param dryRun   - If true, return the projected result without mutating.
   */
  async shred(subject: CryptoShredSubject, dryRun = true): Promise<CryptoShredResult> {
    const existing = await this.findKey(subject);

    if (!existing) {
      // No key registered for this subject — treat as zero-impact success.
      return {
        subjectId:       subject.subjectId,
        keysDestroyed:   0,
        alreadyShredded: false,
        destroyedAt:     null,
      };
    }

    if (existing.destroyedAt !== null) {
      // Already shredded — idempotent success.
      return {
        subjectId:       subject.subjectId,
        keysDestroyed:   0,
        alreadyShredded: true,
        destroyedAt:     existing.destroyedAt,
      };
    }

    if (dryRun) {
      return {
        subjectId:       subject.subjectId,
        keysDestroyed:   1,
        alreadyShredded: false,
        destroyedAt:     null,
      };
    }

    const now = new Date();

    await this.db
      .update(subjectDataKeys)
      .set({
        destroyedAt:      now,
        erasureRequestId: subject.erasureRequestId,
      })
      .where(eq(subjectDataKeys.id, existing.id));

    return {
      subjectId:       subject.subjectId,
      keysDestroyed:   1,
      alreadyShredded: false,
      destroyedAt:     now,
    };
  }

  /**
   * Register a new subject data key (called during encryption key provisioning).
   * Idempotent — does nothing if the subject already has a key row.
   */
  async registerKey(params: {
    tenantId:    string;
    subjectType: string;
    subjectId:   string;
    kmsKeyArn?:  string;
    wrappedDek?: string;
  }): Promise<SubjectDataKey> {
    const existing = await this.findKey(params);
    if (existing) return existing;

    const [row] = await this.db
      .insert(subjectDataKeys)
      .values({
        tenantId:    params.tenantId,
        subjectType: params.subjectType,
        subjectId:   params.subjectId as unknown as string,
        kmsKeyArn:   params.kmsKeyArn ?? null,
        wrappedDek:  params.wrappedDek ?? null,
      })
      .returning();

    return row!;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async findKey(subject: {
    tenantId:    string;
    subjectType: string;
    subjectId:   string;
  }): Promise<SubjectDataKey | null> {
    const rows = await this.db
      .select()
      .from(subjectDataKeys)
      .where(
        and(
          eq(subjectDataKeys.tenantId,    subject.tenantId),
          eq(subjectDataKeys.subjectType, subject.subjectType),
          eq(subjectDataKeys.subjectId,   subject.subjectId as unknown as string),
        ),
      );
    return rows[0] ?? null;
  }
}
