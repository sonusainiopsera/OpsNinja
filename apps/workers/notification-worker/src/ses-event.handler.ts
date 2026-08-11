/**
 * SesEventHandler — processes SES bounce and complaint notifications.
 *
 * SNS delivers SES event notifications to a dedicated SQS queue (or the same
 * qNotify queue with a different message type). When a Bounce (Permanent) or
 * Complaint event is received:
 *   1. Extract bounced/complained recipient addresses.
 *   2. Compute SHA-256 hash of each lowercased address.
 *   3. Upsert into notification_suppressions.
 *
 * The bounced address may not correspond to an existing notifications row —
 * for example, when importing an external suppression list. The upsert must
 * not fail in that case.
 *
 * All recipient emails are Confidential-tier PII. Only the hash is persisted.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createHash } from 'crypto';
import * as schema from '@opsninja/db';

import { SesEventEnvelopeSchema } from './sqs-envelope.schema';

@Injectable()
export class SesEventHandler {
  private readonly logger = new Logger(SesEventHandler.name);

  constructor(private readonly pool: Pool) {}

  async handleSesEvent(tenantId: string, snsBody: string): Promise<void> {
    let event: unknown;
    try {
      event = JSON.parse(snsBody);
    } catch {
      this.logger.warn('Invalid SES event JSON — discarding');
      return;
    }

    const parsed = SesEventEnvelopeSchema.safeParse(event);
    if (!parsed.success) {
      this.logger.warn('Invalid SES event structure — discarding', {
        error: parsed.error.message,
      });
      return;
    }

    const sesEvent = parsed.data;
    const addresses: Array<{ email: string; reason: 'bounce' | 'complaint' }> = [];

    if (sesEvent.notificationType === 'Bounce' && sesEvent.bounce) {
      for (const r of sesEvent.bounce.bouncedRecipients) {
        addresses.push({ email: r.emailAddress, reason: 'bounce' });
      }
    } else if (sesEvent.notificationType === 'Complaint' && sesEvent.complaint) {
      for (const r of sesEvent.complaint.complainedRecipients) {
        addresses.push({ email: r.emailAddress, reason: 'complaint' });
      }
    } else {
      // Delivery or unknown — no action required.
      return;
    }

    if (addresses.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
      const tx = drizzle(client as unknown as Parameters<typeof drizzle>[0], { schema });

      for (const { email, reason } of addresses) {
        const hash = createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
        await tx
          .insert(schema.notificationSuppressions)
          .values({ tenantId, emailHash: hash, reason })
          .onConflictDoNothing({
            target: [
              schema.notificationSuppressions.tenantId,
              schema.notificationSuppressions.emailHash,
            ],
          });
      }

      await client.query('COMMIT');
      this.logger.log('SES event processed — suppressions upserted', {
        tenantId,
        type: sesEvent.notificationType,
        count: addresses.length,
      });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }
}
