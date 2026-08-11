/**
 * ticket-state-machine.ts — pure lifecycle transition validator.
 *
 * This module has ZERO framework imports (no NestJS, no Drizzle) so it can
 * be exercised in plain unit tests without any container or DB setup.
 *
 * The "functional core, imperative shell" pattern:
 *   - This file = pure core: validates a transition, returns a typed decision.
 *   - TicketsService = imperative shell: calls this then executes DB writes.
 */

import type { TicketStatus } from '@opsninja/db';
import type { Permission } from '../../../common/auth/permission.catalog';
import { TRANSITION_TABLE, transitionKey, type TransitionRule } from './transition-table';

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface TransitionRequest {
  currentStatus: TicketStatus;
  requestedStatus: TicketStatus;
  /** Permissions held by the acting principal. */
  principalPermissions: ReadonlySet<Permission> | readonly Permission[];
}

export type TransitionDecision = TransitionAllowed | TransitionRejected;

export interface TransitionAllowed {
  allowed: true;
  rule: TransitionRule;
}

export interface TransitionRejected {
  allowed: false;
  reason: 'INVALID_TRANSITION' | 'PERMISSION_DENIED';
  /** Human-readable explanation (not localised — for API error body). */
  message: string;
  /**
   * The permission that would be required, only present for PERMISSION_DENIED
   * so the caller can distinguish "no such transition" from "not enough rights".
   */
  requiredPermission?: Permission;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * Validate whether `requestedStatus` is a legal transition from
 * `currentStatus` given the actor's permissions.
 *
 * Returns an `TransitionAllowed` when the transition is valid, otherwise
 * a `TransitionRejected` with a machine-readable reason code.
 *
 * No-op transitions (from === to) are always rejected as INVALID_TRANSITION
 * — callers should skip calling this function when they detect a no-op update.
 */
export function validateTransition(req: TransitionRequest): TransitionDecision {
  const { currentStatus, requestedStatus, principalPermissions } = req;

  // Self-transitions are never meaningful and not in the table.
  if (currentStatus === requestedStatus) {
    return {
      allowed: false,
      reason: 'INVALID_TRANSITION',
      message: `Ticket is already in status '${currentStatus}'. No transition needed.`,
    };
  }

  const key = transitionKey(currentStatus, requestedStatus);
  const rule = TRANSITION_TABLE.get(key);

  if (!rule) {
    return {
      allowed: false,
      reason: 'INVALID_TRANSITION',
      message: `Transition from '${currentStatus}' to '${requestedStatus}' is not permitted.`,
    };
  }

  // Check permission
  const perms: readonly Permission[] = Array.isArray(principalPermissions)
    ? (principalPermissions as readonly Permission[])
    : Array.from(principalPermissions as ReadonlySet<Permission>);

  if (!perms.includes(rule.requiredPermission)) {
    return {
      allowed: false,
      reason: 'PERMISSION_DENIED',
      message: `Permission '${rule.requiredPermission}' is required to transition from '${currentStatus}' to '${requestedStatus}'.`,
      requiredPermission: rule.requiredPermission,
    };
  }

  return { allowed: true, rule };
}

/**
 * Return all statuses reachable from `currentStatus` given `permissions`.
 * Useful for building UI affordance lists.
 */
export function reachableStatuses(
  currentStatus: TicketStatus,
  permissions: readonly Permission[],
): TicketStatus[] {
  const result: TicketStatus[] = [];
  for (const [key, rule] of TRANSITION_TABLE) {
    const [from] = key.split('→') as [TicketStatus, TicketStatus];
    if (from !== currentStatus) continue;
    if (permissions.includes(rule.requiredPermission)) {
      const to = key.split('→')[1] as TicketStatus;
      result.push(to);
    }
  }
  return result;
}
