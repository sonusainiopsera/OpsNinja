/**
 * JiraMappingResolver — deterministic target selection for outbound escalations.
 *
 * Precedence (most-specific first):
 *   1. Category-path mapping — a mapping whose syncRules.categoryPaths includes the
 *      ticket's category path string (exact match after normalisation).
 *   2. Organisation mapping — a mapping whose syncRules.organizationIds includes the
 *      ticket's organisationId UUID.
 *   3. Connection default — an enabled mapping with isDefault = true.
 *
 * Security guarantee: the resolver ONLY returns enabled, tenant-owned mappings.
 * There is no implicit fallback to an unscoped project. If no match is found,
 * MappingNotFoundError is thrown and the escalation path must be blocked upstream.
 *
 * The resolver is intentionally free from HTTP concerns so it can be called from
 * both the HTTP controller layer and from background sync workers.
 */

import { Injectable } from '@nestjs/common';
import type { JiraProjectMapping } from '@opsninja/db';
import { JiraMappingRepository } from './jira-mapping.repository';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TicketRoutingContext {
  /** Slash-separated category path, e.g. "Cloud / AWS / EC2". */
  categoryPath?: string;
  /** UUID of the customer organisation owning the ticket. */
  organizationId?: string;
  /** Optional: restrict resolver to a specific connection. */
  connectionId?: string;
}

export interface ResolvedTarget {
  connectionId: string;
  projectKey: string;
  projectId: string;
  issueTypeId: string;
  mapping: JiraProjectMapping;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class MappingNotFoundError extends Error {
  readonly code = 'MAPPING_NOT_FOUND' as const;

  constructor(tenantId: string, ticket: TicketRoutingContext) {
    super(
      `No enabled Jira mapping found for tenant ${tenantId} ` +
        `(categoryPath: ${ticket.categoryPath ?? 'none'}, ` +
        `organizationId: ${ticket.organizationId ?? 'none'}).`,
    );
    this.name = 'MappingNotFoundError';
  }
}

export class MappingDisabledError extends Error {
  readonly code = 'MAPPING_DISABLED' as const;

  constructor(mappingId: string) {
    super(`Jira mapping ${mappingId} is disabled and cannot be used for escalation.`);
    this.name = 'MappingDisabledError';
  }
}

export class MappingTargetMissingError extends Error {
  readonly code = 'MAPPING_TARGET_MISSING' as const;

  constructor(projectKey: string) {
    super(
      `Jira project "${projectKey}" no longer exists or was renamed. ` +
        'Update or disable the mapping and re-escalate.',
    );
    this.name = 'MappingTargetMissingError';
  }
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

@Injectable()
export class JiraMappingResolver {
  constructor(private readonly repo: JiraMappingRepository) {}

  /**
   * Resolve the target Jira project for a ticket.
   *
   * Loads all enabled mappings for the tenant (optionally filtered to one
   * connection), then applies the precedence chain described in the module
   * docstring.
   *
   * @throws MappingNotFoundError when no enabled mapping matches.
   */
  async resolveTarget(
    tenantId: string,
    ticket: TicketRoutingContext,
  ): Promise<ResolvedTarget> {
    const enabled = await this.repo.findEnabled(tenantId, ticket.connectionId);

    if (enabled.length === 0) {
      throw new MappingNotFoundError(tenantId, ticket);
    }

    // --- Priority 1: category-path match -----------------------------------
    if (ticket.categoryPath) {
      const normalised = normaliseCategoryPath(ticket.categoryPath);
      const match = enabled.find((m) => {
        const rules = asSyncRules(m.syncRules);
        return (rules.categoryPaths ?? []).some(
          (cp) => normaliseCategoryPath(cp) === normalised,
        );
      });
      if (match) return toTarget(match);
    }

    // --- Priority 2: organisation match ------------------------------------
    if (ticket.organizationId) {
      const match = enabled.find((m) => {
        const rules = asSyncRules(m.syncRules);
        return (rules.organizationIds ?? []).includes(ticket.organizationId!);
      });
      if (match) return toTarget(match);
    }

    // --- Priority 3: connection default ------------------------------------
    const defaultMapping = enabled.find((m) => m.isDefault);
    if (defaultMapping) return toTarget(defaultMapping);

    // No match at any level.
    throw new MappingNotFoundError(tenantId, ticket);
  }

  /**
   * Resolve by explicit mapping ID — used when the caller already knows which
   * mapping it wants (e.g. a PUT /mappings/:id test endpoint or re-sync path).
   *
   * @throws MappingNotFoundError if the mapping doesn't exist or belongs to a
   *   different tenant.
   * @throws MappingDisabledError if the mapping is disabled.
   */
  async resolveById(tenantId: string, mappingId: string): Promise<ResolvedTarget> {
    const mappings = await this.repo.findEnabled(tenantId);
    const mapping = mappings.find((m) => m.id === mappingId);

    if (!mapping) {
      // Re-check with findById to distinguish not-found from disabled.
      const raw = await this.repo.findById(tenantId, mappingId);
      if (!raw) {
        throw new MappingNotFoundError(tenantId, {});
      }
      throw new MappingDisabledError(mappingId);
    }

    return toTarget(mapping);
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

interface SyncRulesWithRouting {
  categoryPaths?: string[];
  organizationIds?: string[];
  [k: string]: unknown;
}

function asSyncRules(raw: unknown): SyncRulesWithRouting {
  if (raw !== null && typeof raw === 'object') {
    return raw as SyncRulesWithRouting;
  }
  return {};
}

function normaliseCategoryPath(path: string): string {
  // Normalise whitespace and separators for case-insensitive comparison.
  return path
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .trim();
}

function toTarget(m: JiraProjectMapping): ResolvedTarget {
  return {
    connectionId: m.connectionId,
    projectKey: m.projectKey,
    projectId: m.projectId,
    issueTypeId: m.defaultIssueTypeId,
    mapping: m,
  };
}
