/**
 * UserProvisioningService — upserts staff users on (tenant_id, external_subject)
 * and resolves their tenant context, roles, and org scope for token issuance.
 *
 * WO-010 spec:
 *   - Match on (tenant_id, external_subject) — stable OIDC sub claim.
 *   - Update display_name and email on every successful login.
 *   - Reject if email_verified is false (AUTH_EMAIL_UNVERIFIED).
 *   - Reject if email domain is not in connection's allowed_email_domains.
 *   - Reject if user is disabled (AUTH_USER_DISABLED).
 *   - Reject if user has zero roles (AUTH_NO_ROLES).
 */

import type { Sql } from 'postgres';
import type { UsersRepository } from './users.repository.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthenticatedPrincipal {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string | null;
  roles: string[];
  orgScope: string[];
  orgScopeVersion: number;
}

export type ProvisionOutcome =
  | { ok: true; principal: AuthenticatedPrincipal }
  | { ok: false; error: 'EMAIL_UNVERIFIED' | 'DOMAIN_NOT_ALLOWED' | 'DISABLED' | 'NO_ROLES' };

export interface ProvisionParams {
  tenantId: string;
  externalSubject: string;
  email: string;
  displayName?: string;
  emailVerified: boolean;
  /** Domains permitted by IdP connection config. Empty array = allow all. */
  allowedEmailDomains?: string[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class UserProvisioningService {
  constructor(private readonly usersRepo: UsersRepository) {}

  /**
   * Runs inside an existing SQL transaction with `app.current_tenant` already set.
   *
   * Returns the fully resolved AuthenticatedPrincipal on success, or a typed
   * error outcome for each rejection path.
   */
  async provisionAndResolve(
    sql: Sql,
    params: ProvisionParams,
  ): Promise<ProvisionOutcome> {
    // 1. email_verified guard
    if (!params.emailVerified) {
      return { ok: false, error: 'EMAIL_UNVERIFIED' };
    }

    // 2. allowed_email_domains guard
    const allowedDomains = params.allowedEmailDomains ?? [];
    if (allowedDomains.length > 0) {
      const emailDomain = params.email.toLowerCase().split('@')[1] ?? '';
      const allowed = allowedDomains.some(
        (d) => d.toLowerCase() === emailDomain,
      );
      if (!allowed) {
        return { ok: false, error: 'DOMAIN_NOT_ALLOWED' };
      }
    }

    // 3. Upsert user on (tenant_id, external_subject)
    const user = await this.usersRepo.provisionStaffBySubject(sql, {
      tenantId: params.tenantId,
      externalSubject: params.externalSubject,
      email: params.email,
      displayName: params.displayName,
    });

    // 4. Status guard
    if (user.status === 'deactivated' || user.status === 'disabled') {
      return { ok: false, error: 'DISABLED' };
    }

    // 5. Role resolution
    const userRoles = await this.usersRepo.findUserRoles(sql, params.tenantId, user.id);
    if (userRoles.length === 0) {
      return { ok: false, error: 'NO_ROLES' };
    }

    // 6. Org scope resolution
    const orgScopeVersion = await this.usersRepo.getOrgScopeVersion(
      sql,
      params.tenantId,
      user.id,
    );

    const orgScope = await this.usersRepo.getOrgScopeIds(sql, params.tenantId, user.id);

    return {
      ok: true,
      principal: {
        userId: user.id,
        tenantId: params.tenantId,
        email: user.email,
        displayName: user.displayName,
        roles: userRoles.map((r) => r.roleName),
        orgScope,
        orgScopeVersion,
      },
    };
  }
}
