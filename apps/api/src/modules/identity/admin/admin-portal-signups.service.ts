/**
 * AdminPortalSignupsService — approval queue for pending portal signup requests (WO-091).
 *
 * Responsibilities:
 *   list()    — tenant-scoped keyset pagination with filters and masked email
 *   approve() — conditional status transition, portal user creation, follow-up routing
 *   reject()  — conditional status transition, reason storage, optional notification
 *
 * Race-safety:
 *   All state transitions use a conditional UPDATE WHERE status = 'pending_admin_approval'
 *   returning affected rows. Zero rows → 409 SIGNUP_ALREADY_DECIDED.
 *
 * Security:
 *   - Email local part is always masked before leaving this service.
 *   - Rejection notifications disclose no org-existence information.
 *   - Tenant isolation: every query scopes to the authenticated tenant_id.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { pool } from '@opsninja/db';
import { PortalVerificationService } from '../portal-signup/portal-verification.service';
import { OrganizationsService } from '../../organizations/organizations.service';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PendingSignupItem {
  id: string;
  maskedEmail: string;
  domain: string;
  fullName: string | null;
  status: string;
  createdAt: string;
  verificationEmailStatus: string | null;
  duplicateDomainConflict: boolean;
  suggestedOrganizations: Array<{ id: string; name: string; score: number }>;
}

export interface PendingSignupsPage {
  data: PendingSignupItem[];
  nextCursor: string | null;
}

export interface ApproveSignupDto {
  organizationId: string;
  addVerifiedDomain?: boolean;
}

export interface ApproveResult {
  userId: string;
  organizationId: string;
  activationPath: 'verification_email' | 'active';
  verifiedDomainAdded: boolean;
}

export type RejectReason =
  | 'not_a_customer'
  | 'unrecognised_domain'
  | 'duplicate_request'
  | 'security_concern'
  | 'other';

export interface RejectSignupDto {
  reason: RejectReason;
  note?: string;
  notifyApplicant?: boolean;
}

export interface ListSignupsQuery {
  status?: string;
  from?: string;
  to?: string;
  domain?: string;
  cursor?: string;
  limit?: number;
}

const VALID_REJECT_REASONS = new Set<RejectReason>([
  'not_a_customer',
  'unrecognised_domain',
  'duplicate_request',
  'security_concern',
  'other',
]);

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AdminPortalSignupsService {
  private readonly logger = new Logger(AdminPortalSignupsService.name);

  constructor(
    private readonly verificationService: PortalVerificationService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  async list(tenantId: string, query: ListSignupsQuery): Promise<PendingSignupsPage> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const status = query.status ?? 'pending_admin_approval';

    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.portal_signup_bootstrap', 'true', true)");

      // Decode cursor (opaque base64-encoded created_at + id)
      let cursorCreatedAt: string | null = null;
      let cursorId: string | null = null;
      if (query.cursor) {
        try {
          const decoded = Buffer.from(query.cursor, 'base64').toString('utf-8');
          const [ca, id] = decoded.split('|');
          cursorCreatedAt = ca ?? null;
          cursorId = id ?? null;
        } catch {
          // Invalid cursor — treat as no cursor
        }
      }

      const params: unknown[] = [tenantId, status, limit + 1];
      let paramIdx = 4;

      const conditions: string[] = [
        'psr.tenant_id = $1',
        'psr.status = $2',
      ];

      if (query.domain) {
        conditions.push(`lower(psr.email) LIKE '%@' || lower($${paramIdx})`);
        params.push(query.domain.toLowerCase().replace(/[%_]/g, '\\$&'));
        paramIdx++;
      }
      if (query.from) {
        conditions.push(`psr.created_at >= $${paramIdx}::timestamptz`);
        params.push(query.from);
        paramIdx++;
      }
      if (query.to) {
        conditions.push(`psr.created_at <= $${paramIdx}::timestamptz`);
        params.push(query.to);
        paramIdx++;
      }
      if (cursorCreatedAt && cursorId) {
        conditions.push(
          `(psr.created_at, psr.id) < ($${paramIdx}::timestamptz, $${paramIdx + 1}::uuid)`,
        );
        params.push(cursorCreatedAt, cursorId);
        paramIdx += 2;
      }

      const whereClause = conditions.join(' AND ');

      const rows = await client.query<{
        id: string;
        email: string;
        full_name: string | null;
        status: string;
        created_at: Date;
        verification_email_status: string | null;
      }>(
        `SELECT psr.id, psr.email, psr.full_name, psr.status,
                psr.created_at, psr.verification_email_status
         FROM portal_signup_requests psr
         WHERE ${whereClause}
         ORDER BY psr.created_at DESC, psr.id DESC
         LIMIT $3`,
        params,
      );

      const hasMore = rows.rows.length > limit;
      const items = hasMore ? rows.rows.slice(0, limit) : rows.rows;

      // Check for duplicate-domain conflicts (another org in the tenant already has the domain)
      const domains = [...new Set(items.map((r) => this.extractDomain(r.email)))];
      const conflictMap = await this.checkDomainConflicts(client, tenantId, domains);

      // Fetch suggested org matches per domain
      const suggestMap = await this.fetchSuggestedOrgs(client, tenantId, domains);

      const data: PendingSignupItem[] = items.map((r) => {
        const domain = this.extractDomain(r.email);
        return {
          id: r.id,
          maskedEmail: this.maskEmail(r.email),
          domain,
          fullName: r.full_name,
          status: r.status,
          createdAt: r.created_at.toISOString(),
          verificationEmailStatus: r.verification_email_status,
          duplicateDomainConflict: conflictMap.has(domain),
          suggestedOrganizations: suggestMap.get(domain) ?? [],
        };
      });

      let nextCursor: string | null = null;
      if (hasMore && items.length > 0) {
        const last = items[items.length - 1]!;
        nextCursor = Buffer.from(
          `${last.created_at.toISOString()}|${last.id}`,
        ).toString('base64');
      }

      return { data, nextCursor };
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Approve
  // ---------------------------------------------------------------------------

  async approve(
    tenantId: string,
    signupId: string,
    dto: ApproveSignupDto,
    actorId: string,
  ): Promise<ApproveResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.portal_signup_bootstrap', 'true', true)");
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);

      // Fetch the signup request — scoped to caller's tenant
      const signupRow = await client.query<{
        id: string;
        tenant_id: string | null;
        email: string;
        full_name: string | null;
        applicant_name: string;
        status: string;
        verified_at: Date | null;
      }>(
        `SELECT id, tenant_id, email, full_name, applicant_name, status, verified_at
         FROM portal_signup_requests
         WHERE id = $1 AND tenant_id = $2
         LIMIT 1`,
        [signupId, tenantId],
      );

      if (signupRow.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({
          error: { code: 'SIGNUP_NOT_FOUND', message: 'Signup request not found.' },
        });
      }

      const signup = signupRow.rows[0]!;

      if (signup.status !== 'pending_admin_approval') {
        await client.query('ROLLBACK');
        throw new ConflictException({
          error: {
            code: 'SIGNUP_ALREADY_DECIDED',
            message: 'This signup request has already been actioned.',
          },
        });
      }

      // Validate target organization belongs to tenant and is active
      const orgRow = await client.query<{ id: string; status: string | null; name: string }>(
        `SELECT id, status, name FROM organizations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [dto.organizationId, tenantId],
      );

      if (orgRow.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({
          error: { code: 'ORGANIZATION_NOT_FOUND', message: 'Organization not found.' },
        });
      }

      const org = orgRow.rows[0]!;
      if (org.status === 'inactive' || org.status === 'suspended') {
        await client.query('ROLLBACK');
        throw new UnprocessableEntityException({
          error: {
            code: 'ORGANIZATION_INACTIVE',
            message: `Organization "${org.name}" is not active and cannot accept new members.`,
          },
        });
      }

      // Conditional state transition — race-safe
      const transitionResult = await client.query<{ id: string }>(
        `UPDATE portal_signup_requests
         SET status = 'verified',
             decided_by_user_id = $2,
             decided_at = now(),
             organization_id = $3,
             tenant_id = $4,
             updated_at = now()
         WHERE id = $1 AND status = 'pending_admin_approval'
         RETURNING id`,
        [signupId, actorId, dto.organizationId, tenantId],
      );

      if (transitionResult.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new ConflictException({
          error: {
            code: 'SIGNUP_ALREADY_DECIDED',
            message: 'This signup request has already been actioned by another administrator.',
          },
        });
      }

      // Create or link portal user — idempotent via ON CONFLICT DO NOTHING
      const portalUserId = randomUUID();
      const displayName = signup.full_name ?? signup.applicant_name ?? signup.email.split('@')[0] ?? 'User';

      await client.query(
        `INSERT INTO portal_users
           (id, tenant_id, organization_id, signup_request_id, email, name, role)
         VALUES ($1, $2, $3, $4, $5, $6, 'portal_user')
         ON CONFLICT (tenant_id, email) DO NOTHING`,
        [portalUserId, tenantId, dto.organizationId, signupId, signup.email, displayName],
      );

      // Resolve actual portal user id (may differ if ON CONFLICT triggered)
      const userRow = await client.query<{ id: string }>(
        `SELECT id FROM portal_users WHERE tenant_id = $1 AND email = $2 LIMIT 1`,
        [tenantId, signup.email],
      );
      const resolvedUserId = userRow.rows[0]?.id ?? portalUserId;

      // Audit record — inside same transaction (fail-closed)
      await client.query(
        `INSERT INTO audit_logs
           (id, tenant_id, actor_id, actor_kind, event_type, outcome, resource_type,
            resource_id, action, trace_id, metadata)
         VALUES ($1, $2, $3, 'staff', 'portal_signup.approved', 'allowed',
                 'portal_signup_request', $4, 'approve', $5, $6)`,
        [
          randomUUID(),
          tenantId,
          actorId,
          signupId,
          randomUUID(),
          JSON.stringify({
            organizationId: dto.organizationId,
            portalUserId: resolvedUserId,
            addVerifiedDomain: dto.addVerifiedDomain ?? false,
          }),
        ],
      );

      await client.query('COMMIT');

      // ---------------------------------------------------------------------------
      // Post-commit: follow-up routing (outside the main transaction)
      // ---------------------------------------------------------------------------
      let activationPath: 'verification_email' | 'active' = 'active';
      let verifiedDomainAdded = false;

      // AC4: add verified domain if requested (goes through OrganizationsService)
      if (dto.addVerifiedDomain) {
        const domain = this.extractDomain(signup.email);
        try {
          await this.organizationsService.addVerifiedDomain(tenantId, dto.organizationId, domain, actorId);
          verifiedDomainAdded = true;
        } catch (err) {
          // Re-throw 409 conflict so the caller knows
          const e = err as { status?: number; response?: { error?: { code?: string } } };
          if (e.status === 409) throw err;
          // Other errors: log but don't fail the approval
          this.logger.warn('[admin-signups] addVerifiedDomain failed after approve', {
            signupId,
            domain,
            error: (err as Error).message,
          });
        }
      }

      // AC5: branch on whether the applicant has already verified their email
      if (signup.verified_at !== null) {
        // Already-verified: send welcome-and-onboard email via notifications outbox
        await this.enqueueWelcomeEmail(tenantId, signup.email, resolvedUserId, dto.organizationId);
        activationPath = 'active';
      } else {
        // Unverified: issue a fresh verification token via the existing service
        const verificationBaseUrl = process.env['PORTAL_BASE_URL'] ?? 'https://portal.opsninja.io/verify';
        try {
          await this.verificationService.issue(
            signupId,
            signup.email,
            tenantId,
            displayName,
            org.name,
            verificationBaseUrl,
          );
          activationPath = 'verification_email';
        } catch (err) {
          this.logger.warn('[admin-signups] Failed to issue verification token after approve', {
            signupId,
            error: (err as Error).message,
          });
        }
      }

      this.logger.log('[admin-signups] Signup approved', {
        signupId,
        organizationId: dto.organizationId,
        actorId,
        activationPath,
        verifiedDomainAdded,
      });

      return {
        userId: resolvedUserId,
        organizationId: dto.organizationId,
        activationPath,
        verifiedDomainAdded,
      };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Reject
  // ---------------------------------------------------------------------------

  async reject(
    tenantId: string,
    signupId: string,
    dto: RejectSignupDto,
    actorId: string,
  ): Promise<{ status: 'rejected' }> {
    if (!VALID_REJECT_REASONS.has(dto.reason)) {
      throw new UnprocessableEntityException({
        error: {
          code: 'INVALID_REJECT_REASON',
          message: `Reason "${dto.reason}" is not in the allowed set.`,
        },
      });
    }

    // Sanitise note: strip any HTML tags
    const sanitisedNote = dto.note
      ? dto.note.replace(/<[^>]*>/g, '').trim().slice(0, 500)
      : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.portal_signup_bootstrap', 'true', true)");
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);

      // Verify the signup belongs to this tenant
      const signupRow = await client.query<{
        id: string;
        email: string;
        status: string;
      }>(
        `SELECT id, email, status
         FROM portal_signup_requests
         WHERE id = $1 AND tenant_id = $2
         LIMIT 1`,
        [signupId, tenantId],
      );

      if (signupRow.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({
          error: { code: 'SIGNUP_NOT_FOUND', message: 'Signup request not found.' },
        });
      }

      const signup = signupRow.rows[0]!;

      if (signup.status !== 'pending_admin_approval') {
        await client.query('ROLLBACK');
        throw new ConflictException({
          error: {
            code: 'SIGNUP_ALREADY_DECIDED',
            message: 'This signup request has already been actioned.',
          },
        });
      }

      // Conditional state transition
      const transitionResult = await client.query<{ id: string }>(
        `UPDATE portal_signup_requests
         SET status = 'rejected',
             decided_by_user_id = $2,
             decided_at = now(),
             decision_reason = $3,
             decision_note = $4,
             updated_at = now()
         WHERE id = $1 AND status = 'pending_admin_approval'
         RETURNING id`,
        [signupId, actorId, dto.reason, sanitisedNote],
      );

      if (transitionResult.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new ConflictException({
          error: {
            code: 'SIGNUP_ALREADY_DECIDED',
            message: 'This signup request has already been actioned by another administrator.',
          },
        });
      }

      // Audit record
      await client.query(
        `INSERT INTO audit_logs
           (id, tenant_id, actor_id, actor_kind, event_type, outcome, resource_type,
            resource_id, action, trace_id, metadata)
         VALUES ($1, $2, $3, 'staff', 'portal_signup.rejected', 'allowed',
                 'portal_signup_request', $4, 'reject', $5, $6)`,
        [
          randomUUID(),
          tenantId,
          actorId,
          signupId,
          randomUUID(),
          JSON.stringify({ reason: dto.reason, notifyApplicant: dto.notifyApplicant ?? false }),
        ],
      );

      // Optional neutral notification — must disclose no org details
      if (dto.notifyApplicant) {
        await client.query(
          `INSERT INTO notifications
             (id, tenant_id, recipient_email, channel, template_key, payload, dedupe_key, status)
           VALUES ($1, $2, $3, 'email', 'portal_signup_rejected_neutral', $4, $5, 'queued')
           ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
          [
            randomUUID(),
            tenantId,
            signup.email,
            JSON.stringify({
              // Intentionally neutral — no org names, no specific reason
              message: 'Unfortunately your portal access request could not be approved at this time.',
            }),
            `portal_signup_rejected:${signupId}`,
          ],
        );
      }

      await client.query('COMMIT');

      this.logger.log('[admin-signups] Signup rejected', {
        signupId,
        reason: dto.reason,
        actorId,
      });

      return { status: 'rejected' };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Queue metrics
  // ---------------------------------------------------------------------------

  async getQueueMetrics(tenantId: string): Promise<{
    queueDepth: number;
    oldestAgeSeconds: number;
  }> {
    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.portal_signup_bootstrap', 'true', true)");
      const row = await client.query<{
        depth: string;
        oldest_age_seconds: number | null;
      }>(
        `SELECT
           count(*) AS depth,
           EXTRACT(EPOCH FROM (now() - min(created_at))) AS oldest_age_seconds
         FROM portal_signup_requests
         WHERE tenant_id = $1 AND status = 'pending_admin_approval'`,
        [tenantId],
      );
      const r = row.rows[0]!;
      return {
        queueDepth: parseInt(r.depth, 10),
        oldestAgeSeconds: r.oldest_age_seconds ?? 0,
      };
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private extractDomain(email: string): string {
    return email.split('@')[1]?.toLowerCase() ?? '';
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return email;
    const masked = local.length <= 2
      ? '*'.repeat(local.length)
      : `${local[0]}${'*'.repeat(Math.min(local.length - 2, 4))}${local[local.length - 1]}`;
    return `${masked}@${domain}`;
  }

  private async checkDomainConflicts(
    client: { query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }> },
    tenantId: string,
    domains: string[],
  ): Promise<Set<string>> {
    if (domains.length === 0) return new Set();
    const placeholders = domains.map((_, i) => `$${i + 2}`).join(', ');
    const rows = await client.query<{ domain: string }>(
      `SELECT lower(ovd.domain) AS domain
       FROM organization_verified_domains ovd
       WHERE ovd.tenant_id = $1
         AND lower(ovd.domain) IN (${placeholders})
         AND ovd.status = 'verified'`,
      [tenantId, ...domains],
    );
    return new Set(rows.rows.map((r) => r.domain));
  }

  private async fetchSuggestedOrgs(
    client: { query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }> },
    tenantId: string,
    domains: string[],
  ): Promise<Map<string, Array<{ id: string; name: string; score: number }>>> {
    const result = new Map<string, Array<{ id: string; name: string; score: number }>>();
    if (domains.length === 0) return result;

    // Simple trigram-style suggestion: match org names and verified domains
    // against each applicant domain. Score = 1 for domain prefix match, 0.5 for name substring.
    const orgRows = await client.query<{ id: string; name: string }>(
      `SELECT id, name
       FROM organizations
       WHERE tenant_id = $1 AND (status IS NULL OR status = 'active')
       LIMIT 50`,
      [tenantId],
    );

    for (const domain of domains) {
      const scored: Array<{ id: string; name: string; score: number }> = [];
      const domainBase = domain.split('.')[0] ?? domain;

      for (const org of orgRows.rows) {
        const nameLower = org.name.toLowerCase();
        let score = 0;
        if (nameLower.includes(domainBase)) score = 0.9;
        else if (domainBase.includes(nameLower.replace(/\s+/g, ''))) score = 0.7;
        else if (nameLower.split(/\s+/).some((w) => domainBase.includes(w) && w.length > 2)) score = 0.4;
        if (score > 0) scored.push({ id: org.id, name: org.name, score });
      }

      scored.sort((a, b) => b.score - a.score);
      result.set(domain, scored.slice(0, 5));
    }

    return result;
  }

  private async enqueueWelcomeEmail(
    tenantId: string,
    email: string,
    portalUserId: string,
    organizationId: string,
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.portal_signup_bootstrap', 'true', true)");
      await client.query(
        `INSERT INTO notifications
           (id, tenant_id, recipient_email, channel, template_key, payload, dedupe_key, status)
         VALUES ($1, $2, $3, 'email', 'portal_welcome_onboard', $4, $5, 'queued')
         ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
        [
          randomUUID(),
          tenantId,
          email,
          JSON.stringify({ portalUserId, organizationId, onboardingRequired: true }),
          `portal_welcome:${portalUserId}`,
        ],
      );
    } finally {
      client.release();
    }
  }
}
