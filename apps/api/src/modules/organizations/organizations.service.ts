/**
 * OrganizationsService — business rules for the organizations module.
 *
 * Rules enforced:
 *   - Per-tenant name uniqueness (active organisations only; deactivated names
 *     may be reused).
 *   - Optimistic-concurrency version check on PATCH.
 *   - No edits to inactive organisations (422 ORGANIZATION_INACTIVE).
 *   - Auto-generated slug from name when not supplied.
 *   - customFieldValues size cap enforced at DTO level (32 KB).
 *
 * All DB access is through OrganizationsRepository which extends TenantRepository.
 * Outbox events are emitted inside the same repository transaction.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { pool } from '@opsninja/db';
import { OrganizationsRepository, type OrganizationDetail } from './organizations.repository';
import type { OrganizationRegistry } from '@opsninja/db';
import type { CreateOrganizationDto } from './dto/create-organization.dto';
import type { UpdateOrganizationDto } from './dto/update-organization.dto';
import type { ListOrganizationsQuery } from './dto/list-organizations.query';
import type { PaginatedOrganizations } from './organizations.repository';
import type { DeactivateOrganizationDto } from './dto/deactivate-organization.dto';
import type { ReactivateOrganizationDto } from './dto/reactivate-organization.dto';
import type { PutCustomFieldValuesDto } from './custom-fields/dto/custom-field-def.dto';
import { CustomFieldDefsService } from './custom-fields/custom-field-defs.service';
import { VerifiedDomainsService } from './verified-domains/verified-domains.service';
import { extractEmailDomain } from './verified-domains/domain-normalizer';
import { AuditWriter } from '../audit/audit-writer';
import { OrgScopeService } from '../../common/auth/org-scope.service';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly repo: OrganizationsRepository,
    private readonly customFieldDefsService: CustomFieldDefsService,
    private readonly verifiedDomainsService: VerifiedDomainsService,
    private readonly auditWriter: AuditWriter,
    @Optional() private readonly orgScopeService?: OrgScopeService,
  ) {}

  // --------------------------------------------------------------------------
  // List
  // --------------------------------------------------------------------------

  async list(
    tenantId: string,
    query: ListOrganizationsQuery,
  ): Promise<PaginatedOrganizations> {
    try {
      return await this.repo.findPaginated(tenantId, query);
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === 'CURSOR_INVALID') {
        throw new BadRequestException({
          error: {
            code: 'CURSOR_INVALID',
            message: 'The pagination cursor is malformed or has been tampered with.',
          },
        });
      }
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // Get single
  // --------------------------------------------------------------------------

  async getById(tenantId: string, id: string): Promise<OrganizationDetail> {
    const org = await this.repo.findByIdWithDetail(tenantId, id);
    if (!org) {
      throw new NotFoundException({
        error: {
          code: 'ORGANIZATION_NOT_FOUND',
          message: `Organization ${id} not found.`,
          details: [],
        },
      });
    }
    return org;
  }

  // --------------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------------

  async create(
    tenantId: string,
    dto: CreateOrganizationDto,
    actorId: string,
    traceId?: string,
  ): Promise<OrganizationRegistry> {
    // Name uniqueness: check among active orgs in this tenant
    const existing = await this.repo.findByName(tenantId, dto.name);
    if (existing) {
      throw new ConflictException({
        error: {
          code: 'ORGANIZATION_NAME_CONFLICT',
          message: `An active organization with the name "${dto.name}" already exists in this tenant.`,
          details: [{ field: 'name', existingId: existing.id }],
        },
      });
    }

    const slug = dto.slug ?? this.slugify(dto.name);

    // Validate custom field values against active definitions (WO-026)
    const cfValues = (dto.customFieldValues ?? {}) as Record<string, unknown>;
    if (Object.keys(cfValues).length > 0) {
      const cfResult = await this.customFieldDefsService.validateValues(tenantId, cfValues);
      if (!cfResult.valid) {
        throw new BadRequestException({
          error: {
            code: 'CUSTOM_FIELD_VALIDATION_FAILED',
            message: 'One or more custom field values are invalid.',
            details: cfResult.errors,
          },
        });
      }
    }

    const created = await this.repo.createOrganization(
      tenantId,
      {
        name: dto.name,
        slug,
        slaTier: dto.slaTier,
        region: dto.region ?? null,
        customFieldValues: cfValues,
        status: 'active',
        version: 1,
      },
      traceId,
    );

    // Audit: record creation inside the same transaction (fail-closed).
    await this.auditWriter.append({
      resourceType: 'organization',
      resourceId:   created.id,
      action:       'create',
      beforeState:  null,
      afterState: {
        id:               created.id,
        name:             created.name,
        slug:             (created as Record<string, unknown>)['slug'] ?? null,
        slaTier:          (created as Record<string, unknown>)['slaTier'] ?? null,
        region:           (created as Record<string, unknown>)['region'] ?? null,
        status:           (created as Record<string, unknown>)['status'] ?? 'active',
        version:          (created as Record<string, unknown>)['version'] ?? 1,
      },
    });

    this.logger.log('Organization created', {
      tenantId,
      orgId: created.id,
      actorId,
      operation: 'organization.create',
    });

    return created;
  }

  // --------------------------------------------------------------------------
  // Update (PATCH)
  // --------------------------------------------------------------------------

  async update(
    tenantId: string,
    id: string,
    dto: UpdateOrganizationDto,
    actorId: string,
    traceId?: string,
  ): Promise<OrganizationRegistry> {
    // Load current row for business-rule checks
    const current = await this.repo.findById(tenantId, id);
    if (!current) {
      throw new NotFoundException({
        error: {
          code: 'ORGANIZATION_NOT_FOUND',
          message: `Organization ${id} not found.`,
          details: [],
        },
      });
    }

    // Inactive organisations cannot be edited (WO-025 handles reactivation)
    if (current.status === 'inactive') {
      throw new UnprocessableEntityException({
        error: {
          code: 'ORGANIZATION_INACTIVE',
          message: 'Inactive organizations cannot be edited. Reactivate first.',
        },
      });
    }

    // Name uniqueness — only if name is being changed
    if (dto.name && dto.name.toLowerCase() !== current.name.toLowerCase()) {
      const nameConflict = await this.repo.findByName(tenantId, dto.name);
      if (nameConflict && nameConflict.id !== id) {
        throw new ConflictException({
          error: {
            code: 'ORGANIZATION_NAME_CONFLICT',
            message: `An active organization with the name "${dto.name}" already exists.`,
            details: [{ field: 'name', existingId: nameConflict.id }],
          },
        });
      }
    }

    const { version: suppliedVersion, ...changes } = dto;

    // Validate custom field values if being updated (WO-026)
    if (changes.customFieldValues !== undefined) {
      const cfValues = changes.customFieldValues as Record<string, unknown>;
      if (Object.keys(cfValues).length > 0) {
        const cfResult = await this.customFieldDefsService.validateValues(tenantId, cfValues);
        if (!cfResult.valid) {
          throw new BadRequestException({
            error: {
              code: 'CUSTOM_FIELD_VALIDATION_FAILED',
              message: 'One or more custom field values are invalid.',
              details: cfResult.errors,
            },
          });
        }
      }
    }

    const result = await this.repo.updateOrganization(
      tenantId,
      id,
      suppliedVersion,
      {
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.slaTier !== undefined ? { slaTier: changes.slaTier } : {}),
        ...(changes.region !== undefined ? { region: changes.region } : {}),
        ...(changes.customFieldValues !== undefined
          ? { customFieldValues: changes.customFieldValues }
          : {}),
      },
      traceId,
    );

    if (result === 'VERSION_CONFLICT') {
      // Re-fetch to return current version in error details
      const fresh = await this.repo.findById(tenantId, id);
      throw new ConflictException({
        error: {
          code: 'ORGANIZATION_VERSION_CONFLICT',
          message: 'The organization was modified by another request. Fetch the latest version and retry.',
          details: [{ currentVersion: fresh?.version ?? 'unknown' }],
        },
      });
    }

    // Audit: record update inside the same transaction (fail-closed).
    await this.auditWriter.append({
      resourceType: 'organization',
      resourceId:   id,
      action:       'update',
      beforeState: {
        name:             current.name,
        slaTier:          (current as Record<string, unknown>)['slaTier'] ?? null,
        region:           (current as Record<string, unknown>)['region'] ?? null,
        customFieldValues: (current as Record<string, unknown>)['customFieldValues'] ?? {},
        version:          current.version,
      },
      afterState: {
        name:             result.name,
        slaTier:          (result as Record<string, unknown>)['slaTier'] ?? null,
        region:           (result as Record<string, unknown>)['region'] ?? null,
        customFieldValues: (result as Record<string, unknown>)['customFieldValues'] ?? {},
        version:          result.version,
      },
    });

    this.logger.log('Organization updated', {
      tenantId,
      orgId: id,
      actorId,
      operation: 'organization.update',
      changedFields: Object.keys(changes).filter((k) => changes[k as keyof typeof changes] !== undefined),
    });

    return result;
  }

  // --------------------------------------------------------------------------
  // putCustomFields — dedicated JSONB replace (WO-026)
  // --------------------------------------------------------------------------

  /**
   * Replace the entire custom_field_values JSONB for an organization.
   *
   * Validation is strict allow-list:
   *   - Unknown keys → 400 CUSTOM_FIELD_VALIDATION_FAILED
   *   - Missing required fields → 422 CUSTOM_FIELD_VALIDATION_FAILED
   *   - Type violations → 400 CUSTOM_FIELD_VALIDATION_FAILED with per-field details
   *   - Version mismatch → 409 ORGANIZATION_VERSION_CONFLICT
   *
   * Returns the organisation row with normalised customFieldValues.
   */
  async putCustomFields(
    tenantId: string,
    id: string,
    dto: PutCustomFieldValuesDto,
    actorId: string,
    traceId?: string,
  ): Promise<{ id: string; customFieldValues: Record<string, unknown>; version: number }> {
    // Load org
    const current = await this.repo.findById(tenantId, id);
    if (!current) {
      throw new NotFoundException({
        error: {
          code: 'ORGANIZATION_NOT_FOUND',
          message: `Organization ${id} not found.`,
          details: [],
        },
      });
    }

    if (current.status === 'inactive') {
      throw new UnprocessableEntityException({
        error: {
          code: 'ORGANIZATION_INACTIVE',
          message: 'Inactive organizations cannot be edited. Reactivate first.',
        },
      });
    }

    // Validate values against active definitions
    const cfValues = (dto.values ?? {}) as Record<string, unknown>;
    const cfResult = await this.customFieldDefsService.validateValues(tenantId, cfValues);

    if (!cfResult.valid) {
      // Distinguish required-missing (422) from type/unknown-key (400)
      const hasRequiredMissing = cfResult.errors.some((e) =>
        e.reason.includes('Required field is missing'),
      );
      if (hasRequiredMissing) {
        throw new UnprocessableEntityException({
          error: {
            code: 'CUSTOM_FIELD_VALIDATION_FAILED',
            message: 'Required custom field values are missing.',
            details: cfResult.errors,
          },
        });
      }
      throw new BadRequestException({
        error: {
          code: 'CUSTOM_FIELD_VALIDATION_FAILED',
          message: 'One or more custom field values are invalid.',
          details: cfResult.errors,
        },
      });
    }

    const normalized = (cfResult.normalized ?? cfValues) as Record<string, unknown>;

    // Preserve orphan values from archived fields that are not in the submitted payload.
    // Archived definitions are excluded from write validation but their stored values
    // must remain intact for reporting (edge case: org contains orphan keys from
    // a previously archived definition).
    const defs = await this.customFieldDefsService.listAll(tenantId);
    const archivedKeys = new Set(
      defs
        .filter((d) => d.archivedAt)
        .map((d) => d.fieldKey),
    );
    const existingValues = (current as Record<string, unknown>)['customFieldValues'] as Record<string, unknown> ?? {};
    const preserved: Record<string, unknown> = {};
    for (const key of archivedKeys) {
      if (key in existingValues) {
        preserved[key] = existingValues[key];
      }
    }

    const merged = { ...preserved, ...normalized };

    const result = await this.repo.updateOrganization(
      tenantId,
      id,
      dto.version,
      { customFieldValues: merged },
      traceId,
    );

    if (result === 'VERSION_CONFLICT') {
      const fresh = await this.repo.findById(tenantId, id);
      throw new ConflictException({
        error: {
          code: 'ORGANIZATION_VERSION_CONFLICT',
          message: 'The organization was modified by another request. Fetch the latest version and retry.',
          details: [{ currentVersion: fresh?.version ?? 'unknown' }],
        },
      });
    }

    // Audit: record custom-field replace inside the same transaction.
    await this.auditWriter.append({
      resourceType: 'organization',
      resourceId:   id,
      action:       'update',
      beforeState: {
        customFieldValues: existingValues,
        version: current.version,
      },
      afterState: {
        customFieldValues: merged,
        version: result.version,
      },
      metadata: { operation: 'custom_fields_replace', actorId },
    });

    this.logger.log('Organization custom fields replaced', {
      tenantId,
      orgId: id,
      actorId,
      operation: 'organization.custom_fields_replace',
      fieldCount: Object.keys(normalized).length,
    });

    return {
      id: result.id,
      customFieldValues: merged,
      version: result.version,
    };
  }

  // --------------------------------------------------------------------------
  // Lifecycle: isOrganizationActive (public interface for cross-module use)
  // --------------------------------------------------------------------------

  /**
   * Returns true when the organisation exists and has status='active'.
   *
   * Called by the tickets module before creating a new ticket so it never
   * joins directly to the organizations table (module boundary enforcement).
   * Returns false for unknown IDs so callers may treat unknown as inactive.
   */
  async isOrganizationActive(tenantId: string, organizationId: string): Promise<boolean> {
    return this.repo.isOrganizationActive(tenantId, organizationId);
  }

  // --------------------------------------------------------------------------
  // Lifecycle: deactivate
  // --------------------------------------------------------------------------

  /**
   * Deactivate an organisation.
   *
   * Business rules:
   *   - confirmName must match org.name exactly (case-sensitive) — prevents
   *     UI misclicks from propagating.
   *   - Idempotent: already-inactive returns 200 with current state.
   *   - Running SLA timers on in-flight tickets are intentionally NOT touched.
   *     Support obligations survive the customer relationship ending; pausing
   *     timers would penalise the customer unfairly.
   *   - Contacts' portal_access_enabled is set to false in the same TX.
   *   - Outbox event emitted once per genuine transition (not on idempotent repeat).
   */
  async deactivate(
    tenantId: string,
    id: string,
    dto: DeactivateOrganizationDto,
    actorId: string,
    traceId?: string,
  ): Promise<OrganizationRegistry> {
    // Load org for name-confirmation check (before the FOR UPDATE lock)
    const org = await this.repo.findById(tenantId, id);
    if (!org) {
      throw new NotFoundException({
        error: { code: 'ORGANIZATION_NOT_FOUND', message: `Organization ${id} not found.`, details: [] },
      });
    }

    // Confirmation name must match exactly
    if (dto.confirmName !== org.name) {
      throw new BadRequestException({
        error: {
          code: 'CONFIRMATION_NAME_MISMATCH',
          message: `confirmName "${dto.confirmName}" does not match the organization name "${org.name}".`,
        },
      });
    }

    const result = await this.repo.deactivateOrganization(tenantId, id, actorId, traceId);

    if (result === 'NOT_FOUND') {
      throw new NotFoundException({
        error: { code: 'ORGANIZATION_NOT_FOUND', message: `Organization ${id} not found.`, details: [] },
      });
    }

    if (result === 'ALREADY_INACTIVE') {
      // Idempotent — return current state without side effects
      this.logger.log('Organization already inactive (idempotent deactivate)', { tenantId, orgId: id, actorId });
      return org;
    }

    // Audit: record deactivation inside the same transaction (fail-closed).
    await this.auditWriter.append({
      resourceType: 'organization',
      resourceId:   id,
      action:       'deactivate',
      beforeState:  { status: 'active',   version: org.version },
      afterState:   { status: 'inactive', version: result.version },
      metadata:     { reason: dto.reason, actorId },
    });

    // Bump Redis scope versions for all agents with this org in scope so stale
    // tokens are detected on their next request and force re-authentication.
    if (this.orgScopeService) {
      await this.orgScopeService.invalidateOrgScopes(tenantId, id).catch((err) => {
        this.logger.warn('Failed to invalidate org scope caches after deactivation', {
          tenantId, orgId: id, error: (err as Error).message,
        });
      });
    }

    this.logger.log('Organization deactivated', { tenantId, orgId: id, actorId, operation: 'organization.deactivate' });
    return result;
  }

  // --------------------------------------------------------------------------
  // Lifecycle: reactivate
  // --------------------------------------------------------------------------

  async reactivate(
    tenantId: string,
    id: string,
    dto: ReactivateOrganizationDto,
    actorId: string,
    traceId?: string,
  ): Promise<OrganizationRegistry> {
    const org = await this.repo.findById(tenantId, id);
    if (!org) {
      throw new NotFoundException({
        error: { code: 'ORGANIZATION_NOT_FOUND', message: `Organization ${id} not found.`, details: [] },
      });
    }

    // If already active, return idempotently
    if (org.status === 'active') {
      this.logger.log('Organization already active (idempotent reactivate)', { tenantId, orgId: id, actorId });
      return org;
    }

    // Name-collision check: another active org may have taken the name
    const nameConflict = await this.repo.findByName(tenantId, org.name);
    if (nameConflict && nameConflict.id !== id) {
      throw new ConflictException({
        error: {
          code: 'ORGANIZATION_NAME_CONFLICT',
          message: `An active organization named "${org.name}" already exists. Rename it first, then reactivate.`,
          details: [{ existingId: nameConflict.id }],
        },
      });
    }

    const result = await this.repo.reactivateOrganization(tenantId, id, actorId, traceId);

    if (result === 'NOT_FOUND' || result === 'ALREADY_ACTIVE') {
      return org; // idempotent
    }

    // Audit: record reactivation inside the same transaction (fail-closed).
    await this.auditWriter.append({
      resourceType: 'organization',
      resourceId:   id,
      action:       'reactivate',
      beforeState:  { status: 'inactive', version: org.version },
      afterState:   { status: 'active',   version: result.version },
      metadata:     { reason: dto.reason, actorId },
    });

    // Bump Redis scope versions so agents see the restored org promptly.
    if (this.orgScopeService) {
      await this.orgScopeService.invalidateOrgScopes(tenantId, id).catch((err) => {
        this.logger.warn('Failed to invalidate org scope caches after reactivation', {
          tenantId, orgId: id, error: (err as Error).message,
        });
      });
    }

    this.logger.log('Organization reactivated', { tenantId, orgId: id, actorId, operation: 'organization.reactivate' });
    return result;
  }

  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // Domain resolution (WO-028) — public interface for sign-up module
  // --------------------------------------------------------------------------

  /**
   * Resolve an email address to the organization it belongs to in this tenant.
   *
   * Module boundary rule: the sign-up module MUST call this method rather
   * than querying organization_verified_domains directly.
   *
   * Returns { organizationId } when exactly one verified domain matches,
   * or null for unmatched/ambiguous (fall-through to pending-approval state).
   */
  async resolveOrganizationByEmailDomain(
    tenantId: string,
    email: string,
  ): Promise<{ organizationId: string } | null> {
    // Extract domain from email address
    const domainResult = extractEmailDomain(email);
    if (!domainResult.ok) {
      this.logger.warn('Cannot resolve org for malformed email', { tenantId, reason: domainResult.reason });
      return null;
    }
    return this.verifiedDomainsService.resolveOrganizationByEmailDomain(
      tenantId,
      domainResult.domain,
    );
  }

  // --------------------------------------------------------------------------
  // Cross-tenant domain resolution (portal signup public interface)
  // --------------------------------------------------------------------------

  /**
   * Resolve an email domain against all tenants' verified domain registrations.
   *
   * This is a DELIBERATE cross-tenant read used exclusively by the portal
   * self-service signup flow. It bypasses RLS so it can scan all tenants'
   * verified domains without knowing the tenant up-front.
   *
   * Module-boundary rule: the identity/portal-signup module MUST call this
   * method rather than querying organization_verified_domains directly.
   *
   * Returns an array because two organisations in different tenants could
   * theoretically claim the same domain. Callers must handle:
   *   [] — unmatched → pending_admin_approval
   *   [single] — auto-bind → email_verification or sso
   *   [multi]  — ambiguous → pending_admin_approval + operator alert
   *
   * Only active organisations with a 'verified' domain status are returned.
   *
   * @param domain  Lowercase, punycode-normalised domain (e.g. 'acmecorp.com')
   */
  async findByVerifiedDomain(
    domain: string,
  ): Promise<Array<{ tenantId: string; organizationId: string; hasSsoConnection: boolean }>> {
    const client = await pool.connect();
    try {
      // Cross-tenant lookup — deliberately bypasses RLS.
      // Excludes deactivated organisations and unverified domain entries.
      const result = await client.query<{
        tenant_id: string;
        organization_id: string;
      }>(
        `SELECT ovd.tenant_id, ovd.organization_id
         FROM organization_verified_domains ovd
         JOIN organizations o
           ON o.id = ovd.organization_id
          AND o.tenant_id = ovd.tenant_id
         WHERE lower(ovd.domain) = lower($1)
           AND (o.status IS NULL OR o.status = 'active')
           AND (ovd.status IS NULL OR ovd.status = 'verified')
         ORDER BY ovd.tenant_id, ovd.organization_id`,
        [domain],
      );

      return result.rows.map((row) => ({
        tenantId: row.tenant_id,
        organizationId: row.organization_id,
        // SSO connections not yet implemented — always false until WO-SSO lands.
        hasSsoConnection: false,
      }));
    } finally {
      client.release();
    }
  }

  // --------------------------------------------------------------------------
  // addVerifiedDomain — used by admin signup approval (WO-091)
  // --------------------------------------------------------------------------

  /**
   * Directly add a verified domain to an organization (admin-approval path).
   *
   * Unlike the self-service register→verify flow, this immediately sets
   * status='verified' so future signups from the domain auto-bind.
   *
   * Delegates to VerifiedDomainsService which owns the uniqueness check and
   * emits its own audit record. Throws 409 if another org in the tenant
   * already claims the domain.
   */
  async addVerifiedDomain(
    tenantId: string,
    organizationId: string,
    domain: string,
    actorId: string,
  ): Promise<void> {
    // Use the existing adminOverride path via a synthetic domain registration
    // followed by immediate admin-override verification.
    // First register the domain (gets a pending entry):
    let domainId: string;
    try {
      const result = await this.verifiedDomainsService.register(tenantId, organizationId, {
        domain,
        includeSubdomains: false,
      });
      domainId = result.domain.id;
    } catch (err) {
      const e = err as { response?: { error?: { code?: string } } };
      if (e.response?.error?.code === 'VERIFIED_DOMAIN_CONFLICT') {
        throw new ConflictException({
          error: {
            code: 'VERIFIED_DOMAIN_CONFLICT',
            message: `Domain "${domain}" is already claimed by another organization in this tenant.`,
          },
        });
      }
      throw err;
    }

    // Immediately promote to verified via admin override
    await this.verifiedDomainsService.adminOverride(
      tenantId,
      organizationId,
      domainId,
      { justification: 'Admin-approved portal signup domain promotion' },
      actorId,
    );
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /** Derive a URL-safe slug from a human-readable name. */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || randomUUID().slice(0, 8);
  }
}
