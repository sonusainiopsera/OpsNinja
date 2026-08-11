/**
 * AuditFilterMapper — WO-096.
 *
 * Translates validated AuditQueryDto fields into parameterised SQL predicates.
 * Security properties:
 *   - All field names are hardcoded in this file; user input is NEVER used as
 *     a SQL identifier or operator.
 *   - All values are passed as $n positional parameters, never interpolated.
 *   - The allow-list is exhaustive: any field not in the map produces no
 *     predicate (it cannot slip through as an injection payload).
 *
 * Usage:
 *   const { clauses, params } = buildAuditPredicates(dto, tenantId, startParam);
 *   sql += clauses.length ? ' AND ' + clauses.join(' AND ') : '';
 */

import { createHash } from 'crypto';
import type { AuditQueryDto } from './dto/audit-query.dto';

export interface AuditPredicates {
  /** Array of SQL condition strings with $n placeholders. */
  clauses: string[];
  /** Positional parameters matching the $n placeholders. */
  params:  unknown[];
}

/**
 * Build the WHERE predicates for an audit log query.
 *
 * @param dto        - Validated query filter DTO.
 * @param tenantId   - Current tenant — always added first for scoping.
 * @param startParam - The $n index for the first new parameter (default 1).
 */
export function buildAuditPredicates(
  dto: Pick<AuditQueryDto, 'from' | 'to' | 'actorId' | 'actorType' | 'resourceType' | 'resourceId' | 'action' | 'changedField'>,
  tenantId: string,
  startParam = 1,
): AuditPredicates {
  const clauses: string[] = [];
  const params:  unknown[] = [];

  let n = startParam;

  // Tenant scope — always required.
  clauses.push(`tenant_id = $${n++}`);
  params.push(tenantId);

  // Time range.
  if (dto.from) {
    clauses.push(`created_at >= $${n++}`);
    params.push(dto.from.toISOString());
  }
  if (dto.to) {
    clauses.push(`created_at <= $${n++}`);
    params.push(dto.to.toISOString());
  }

  // Actor filters.
  if (dto.actorId) {
    clauses.push(`actor_id = $${n++}`);
    params.push(dto.actorId);
  }
  if (dto.actorType) {
    clauses.push(`actor_kind = $${n++}`);
    params.push(dto.actorType);
  }

  // Resource filters.
  if (dto.resourceType) {
    clauses.push(`resource_type = $${n++}`);
    params.push(dto.resourceType);
  }
  if (dto.resourceId) {
    clauses.push(`resource_id = $${n++}`);
    params.push(dto.resourceId);
  }

  // Action filter.
  if (dto.action) {
    clauses.push(`action = $${n++}`);
    params.push(dto.action);
  }

  // Changed-field containment — uses GIN index on changed_fields text[].
  if (dto.changedField) {
    clauses.push(`$${n++} = ANY(changed_fields)`);
    params.push(dto.changedField);
  }

  return { clauses, params };
}

/**
 * Compute a canonical filter signature for cursor integrity checking.
 *
 * The signature is a SHA-256 over a sorted, canonical JSON representation of
 * the active filter values. A cursor carrying this signature cannot be replayed
 * against a different filter set.
 */
export function computeFilterSignature(
  dto: Pick<AuditQueryDto, 'from' | 'to' | 'actorId' | 'actorType' | 'resourceType' | 'resourceId' | 'action' | 'changedField'>,
): string {
  const canonical: Record<string, unknown> = {};

  if (dto.from)         canonical['from']         = dto.from.toISOString();
  if (dto.to)           canonical['to']           = dto.to.toISOString();
  if (dto.actorId)      canonical['actorId']      = dto.actorId;
  if (dto.actorType)    canonical['actorType']    = dto.actorType;
  if (dto.resourceType) canonical['resourceType'] = dto.resourceType;
  if (dto.resourceId)   canonical['resourceId']   = dto.resourceId;
  if (dto.action)       canonical['action']       = dto.action;
  if (dto.changedField) canonical['changedField'] = dto.changedField;

  const sorted = Object.keys(canonical)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => { acc[k] = canonical[k]; return acc; }, {});

  return createHash('sha256')
    .update('v1:' + JSON.stringify(sorted))
    .digest('hex')
    .substring(0, 16); // 8 bytes is sufficient for cursor integrity
}
