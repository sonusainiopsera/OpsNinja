/**
 * PortalSignupService — pure resolution logic for the portal self-service signup.
 *
 * Responsibilities:
 *   1. Email normalisation (via shared email-validator)
 *   2. Blocklist classification (in-process 5-min cache against signup_blocked_domains)
 *   3. Tenant resolution via OrganizationsService.findByVerifiedDomain (cross-module)
 *   4. Existing-user short-circuit (enumeration-safe — returns generic success)
 *   5. Signup request persistence + audit log in a single DB transaction
 *   6. Verification token issuance for matched-domain signups (email_verification path)
 *   7. Structured metric logging (portal_signup_attempts_total, portal_signup_domain_match_total)
 *
 * Non-disclosing design:
 *   - email_verification and pending_approval paths produce identical response shapes.
 *   - Existing-account path returns the same 202 body without creating a new row.
 *   - Raw email NEVER logged; domain and SHA-256 of local part only.
 *
 * Token issuance:
 *   For matched-domain (email_verification) paths a single-use 24-hour verification
 *   token is issued through PortalVerificationService.issue() immediately after the
 *   signup request is persisted. Email delivery failures are non-fatal: the user can
 *   trigger a resend via POST /api/v1/portal/signup/resend.
 *
 * Framework-free by design: no NestJS HTTP exceptions thrown here except for
 * the two explicit rejection paths (blocklist → 422, validation → 400).
 * All other outcomes resolve to a SignupResult discriminated union.
 */

