/**
 * CustomFieldDefsService — business rules for custom field definition management.
 *
 * Business rules enforced:
 *   - field_key is immutable after creation (422 FIELD_KEY_IMMUTABLE).
 *   - Reserved key prefixes (sys_) are rejected (422 RESERVED_FIELD_KEY).
 *   - field_key uniqueness per tenant (409 FIELD_KEY_CONFLICT).
 *   - Definition count limit per tenant: 100 (422 DEFINITION_LIMIT_REACHED).
 *   - Options are additive-only: removing a referenced option returns 409.
 *   - Archive is soft (never hard-delete definitions).
 *   - In-memory validator cache is invalidated on every definition mutation.
 *
 * The compiled validator cache is keyed by (tenantId, in-memory version).
 * The version is an integer counter incremented on every write; it is NOT
 * persisted. After an API restart the cache is empty and validators are
 * compiled on-demand, which is the correct fallback behaviour.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CustomFieldDefsRepository, MAX_DEFS_PER_TENANT } from './custom-field-defs.repository';
import {
  compileValidator,
  invalidateValidatorCache,
  type FieldDefinition,
  type ValidateResult,
} from './custom-field-validator';
import { RESERVED_KEY_PREFIXES } from './dto/custom-field-def.dto';
import type {
  CreateCustomFieldDefDto,
  UpdateCustomFieldDefDto,
  ReorderCustomFieldDefsDto,
} from './dto/custom-field-def.dto';
import type { CustomFieldDef } from '@opsninja/db';

@Injectable()
export class CustomFieldDefsService {
  private readonly logger = new Logger(CustomFieldDefsService.name);

  /**
   * Per-tenant definition version counter.
   * Incremented on every write; used as the second part of the cache key.
   * Reset to 0 on process restart (cache miss → compile-on-demand fallback).
   */
  private readonly _defVersions = new Map<string, number>();

  constructor(private readonly repo: CustomFieldDefsRepository) {}

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async listAll(tenantId: string): Promise<CustomFieldDef[]> {
    return this.repo.findAll(tenantId);
  }

  // --------------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------------

  async create(
    tenantId: string,
    dto: CreateCustomFieldDefDto,
  ): Promise<CustomFieldDef> {
    // Reserved-key guard
    if (RESERVED_KEY_PREFIXES.some((p) => dto.fieldKey.startsWith(p))) {
      throw new UnprocessableEntityException({
        error: {
          code: 'RESERVED_FIELD_KEY',
          message: `Field key "${dto.fieldKey}" uses a reserved prefix.`,
        },
      });
    }

    // Uniqueness check
    const existing = await this.repo.findByKey(tenantId, dto.fieldKey);
    if (existing) {
      throw new ConflictException({
        error: {
          code: 'FIELD_KEY_CONFLICT',
          message: `A custom field definition with key "${dto.fieldKey}" already exists.`,
          details: [{ existingId: existing.id }],
        },
      });
    }

    // Definition count cap
    const count = await this.repo.countActive(tenantId);
    if (count >= MAX_DEFS_PER_TENANT) {
      throw new UnprocessableEntityException({
        error: {
          code: 'DEFINITION_LIMIT_REACHED',
          message: `Tenant has reached the maximum of ${MAX_DEFS_PER_TENANT} custom field definitions.`,
        },
      });
    }

    // Assign display_order = current count (append to end)
    const def = await this.repo.createDefinition(tenantId, {
      ...dto,
      displayOrder: dto.displayOrder ?? count,
    });

    this._bumpVersion(tenantId);
    this.logger.log('Custom field definition created', {
      tenantId,
      defId: def.id,
      fieldKey: def.fieldKey,
    });

    return def;
  }

  // --------------------------------------------------------------------------
  // Update
  // --------------------------------------------------------------------------

  async update(
    tenantId: string,
    id: string,
    dto: UpdateCustomFieldDefDto,
  ): Promise<CustomFieldDef> {
    const current = await this.repo.findById(tenantId, id);
    if (!current) {
      throw new NotFoundException({
        error: { code: 'DEFINITION_NOT_FOUND', message: `Custom field definition ${id} not found.` },
      });
    }
    if (current.archivedAt) {
      throw new UnprocessableEntityException({
        error: {
          code: 'DEFINITION_ARCHIVED',
          message: 'Archived definitions cannot be updated. Create a new definition instead.',
        },
      });
    }

    // Additive-only option guard
    if (dto.options) {
      const currentOptions = Array.isArray(current.options)
        ? (current.options as string[])
        : [];
      const removedOptions = currentOptions.filter((o) => !dto.options!.includes(o));
      if (removedOptions.length > 0) {
        throw new ConflictException({
          error: {
            code: 'OPTION_IN_USE',
            message:
              `Cannot remove options ${removedOptions.join(', ')} — existing organization ` +
              `values may reference them. Archive this definition and create a new one to rename options.`,
            details: removedOptions.map((o) => ({ option: o })),
          },
        });
      }
    }

    const updated = await this.repo.updateDefinition(tenantId, id, dto);
    if (!updated) {
      throw new NotFoundException({
        error: { code: 'DEFINITION_NOT_FOUND', message: `Custom field definition ${id} not found.` },
      });
    }

    this._bumpVersion(tenantId);
    return updated;
  }

  // --------------------------------------------------------------------------
  // Archive
  // --------------------------------------------------------------------------

  async archive(tenantId: string, id: string): Promise<CustomFieldDef> {
    const result = await this.repo.archiveDefinition(tenantId, id);

    if (result === 'NOT_FOUND') {
      throw new NotFoundException({
        error: { code: 'DEFINITION_NOT_FOUND', message: `Custom field definition ${id} not found.` },
      });
    }
    if (result === 'ALREADY_ARCHIVED') {
      // Idempotent — re-fetch and return current state
      const current = await this.repo.findById(tenantId, id);
      return current!;
    }

    this._bumpVersion(tenantId);
    this.logger.log('Custom field definition archived', { tenantId, defId: id });
    return result;
  }

  // --------------------------------------------------------------------------
  // Reorder
  // --------------------------------------------------------------------------

  async reorder(tenantId: string, dto: ReorderCustomFieldDefsDto): Promise<void> {
    // Verify all IDs belong to this tenant
    const all = await this.repo.findAll(tenantId);
    const ownedIds = new Set(all.map((d) => d.id));
    const unknown = dto.ids.filter((id) => !ownedIds.has(id));
    if (unknown.length > 0) {
      throw new NotFoundException({
        error: {
          code: 'DEFINITION_NOT_FOUND',
          message: `Unknown definition IDs: ${unknown.join(', ')}`,
        },
      });
    }

    await this.repo.reorderDefinitions(tenantId, dto.ids);
    this._bumpVersion(tenantId);
  }

  // --------------------------------------------------------------------------
  // Validation (used by OrganizationsService)
  // --------------------------------------------------------------------------

  /**
   * Validate custom_field_values against the active definitions for this tenant.
   *
   * Returns a ValidateResult with errors populated for violations.
   * Falls back to on-demand compile if the cache is cold (safe: cache miss
   * logs a warning but never fails the request).
   */
  async validateValues(
    tenantId: string,
    values: Record<string, unknown>,
  ): Promise<ValidateResult> {
    const defs = await this.repo.findAll(tenantId);
    if (defs.length === 0) {
      // No definitions configured — only reject unknown keys if values non-empty
      // Per allow-list posture: any key without a backing def is unknown.
      const errors = Object.keys(values).map((k) => ({
        fieldKey: k,
        reason: `Unknown custom field key "${k}" (no definitions configured for this tenant)`,
      }));
      return errors.length === 0
        ? { valid: true, errors: [], normalized: {} }
        : { valid: false, errors };
    }

    const version = this._defVersions.get(tenantId) ?? 0;
    const cacheKey = `${tenantId}:${version}`;

    const validator = compileValidator(defs as FieldDefinition[], cacheKey);
    return validator(values);
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private _bumpVersion(tenantId: string): void {
    const v = (this._defVersions.get(tenantId) ?? 0) + 1;
    this._defVersions.set(tenantId, v);
    invalidateValidatorCache(tenantId);
  }
}
