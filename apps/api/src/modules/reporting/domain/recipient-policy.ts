/**
 * RecipientPolicy — validates schedule recipients against tenant security policy (WO-075).
 *
 * Rules (defaults to deny):
 *   1. type='user'     → resolve userId to a user row; must exist and be active.
 *   2. type='external' → email domain must match organizations.verified_domains
 *      OR be present on external_recipient_allowlist (non-revoked).
 *
 * An empty recipient list is rejected at save time (no silent no-op delivery).
 * Non-matching external addresses return RECIPIENT_DOMAIN_NOT_ALLOWED.
 * Every validation attempt (allow and deny) is logged for audit; the caller
 * writes the immutable audit record.
 */

import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { TenantRepository } from '../../../data/tenant-repository';
import {
  organizationVerifiedDomains,
  externalRecipientAllowlist,
  users,
  type ScheduleRecipient,
} from '@opsninja/db';

export interface RecipientValidationResult {
  valid: ScheduleRecipient[];
  denied: Array<{ recipient: ScheduleRecipient; reason: string }>;
}

// ---------------------------------------------------------------------------
// Inner read repositories
// ---------------------------------------------------------------------------

class RecipientPolicyReadRepository extends TenantRepository {
  /** Get all non-revoked external allowlist entries for the tenant. */
  async getAllowlistedEmails(tenantId: string): Promise<Set<string>> {
    const rows = await this.tx
      .select({ email: externalRecipientAllowlist.email })
      .from(externalRecipientAllowlist)
      .where(
        and(
          eq(externalRecipientAllowlist.tenantId, tenantId),
          isNull(externalRecipientAllowlist.revokedAt),
        ),
      );
    return new Set(rows.map((r) => r.email.toLowerCase()));
  }

  /** Get all verified domain strings for the tenant (verified only). */
  async getVerifiedDomains(tenantId: string): Promise<Set<string>> {
    const rows = await this.tx
      .select({ domain: organizationVerifiedDomains.domain })
      .from(organizationVerifiedDomains)
      .where(
        and(
          eq(organizationVerifiedDomains.tenantId, tenantId),
          eq(organizationVerifiedDomains.status, 'verified'),
        ),
      );
    return new Set(rows.map((r) => r.domain.toLowerCase()));
  }

  /** Check that all user IDs exist and are active for this tenant. */
  async getActiveUserIds(tenantId: string, userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await this.tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.active, true),
          sql`${users.id} = ANY(${userIds}::uuid[])`,
        ),
      );
    return new Set(rows.map((r) => r.id));
  }
}

// ---------------------------------------------------------------------------
// RecipientPolicy service
// ---------------------------------------------------------------------------

@Injectable()
export class RecipientPolicy {
  private readonly logger = new Logger(RecipientPolicy.name);
  private readonly readRepo: RecipientPolicyReadRepository;

  constructor(readRepo: RecipientPolicyReadRepository) {
    this.readRepo = readRepo;
  }

  /**
   * Validate a full recipient list. Throws 422 if any recipient is denied.
   * An empty list is rejected immediately.
   */
  async validateRecipients(
    tenantId: string,
    recipients: ScheduleRecipient[],
  ): Promise<void> {
    if (recipients.length === 0) {
      throw new UnprocessableEntityException({
        error: {
          code: 'SCHEDULE_RECIPIENTS_EMPTY',
          message: 'At least one recipient is required.',
        },
      });
    }

    const result = await this.classifyRecipients(tenantId, recipients);

    if (result.denied.length > 0) {
      const details = result.denied.map((d) => ({
        recipient: d.recipient.email ?? d.recipient.userId,
        reason: d.reason,
      }));
      throw new UnprocessableEntityException({
        error: {
          code: 'RECIPIENT_DOMAIN_NOT_ALLOWED',
          message:
            'One or more recipients failed domain validation. Add external addresses to the ' +
            'approved allowlist before using them as schedule recipients.',
          details,
        },
      });
    }
  }

  /**
   * Classify recipients into valid / denied without throwing.
   * Logs all outcomes for audit trail; caller writes formal audit record.
   */
  async classifyRecipients(
    tenantId: string,
    recipients: ScheduleRecipient[],
  ): Promise<RecipientValidationResult> {
    const [allowlistedEmails, verifiedDomains] = await Promise.all([
      this.readRepo.getAllowlistedEmails(tenantId),
      this.readRepo.getVerifiedDomains(tenantId),
    ]);

    const userIdRecipients = recipients.filter((r) => r.type === 'user' && r.userId);
    const userIdSet = await this.readRepo.getActiveUserIds(
      tenantId,
      userIdRecipients.map((r) => r.userId!),
    );

    const valid: ScheduleRecipient[] = [];
    const denied: Array<{ recipient: ScheduleRecipient; reason: string }> = [];

    for (const recipient of recipients) {
      if (recipient.type === 'user') {
        if (!recipient.userId) {
          denied.push({ recipient, reason: 'Missing userId for type=user recipient.' });
          continue;
        }
        if (!userIdSet.has(recipient.userId)) {
          denied.push({ recipient, reason: `User ${recipient.userId} not found or inactive.` });
          this.logger.warn('Recipient user not found or inactive', {
            tenantId,
            userId: recipient.userId,
          });
          continue;
        }
        valid.push(recipient);
        continue;
      }

      if (recipient.type === 'external') {
        if (!recipient.email) {
          denied.push({ recipient, reason: 'Missing email for type=external recipient.' });
          continue;
        }
        const email = recipient.email.toLowerCase();
        const domain = email.split('@')[1] ?? '';

        // Check allowlist first (explicit per-address approval).
        if (allowlistedEmails.has(email)) {
          this.logger.log('External recipient allowed via allowlist', {
            tenantId,
            // Never log the full email — log only domain for PII protection.
            domain,
          });
          valid.push(recipient);
          continue;
        }

        // Check verified domain.
        if (verifiedDomains.has(domain)) {
          valid.push(recipient);
          continue;
        }

        // Default: deny.
        denied.push({
          recipient,
          reason: `Domain "${domain}" is not in the tenant's verified domains and email is not on the external allowlist.`,
        });
        this.logger.warn('External recipient denied — domain not verified', {
          tenantId,
          domain,
        });
        continue;
      }

      denied.push({ recipient, reason: `Unknown recipient type "${(recipient as ScheduleRecipient).type}".` });
    }

    return { valid, denied };
  }
}

// Re-export for module wiring
export { RecipientPolicyReadRepository };
