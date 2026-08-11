/**
 * UsersRepository — user and tenant-domain resolution for the auth flow.
 *
 * All methods accept a postgres `Sql` client. The caller must set
 * app.current_tenant via SET LOCAL for tenant-scoped queries.
 *
 * Tenant resolution (OIDC callback):
 *   1. Extract the email domain from the ID token.
 *   2. Query organization_verified_domains to find the matching tenant.
 *   3. Reject logins whose domain matches no verified domain (deny-by-default).
 *
 * User provisioning:
 *   - Staff users are loaded by (tenant_id, email_normalized).
 *   - If no user exists, one is provisioned with kind='staff' and status='active'.
 *   - The provisioned user must be assigned at least one role before their
 *     first session; this is enforced at the controller layer.
 */

import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserRecord {
  id: string;
  tenantId: string;
  email: string;
  emailNormalized: string;
  displayName: string | null;
  kind: string;
  status: string;
}

export interface TenantDomainMatch {
  tenantId: string;
  organizationId: string;
  domain: string;
}

export interface UserRoleRecord {
  roleId: string;
  roleName: string;
  displayName: string;
}

export interface OrgScopeVersion {
  version: number;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class UsersRepository {
  /**
   * Resolves the tenant for a given email domain.
   * Returns null if the domain matches no verified organization domain.
   */
  async resolveTenantByEmailDomain(
    sql: Sql,
    emailDomain: string,
  ): Promise<TenantDomainMatch | null> {
    // Search globally (bypasses RLS — superuser or BYPASSRLS role required)
    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      SELECT ovd.tenant_id, ovd.organization_id, ovd.domain
      FROM   organization_verified_domains ovd
      WHERE  lower(ovd.domain) = lower($1)
      LIMIT  1
    `, [emailDomain]);

    if (rows.length === 0) return null;
    const row = rows[0]!;
    return {
      tenantId:       row['tenant_id'] as string,
      organizationId: row['organization_id'] as string,
      domain:         row['domain'] as string,
    };
  }

  /**
   * Finds a user by (tenant_id, email_normalized).
   * Runs as the caller's role — must have app.current_tenant set.
   */
  async findByEmail(
    sql: Sql,
    tenantId: string,
    emailNormalized: string,
  ): Promise<UserRecord | null> {
    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      SELECT id, tenant_id, email, email_normalized, display_name, kind, status
      FROM   users
      WHERE  tenant_id        = $1::uuid
        AND  email_normalized = $2
      LIMIT  1
    `, [tenantId, emailNormalized]);

    if (rows.length === 0) return null;
    return mapUserRow(rows[0]!);
  }

  /**
   * Finds a user by (tenant_id, id).
   */
  async findById(
    sql: Sql,
    tenantId: string,
    userId: string,
  ): Promise<UserRecord | null> {
    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      SELECT id, tenant_id, email, email_normalized, display_name, kind, status
      FROM   users
      WHERE  tenant_id = $1::uuid
        AND  id        = $2::uuid
      LIMIT  1
    `, [tenantId, userId]);

    if (rows.length === 0) return null;
    return mapUserRow(rows[0]!);
  }

  /**
   * Provisions a new staff user. Returns the created record.
   * Runs inside the caller's transaction; the caller must have INSERT on users.
   */
  async provisionStaff(
    sql: Sql,
    params: {
      tenantId: string;
      email: string;
      displayName?: string;
    },
  ): Promise<UserRecord> {
    const emailNormalized = params.email.toLowerCase().trim();
    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      INSERT INTO users
        (tenant_id, id, email, email_normalized, display_name, kind, status, user_type)
      VALUES
        ($1::uuid, gen_random_uuid(), $2, $3, $4, 'staff', 'active', 'staff')
      ON CONFLICT (tenant_id, email_normalized)
        WHERE email_normalized IS NOT NULL
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          status       = CASE WHEN users.status = 'deactivated' THEN users.status ELSE 'active' END
      RETURNING id, tenant_id, email, email_normalized, display_name, kind, status
    `, [params.tenantId, params.email, emailNormalized, params.displayName ?? null]);

    return mapUserRow(rows[0]!);
  }

  /**
   * Returns the roles assigned to a user in a tenant.
   */
  async findUserRoles(sql: Sql, tenantId: string, userId: string): Promise<UserRoleRecord[]> {
    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      SELECT r.id AS role_id, r.name AS role_name, r.display_name
      FROM   user_roles ur
      JOIN   roles r ON r.id = ur.role_id
      WHERE  ur.tenant_id = $1::uuid
        AND  ur.user_id   = $2::uuid
    `, [tenantId, userId]);

    return rows.map((r) => ({
      roleId:      r['role_id'] as string,
      roleName:    r['role_name'] as string,
      displayName: r['display_name'] as string,
    }));
  }

  /**
   * Returns a monotonically increasing version number representing the
   * agent's org-scope assignments. Callers embed this in the access token;
   * a version mismatch in the guard triggers a lightweight DB re-check.
   *
   * Implementation: COUNT of agent_org_scopes rows (simple, append-only).
   */
  async getOrgScopeVersion(
    sql: Sql,
    tenantId: string,
    userId: string,
  ): Promise<number> {
    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      SELECT COUNT(*) AS n
      FROM   agent_org_scopes
      WHERE  tenant_id = $1::uuid
        AND  user_id   = $2::uuid
    `, [tenantId, userId]);
    return Number((rows[0] as Record<string, unknown>)['n'] ?? 0);
  }
}

function mapUserRow(row: Record<string, unknown>): UserRecord {
  return {
    id:             row['id'] as string,
    tenantId:       row['tenant_id'] as string,
    email:          row['email'] as string,
    emailNormalized: row['email_normalized'] as string,
    displayName:    (row['display_name'] as string | null) ?? null,
    kind:           row['kind'] as string,
    status:         row['status'] as string,
  };
}
