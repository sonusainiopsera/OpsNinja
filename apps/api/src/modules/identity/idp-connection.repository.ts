/**
 * IdpConnectionRepository — loads per-tenant OIDC provider configuration.
 *
 * Queries are cached per tenantId with a bounded TTL (default 5 min) to avoid
 * hitting the DB on every request. The client_secret is resolved separately
 * via SecretsProvider so it never enters the DB or logs.
 *
 * Security invariants:
 *   - Only the client_secret_ref (path) is stored; raw secrets are resolved
 *     lazily via SecretsProvider and must not be cached here.
 *   - clearCache() is provided for tests and forced-refresh scenarios.
 */

import type { Sql } from 'postgres';
import type { SecretsProvider } from './secrets.provider.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IdpConnectionRecord {
  tenantId: string;
  id: string;
  issuer: string;
  clientId: string;
  /** Reference path into Secrets Manager; use SecretsProvider to resolve. */
  clientSecretRef: string;
  scopes: string[];
  allowedEmailDomains: string[];
  redirectUri: string;
  jwksUri?: string;
  discoveryUrl?: string;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class IdpConnectionRepository {
  private readonly cache = new Map<string, { record: IdpConnectionRecord; expiresAt: number }>();
  private readonly cacheTtlMs: number;

  constructor(opts?: { cacheTtlMs?: number }) {
    this.cacheTtlMs = opts?.cacheTtlMs ?? 5 * 60 * 1000;
  }

  /**
   * Returns the single enabled IdP connection for a tenant, or null if none
   * is configured. Uses an in-memory TTL cache; bypasses RLS so the caller
   * must connect as a role with SELECT privilege on idp_connections.
   */
  async findEnabledByTenant(
    sql: Sql,
    tenantId: string,
  ): Promise<IdpConnectionRecord | null> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() < cached.expiresAt) return cached.record;

    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      SELECT id, tenant_id, issuer, client_id, client_secret_ref,
             scopes, allowed_email_domains, redirect_uri, jwks_uri, discovery_url
      FROM   idp_connections
      WHERE  tenant_id = $1::uuid
        AND  enabled   = true
      LIMIT  1
    `, [tenantId]);

    if (rows.length === 0) {
      this.cache.delete(tenantId);
      return null;
    }

    const record = mapRow(rows[0]!);
    this.cache.set(tenantId, { record, expiresAt: Date.now() + this.cacheTtlMs });
    return record;
  }

  /**
   * Resolves the client secret via the provided SecretsProvider.
   * Never caches the raw secret value.
   */
  async resolveClientSecret(
    connection: IdpConnectionRecord,
    secrets: SecretsProvider,
  ): Promise<string> {
    return secrets.getSecret(connection.clientSecretRef);
  }

  /** Evicts cached record(s). Pass tenantId to evict one tenant; omit to clear all. */
  clearCache(tenantId?: string): void {
    if (tenantId !== undefined) {
      this.cache.delete(tenantId);
    } else {
      this.cache.clear();
    }
  }
}

function mapRow(row: Record<string, unknown>): IdpConnectionRecord {
  const scopes = Array.isArray(row['scopes'])
    ? (row['scopes'] as string[])
    : ['openid', 'email', 'profile'];

  const allowedEmailDomains = Array.isArray(row['allowed_email_domains'])
    ? (row['allowed_email_domains'] as string[])
    : [];

  return {
    tenantId:             row['tenant_id'] as string,
    id:                   row['id'] as string,
    issuer:               row['issuer'] as string,
    clientId:             row['client_id'] as string,
    clientSecretRef:      row['client_secret_ref'] as string,
    scopes,
    allowedEmailDomains,
    redirectUri:          row['redirect_uri'] as string,
    jwksUri:              (row['jwks_uri'] as string | null) ?? undefined,
    discoveryUrl:         (row['discovery_url'] as string | null) ?? undefined,
  };
}
