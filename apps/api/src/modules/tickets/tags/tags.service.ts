/**
 * TagsService — business logic for tag management.
 *
 * Responsibilities:
 *  - Enforce per-tenant tag cap (default 500, configurable).
 *  - Normalise slugs via tag-normalizer before persisting.
 *  - Coordinate transactional merge (remap ticket_tags + delete source + audit).
 *  - Manage ticket tag attach/detach with idempotent semantics.
 *
 * Error codes:
 *   TAG_NOT_FOUND     → 404
 *   TAG_DUPLICATE     → 409 (slug conflict on explicit create)
 *   TAG_CAP_EXCEEDED  → 422 (per-tenant tag limit reached)
 *   TAG_SELF_MERGE    → 422 (source === target)
 */

import type { Sql } from 'postgres';
import { TagsRepository, type TagRecord } from './tags.repository.js';
import { normalizeTagSlug } from './tag-normalizer.js';
import type { AuditWriter } from '../../audit/audit-writer.service.js';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type TagsErrorCode =
  | 'TAG_NOT_FOUND'
  | 'TAG_DUPLICATE'
  | 'TAG_CAP_EXCEEDED'
  | 'TAG_SELF_MERGE';

export class TagsError extends Error {
  constructor(
    public readonly code: TagsErrorCode,
    message: string,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TagsError';
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface TagsConfig {
  /** Maximum number of active tags per tenant. Default: 500. */
  maxTagsPerTenant: number;
}

const DEFAULT_CONFIG: TagsConfig = { maxTagsPerTenant: 500 };

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateTagInput {
  name: string;
  colour?: string | null;
}

export interface UpdateTagInput {
  name?: string;
  colour?: string | null;
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TagsService {
  constructor(
    private readonly repo: TagsRepository,
    private readonly auditWriter: AuditWriter | null,
    private readonly config: TagsConfig = DEFAULT_CONFIG,
  ) {}

  // -------------------------------------------------------------------------
  // Tag CRUD
  // -------------------------------------------------------------------------

  async listTags(sql: Sql, tenantId: string, includeInactive = false): Promise<TagRecord[]> {
    return this.repo.findAll(sql, tenantId, includeInactive);
  }

  async getTag(sql: Sql, tenantId: string, id: string): Promise<TagRecord> {
    const tag = await this.repo.findById(sql, tenantId, id);
    if (!tag) throw new TagsError('TAG_NOT_FOUND', `Tag ${id} not found.`);
    return tag;
  }

  /**
   * Creates a tag or returns the existing tag with the same slug.
   * For explicit create (POST /tags), returns 409 on duplicate instead of existing tag.
   * Set returnExistingOnConflict=true for attach-flow upsert behaviour.
   */
  async createTag(
    sql: Sql,
    tenantId: string,
    input: CreateTagInput,
    opts: { returnExistingOnConflict?: boolean; actorId?: string } = {},
  ): Promise<TagRecord> {
    const slug = normalizeTagSlug(input.name);

    if (!slug) {
      throw new TagsError('TAG_DUPLICATE', 'Tag name normalises to an empty slug.');
    }

    // Enforce tag cap (merges are exempt — they reduce count, not increase it).
    const currentCount = await this.repo.countActive(sql, tenantId);
    if (currentCount >= this.config.maxTagsPerTenant) {
      throw new TagsError(
        'TAG_CAP_EXCEEDED',
        `Tenant tag cap of ${this.config.maxTagsPerTenant} reached.`,
        { current: currentCount, cap: this.config.maxTagsPerTenant },
      );
    }

    const created = await this.repo.create(sql, {
      tenantId,
      name: input.name,
      slug,
      colour: input.colour ?? null,
    });

    if (!created) {
      // ON CONFLICT DO NOTHING — slug exists.
      const existing = await this.repo.findBySlug(sql, tenantId, slug);
      if (!existing) throw new TagsError('TAG_NOT_FOUND', 'Tag not found after conflict.');

      if (opts.returnExistingOnConflict) return existing;
      throw new TagsError('TAG_DUPLICATE', `A tag with slug "${slug}" already exists.`, {
        existingId: existing.id,
      });
    }

    if (this.auditWriter && opts.actorId) {
      await this.auditWriter.append(sql, {
        tenantId,
        actorType: 'user',
        actorId: opts.actorId,
        action: 'tag.created',
        resourceType: 'tag',
        resourceId: created.id,
        afterState: { name: created.name, slug: created.slug },
      });
    }

    return created;
  }

  async updateTag(
    sql: Sql,
    tenantId: string,
    id: string,
    input: UpdateTagInput,
    opts: { actorId?: string } = {},
  ): Promise<TagRecord> {
    const existing = await this.repo.findById(sql, tenantId, id);
    if (!existing) throw new TagsError('TAG_NOT_FOUND', `Tag ${id} not found.`);

    const params: Parameters<TagsRepository['update']>[3] = {};

    if (input.name !== undefined) {
      const newSlug = normalizeTagSlug(input.name);
      if (newSlug !== existing.slug) {
        const conflict = await this.repo.findBySlug(sql, tenantId, newSlug);
        if (conflict) {
          throw new TagsError('TAG_DUPLICATE', `A tag with slug "${newSlug}" already exists.`, {
            existingId: conflict.id,
          });
        }
        params.slug = newSlug;
      }
      params.name = input.name;
    }
    if (input.colour !== undefined) params.colour = input.colour;
    if (input.isActive !== undefined) params.isActive = input.isActive;

    const updated = await this.repo.update(sql, tenantId, id, params);
    if (!updated) throw new TagsError('TAG_NOT_FOUND', 'Tag not found after update.');

    if (this.auditWriter && opts.actorId) {
      await this.auditWriter.append(sql, {
        tenantId,
        actorType: 'user',
        actorId: opts.actorId,
        action: 'tag.updated',
        resourceType: 'tag',
        resourceId: id,
        beforeState: { name: existing.name, slug: existing.slug, isActive: existing.isActive },
        afterState:  { name: updated.name,  slug: updated.slug,  isActive: updated.isActive  },
      });
    }

    return updated;
  }

  async deactivateTag(
    sql: Sql,
    tenantId: string,
    id: string,
    opts: { actorId?: string } = {},
  ): Promise<TagRecord> {
    const existing = await this.repo.findById(sql, tenantId, id);
    if (!existing) throw new TagsError('TAG_NOT_FOUND', `Tag ${id} not found.`);

    const updated = await this.repo.update(sql, tenantId, id, { isActive: false });
    if (!updated) throw new TagsError('TAG_NOT_FOUND', 'Tag not found after deactivation.');

    if (this.auditWriter && opts.actorId) {
      await this.auditWriter.append(sql, {
        tenantId,
        actorType: 'user',
        actorId: opts.actorId,
        action: 'tag.deactivated',
        resourceType: 'tag',
        resourceId: id,
        beforeState: { isActive: true },
        afterState:  { isActive: false },
      });
    }

    return updated;
  }

  // -------------------------------------------------------------------------
  // Tag merge
  // -------------------------------------------------------------------------

  /**
   * Merges sourceTagId into targetTagId.
   *
   * - All ticket_tags rows pointing at source are remapped to target via
   *   INSERT … ON CONFLICT DO NOTHING (tickets carrying both tags are safe).
   * - The source tag row is then deleted.
   * - A single audit record is written with the affected ticket count.
   * - The tag cap is NOT checked: merging always reduces the tag count.
   *
   * Must be called inside a transaction (sql from sql.begin()).
   */
  async mergeTags(
    sql: Sql,
    tenantId: string,
    sourceTagId: string,
    targetTagId: string,
    opts: { actorId?: string } = {},
  ): Promise<{ affectedTicketCount: number }> {
    if (sourceTagId === targetTagId) {
      throw new TagsError('TAG_SELF_MERGE', 'Cannot merge a tag into itself.', {
        tagId: sourceTagId,
      });
    }

    const source = await this.repo.findById(sql, tenantId, sourceTagId);
    if (!source) throw new TagsError('TAG_NOT_FOUND', `Source tag ${sourceTagId} not found.`);

    const target = await this.repo.findById(sql, tenantId, targetTagId);
    if (!target) throw new TagsError('TAG_NOT_FOUND', `Target tag ${targetTagId} not found.`);

    const affectedTicketCount = await this.repo.mergeTicketTags(sql, tenantId, sourceTagId, targetTagId);

    // Delete source tag.
    await this.repo.update(sql, tenantId, sourceTagId, { isActive: false });
    await sql`DELETE FROM tags WHERE tenant_id = ${tenantId}::uuid AND id = ${sourceTagId}::uuid`;

    // Recalculate usage_count for the target tag.
    const newCount = await this.repo.countTicketsByTag(sql, tenantId, targetTagId);
    await this.repo.incrementUsageCount(sql, tenantId, targetTagId, newCount - target.usageCount);

    if (this.auditWriter && opts.actorId) {
      await this.auditWriter.append(sql, {
        tenantId,
        actorType: 'user',
        actorId: opts.actorId,
        action: 'tag.merged',
        resourceType: 'tag',
        resourceId: targetTagId,
        beforeState: { sourceId: sourceTagId, sourceSlug: source.slug },
        afterState:  { affectedTicketCount, mergedInto: targetTagId },
      });
    }

    return { affectedTicketCount };
  }

  // -------------------------------------------------------------------------
  // Ticket tag attach / detach
  // -------------------------------------------------------------------------

  /**
   * Attaches a tag to a ticket. Idempotent — returns 200 even when already attached.
   * Returns the final list of tag IDs attached to the ticket.
   */
  async attachTag(
    sql: Sql,
    tenantId: string,
    ticketId: string,
    tagId: string,
  ): Promise<void> {
    const tag = await this.repo.findById(sql, tenantId, tagId);
    if (!tag) throw new TagsError('TAG_NOT_FOUND', `Tag ${tagId} not found.`);

    const inserted = await this.repo.attachTag(sql, tenantId, ticketId, tagId);
    if (inserted) {
      await this.repo.incrementUsageCount(sql, tenantId, tagId, 1);
    }
  }

  /**
   * Detaches a tag from a ticket. Idempotent — no error if not attached.
   */
  async detachTag(
    sql: Sql,
    tenantId: string,
    ticketId: string,
    tagId: string,
  ): Promise<void> {
    const tag = await this.repo.findById(sql, tenantId, tagId);
    if (!tag) throw new TagsError('TAG_NOT_FOUND', `Tag ${tagId} not found.`);

    const deleted = await this.repo.detachTag(sql, tenantId, ticketId, tagId);
    if (deleted) {
      await this.repo.incrementUsageCount(sql, tenantId, tagId, -1);
    }
  }

  async getTicketTags(sql: Sql, tenantId: string, ticketId: string): Promise<TagRecord[]> {
    const tagIds = await this.repo.findTicketTags(sql, tenantId, ticketId);
    if (tagIds.length === 0) return [];
    const tags: TagRecord[] = [];
    for (const id of tagIds) {
      const tag = await this.repo.findById(sql, tenantId, id);
      if (tag) tags.push(tag);
    }
    return tags;
  }
}
