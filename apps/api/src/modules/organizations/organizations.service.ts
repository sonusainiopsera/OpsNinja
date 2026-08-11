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
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { OrganizationsRepository, type OrganizationDetail } from './organizations.repository';
import type { OrganizationRegistry } from '@opsninja/db';
import type { CreateOrganizationDto } from './dto/create-organization.dto';
import type { UpdateOrganizationDto } from './dto/update-organization.dto';
import type { ListOrganizationsQuery } from './dto/list-organizations.query';
import type { PaginatedOrganizations } from './organizations.repository';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly repo: OrganizationsRepository) {}

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

    const created = await this.repo.createOrganization(
      tenantId,
      {
        name: dto.name,
        slug,
        slaTier: dto.slaTier,
        region: dto.region ?? null,
        customFieldValues: dto.customFieldValues ?? {},
        status: 'active',
        version: 1,
      },
      traceId,
    );

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