import {
  Injectable,
  Logger,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { pool } from '@opsninja/db';

import { validateSignupEmail } from './email-validator';
import { OrganizationsService } from '../../organizations/organizations.service';
import { PortalVerificationService } from './portal-verification.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLOCKED_DOMAINS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SIGNUP_REQUEST_TTL_HOURS = 72;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignupAuthMode = 'sso' | 'email_verification' | 'pending_approval';

export interface SignupResult {
  status: 'accepted';
  authMode: SignupAuthMode;
  ssoRedirectUrl?: string;
  traceId: string;
}

/** Discriminated resolution result — internal; never surfaces to HTTP layer */
type DomainResolution =
  | { kind: 'sso'; tenantId: string; organizationId: string; ssoRedirectUrl: string }
  | { kind: 'email_verification'; tenantId: string; organizationId: string }
  | { kind: 'pending_approval' }
  | { kind: 'ambiguous' };

// ---------------------------------------------------------------------------
// Blocked-domains in-process cache
// ---------------------------------------------------------------------------

interface BlockedDomainCache {
  domains: Set<string>;
  refreshedAt: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class PortalSignupService {
  private readonly logger = new Logger(PortalSignupService.name);
  private blockedDomainsCache: BlockedDomainCache = {
    domains: new Set(),
    refreshedAt: 0,
  };

  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly verificationService: PortalVerificationService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Handle a full portal signup submission.
   *
   * Always returns a SignupResult; never returns null.
   * Throws only for validation (400) and blocklist (422).
   */
  async handleSignup(params: {
    email: string;
    fullName?: string;
    sourceIp: string;
    userAgent: string;
    traceId: string;
  }): Promise<SignupResult> {
    const { fullName, sourceIp, userAgent, traceId } = params;

    const { normalised, domain } = this.validateAndNormalise(params.email);
    await this.assertDomainNotBlocked(domain);

    const emailHash = this.hashEmail(normalised);
    const resolution = await this.resolveDomain(domain);

    // Emit attempt metric
    this.emitMetric('portal_signup_attempts_total', {
      outcome: resolution.kind,
      tenant_resolved: resolution.kind !== 'pending_approval' && resolution.kind !== 'ambiguous' ? 'true' : 'false',
    });
    this.emitMetric('portal_signup_domain_match_total', {
      matched: resolution.kind === 'email_verification' || resolution.kind === 'sso' ? 'true' : 'false',
    });

    if (resolution.kind === 'ambiguous') {
      // Ambiguous: operator alert + fall through to pending_approval
      this.logger.warn('[signup] Ambiguous domain resolution — duplicate verified domain', {
        domain,
        traceId,
      });
      this.emitMetric('portal_signup_errors_total', { reason: 'duplicate_verified_domain' });
    }

    // Short-circuit if this email already has an active portal user
    const existingUser = await this.findActivePortalUser(normalised, resolution);
    if (existingUser) {
      this.logger.log('[signup] Existing portal user — returning generic 202', {
        domain,
        traceId,
      });
      return this.buildResult('email_verification', traceId);
    }

    // SSO path: no DB row needed — redirect to IdP immediately
    if (resolution.kind === 'sso') {
      return this.buildResult('sso', traceId, resolution.ssoRedirectUrl);
    }

    // Persist signup request + audit record in one transaction
    const tenantId = (resolution.kind === 'email_verification') ? resolution.tenantId : null;
    const organizationId = (resolution.kind === 'email_verification') ? resolution.organizationId : null;
    const status = (resolution.kind === 'email_verification')
      ? 'pending_verification'
      : 'pending_admin_approval';

    const signupRequestId = await this.persistSignupRequest({
      emailNormalised: normalised,
      emailHash,
      fullName: fullName ?? null,
      tenantId,
      organizationId,
      status,
      sourceIp,
      userAgent,
      traceId,
    });

    // Issue verification token for matched-domain signups (email_verification path).
    // Delivery failures are non-fatal — the user can request a resend via /signup/resend.
    // The raw token is never persisted; only its SHA-256 hash is stored in the DB.
    if (resolution.kind === 'email_verification') {
      const baseUrl = this.config.get<string>(
        'PORTAL_VERIFY_BASE_URL',
        'https://portal.opsninja.io/verify',
      );
      try {
        await this.verificationService.issue(
          signupRequestId,
          normalised,
          tenantId,
          fullName ?? normalised.split('@')[0] ?? 'User',
          null, // org name — falls back to 'OpsNinja' in the email template
          baseUrl,
        );
      } catch (err) {
        // Non-fatal: token issue failure must not surface as a 500 or reveal delivery state.
        // The operator metric allows alerting on persistent delivery failures.
        this.logger.warn('[signup] Verification token issuance failed — user can request resend', {
          domain,
          traceId,
          error: (err as Error).message,
        });
        this.emitMetric('portal_signup_token_issue_failed_total', { reason: 'issue_error' });
      }
    }

    const authMode: SignupAuthMode = (resolution.kind === 'email_verification')
      ? 'email_verification'
      : 'pending_approval';

    this.logger.log('[signup] Signup request created', {
      domain,
      authMode,
      traceId,
      tenantResolved: tenantId !== null,
    });

    return this.buildResult(authMode, traceId);
  }

  /**
   * Handle the discovery query — returns authMode only (same throttle as POST).
   */
  async handleDiscovery(params: {
    email: string;
    traceId: string;
  }): Promise<{ authMode: SignupAuthMode }> {
    const { traceId } = params;
    const { domain } = this.validateAndNormalise(params.email);
    await this.assertDomainNotBlocked(domain);

    const resolution = await this.resolveDomain(domain);

    this.logger.log('[signup-discovery] Domain resolution', {
      domain,
      kind: resolution.kind,
      traceId,
    });

    if (resolution.kind === 'sso') return { authMode: 'sso' };
    if (resolution.kind === 'email_verification') return { authMode: 'email_verification' };
    return { authMode: 'pending_approval' };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private validateAndNormalise(email: string): { normalised: string; domain: string } {
    const result = validateSignupEmail(email);
    if (!result.valid) {
      if (result.code === 'SIGNUP_EMAIL_INVALID') {
        throw new BadRequestException({
          error: { code: result.code, message: result.message, details: [] },
        });
      }
      throw new UnprocessableEntityException({
        error: { code: result.code, message: result.message },
      });
    }
    return { normalised: result.normalised, domain: result.domain };
  }

  private async assertDomainNotBlocked(domain: string): Promise<void> {
    const blocked = await this.isBlockedDomain(domain);
    if (blocked) {
      throw new UnprocessableEntityException({
        error: {
          code: 'SIGNUP_DOMAIN_NOT_BUSINESS',
          message: 'The email domain is not accepted for portal signup. Please use a business email address.',
        },
      });
    }
  }

  private async resolveDomain(domain: string): Promise<DomainResolution> {
    try {
      const candidates = await this.organizationsService.findByVerifiedDomain(domain);

      if (candidates.length === 0) {
        return { kind: 'pending_approval' };
      }

      if (candidates.length > 1) {
        // Multiple orgs claim the same domain — ambiguous, fall back to pending_approval
        return { kind: 'ambiguous' };
      }

      const match = candidates[0]!;

      if (match.hasSsoConnection) {
        // SSO path: build the authorize redirect URL
        const ssoRedirectUrl = `https://sso.opsninja.io/authorize?tenant=${match.tenantId}&org=${match.organizationId}`;
        return {
          kind: 'sso',
          tenantId: match.tenantId,
          organizationId: match.organizationId,
          ssoRedirectUrl,
        };
      }

      return {
        kind: 'email_verification',
        tenantId: match.tenantId,
        organizationId: match.organizationId,
      };
    } catch (err) {
      // DB failure during domain resolution — treat as unmatched, not 500
      this.logger.error('[signup] Domain resolution error — routing to pending_approval', {
        domain,
        error: (err as Error).message,
      });
      return { kind: 'pending_approval' };
    }
  }

  private async findActivePortalUser(
    email: string,
    resolution: DomainResolution,
  ): Promise<boolean> {
    // Only tenant-bound rows are visible via RLS; for bootstrap reads we use
    // the same bypass pattern as DomainResolverService.
    if (resolution.kind !== 'email_verification' && resolution.kind !== 'sso') {
      return false; // unmatched — no portal user can exist
    }
    const tenantId = resolution.kind === 'email_verification'
      ? resolution.tenantId
      : (resolution as { kind: 'sso'; tenantId: string }).tenantId;

    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.portal_signup_bootstrap', 'true', true)");
      const row = await client.query<{ id: string }>(
        `SELECT id FROM portal_users WHERE tenant_id = $1 AND email = $2 LIMIT 1`,
        [tenantId, email],
      );
      return row.rows.length > 0;
    } finally {
      client.release();
    }
  }

  /**
   * Persist a new portal signup request or update an existing pending one.
   *
   * Returns the signup request ID so the caller can issue a verification token.
   * Idempotent: if a pending request already exists for the email, its metadata
   * is updated and the existing ID is returned — this prevents duplicate rows
   * when the same email submits the signup form multiple times.
   */
  private async persistSignupRequest(params: {
    emailNormalised: string;
    emailHash: string;
    fullName: string | null;
    tenantId: string | null;
    organizationId: string | null;
    status: string;
    sourceIp: string;
    userAgent: string;
    traceId: string;
  }): Promise<string> {
    const {
      emailNormalised, emailHash, fullName, tenantId, organizationId,
      status, sourceIp, userAgent, traceId,
    } = params;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.portal_signup_bootstrap', 'true', true)");

      // Idempotent: update if a request already exists in a pending state
      const existingPending = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM portal_signup_requests
         WHERE email = $1
           AND status IN ('pending_verification', 'pending_admin_approval')
         LIMIT 1`,
        [emailNormalised],
      );

      let signupRequestId: string;

      if (existingPending.rows.length > 0) {
        signupRequestId = existingPending.rows[0]!.id;
        // Update metadata on the existing pending request
        await client.query(
          `UPDATE portal_signup_requests
           SET email_hash = $2,
               full_name = COALESCE($3, full_name),
               tenant_id = COALESCE($4, tenant_id),
               organization_id = COALESCE($5, organization_id),
               source_ip = $6,
               user_agent = $7,
               updated_at = now()
           WHERE id = $1`,
          [signupRequestId, emailHash, fullName, tenantId, organizationId, sourceIp, userAgent],
        );
      } else {
        signupRequestId = randomUUID();
        const expiresAt = new Date(Date.now() + SIGNUP_REQUEST_TTL_HOURS * 3600 * 1000);
        await client.query(
          `INSERT INTO portal_signup_requests
             (id, tenant_id, organization_id, email, email_hash, full_name,
              status, source_ip, user_agent, expires_at, applicant_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT DO NOTHING`,
          [
            signupRequestId, tenantId, organizationId, emailNormalised, emailHash,
            fullName, status, sourceIp, userAgent, expiresAt,
            fullName ?? emailNormalised.split('@')[0] ?? 'unknown',
          ],
        );
      }

      // Append audit record (same TX — fail-closed)
      await client.query(
        `INSERT INTO audit_logs
           (id, tenant_id, actor_id, actor_kind, event_type, outcome,
            resource_type, resource_id, action, trace_id, ip_hash, metadata)
         VALUES ($1, $2, $3, 'anonymous', 'portal.signup.initiated', 'allowed',
                 'portal_signup_request', $4, 'create', $5, $6, $7)`,
        [
          randomUUID(),
          tenantId ?? '00000000-0000-0000-0000-000000000000',
          emailHash,         // actor_id = email hash (PII-free)
          signupRequestId,
          traceId,
          this.hashIp(sourceIp),
          JSON.stringify({
            domain: emailNormalised.split('@')[1] ?? '',
            status,
            tenantResolved: tenantId !== null,
            userAgent: userAgent.substring(0, 256),
          }),
        ],
      );

      await client.query('COMMIT');
      return signupRequestId;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      this.logger.error('[signup] Failed to persist signup request', {
        traceId,
        error: (err as Error).message,
      });
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Blocked-domains in-process cache
  // ---------------------------------------------------------------------------

  private async isBlockedDomain(domain: string): Promise<boolean> {
    const now = Date.now();
    if (now - this.blockedDomainsCache.refreshedAt > BLOCKED_DOMAINS_CACHE_TTL_MS) {
      await this.refreshBlockedDomainsCache();
    }
    return this.blockedDomainsCache.domains.has(domain.toLowerCase());
  }

  private async refreshBlockedDomainsCache(): Promise<void> {
    const client = await pool.connect();
    try {
      const result = await client.query<{ domain: string }>(
        `SELECT domain FROM signup_blocked_domains`,
      );
      this.blockedDomainsCache = {
        domains: new Set(result.rows.map((r) => r.domain.toLowerCase())),
        refreshedAt: Date.now(),
      };
      this.logger.debug('[signup] Blocked-domains cache refreshed', {
        count: this.blockedDomainsCache.domains.size,
      });
    } catch (err) {
      // Cache refresh failure is non-fatal — use stale data rather than rejecting all signups
      this.logger.warn('[signup] Failed to refresh blocked-domains cache', {
        error: (err as Error).message,
      });
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  private buildResult(
    authMode: SignupAuthMode,
    traceId: string,
    ssoRedirectUrl?: string,
  ): SignupResult {
    return { status: 'accepted', authMode, traceId, ...(ssoRedirectUrl ? { ssoRedirectUrl } : {}) };
  }

  private hashEmail(email: string): string {
    return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
  }

  private hashIp(ip: string): string {
    return createHash('sha256').update(ip).digest('hex');
  }

  private emitMetric(name: string, labels?: Record<string, string>): void {
    // Metrics are emitted as structured log lines consumed by the OTel pipeline.
    this.logger.log(`[metric] ${name}`, { metric: name, ...labels });
  }
}
