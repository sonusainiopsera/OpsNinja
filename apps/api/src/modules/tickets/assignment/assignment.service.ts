/**
 * AssignmentService — ticket assignment and reassignment with RBAC and scope validation.
 *
 * Design:
 *  - Pure decision function (decideAssignment) is fully testable without DB.
 *  - Service executes the decision, writes to the DB, emits outbox event and audit.
 *  - Scope validation: target agent's org_scope must include the ticket's org.
 *
 * RBAC rules:
 *  - ticket:assign_self: agent may assign the ticket to themselves or unassign themselves.
 *  - ticket:reassign:   manager+ may reassign to any in-scope agent or group.
 *  - Either permission allows self-assign; only reassign allows cross-agent transfer.
 *
 * Error codes:
 *   TICKET_NOT_FOUND       → 404
 *   ASSIGNEE_NOT_FOUND     → 404
 *   INSUFFICIENT_PERMISSION → 403
 *   OUT_OF_SCOPE_ASSIGNEE   → 422
 *   ASSIGNMENT_CONFLICT     → 409 (version mismatch)
 */

import type { Sql } from 'postgres';
import type { AuditWriter } from '../../audit/audit-writer.service.js';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type AssignmentErrorCode =
  | 'TICKET_NOT_FOUND'
  | 'ASSIGNEE_NOT_FOUND'
  | 'INSUFFICIENT_PERMISSION'
  | 'OUT_OF_SCOPE_ASSIGNEE'
  | 'ASSIGNMENT_CONFLICT';

export class AssignmentError extends Error {
  constructor(
    public readonly code: AssignmentErrorCode,
    message: string,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AssignmentError';
  }
}

// ---------------------------------------------------------------------------
// RBAC decision function (pure — no I/O)
// ---------------------------------------------------------------------------

export interface AssignmentDecisionInput {
  /** Permissions held by the acting user. */
  actorPermissions: string[];
  /** User ID of the actor. */
  actorUserId: string;
  /** Current assignee_user_id on the ticket (null = unassigned). */
  currentAssigneeId: string | null;
  /** Target assignee_user_id for the new assignment (null = unassign). */
  targetAssigneeId: string | null;
}

export type AssignmentDecision =
  | { allowed: true }
  | { allowed: false; reason: AssignmentErrorCode; message: string };

/**
 * Determines whether the actor may perform the requested assignment change.
 *
 * Rules:
 *  1. Actor has neither permission → INSUFFICIENT_PERMISSION.
 *  2. Unassigning the ticket (targetAssigneeId = null):
 *     - agent with assign_self may unassign if they are the current assignee.
 *     - reassign permission may always unassign.
 *  3. Self-assigning (targetAssigneeId === actorUserId):
 *     - assign_self OR reassign suffices.
 *  4. Cross-agent reassignment (targetAssigneeId ≠ null ≠ actorUserId):
 *     - Only reassign permission.
 */
export function decideAssignment(input: AssignmentDecisionInput): AssignmentDecision {
  const hasAssignSelf = input.actorPermissions.includes('ticket:assign_self');
  const hasReassign   = input.actorPermissions.includes('ticket:reassign');

  if (!hasAssignSelf && !hasReassign) {
    return {
      allowed: false,
      reason: 'INSUFFICIENT_PERMISSION',
      message: 'You do not have permission to assign tickets.',
    };
  }

  // Unassign case.
  if (input.targetAssigneeId === null) {
    if (hasReassign) return { allowed: true };
    // assign_self only: may unassign self, not others.
    if (hasAssignSelf && input.currentAssigneeId === input.actorUserId) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: 'INSUFFICIENT_PERMISSION',
      message: 'Agents may only unassign tickets they currently own.',
    };
  }

  // Self-assign case.
  if (input.targetAssigneeId === input.actorUserId) {
    return { allowed: true };
  }

  // Cross-agent reassignment: requires ticket:reassign.
  if (!hasReassign) {
    return {
      allowed: false,
      reason: 'INSUFFICIENT_PERMISSION',
      message: 'Reassigning a ticket to another agent requires the ticket:reassign permission.',
    };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Input/output types
// ---------------------------------------------------------------------------

export interface AssignTicketInput {
  /** Optimistic concurrency version (updated_at ISO string). */
  version: string;
  assigneeUserId?: string | null;
  assignmentGroupId?: string | null;
  reason?: string | null;
}

export interface TicketAssignmentRecord {
  id: string;
  tenantId: string;
  assigneeUserId: string | null;
  assignmentGroupId: string | null;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AssignmentService {
  constructor(private readonly auditWriter: AuditWriter | null) {}

  /**
   * Assigns (or unassigns) a ticket with RBAC enforcement, scope check,
   * version-guarded write, outbox event and audit record.
   */
  async assignTicket(
    sql: Sql,
    tenantId: string,
    ticketId: string,
    input: AssignTicketInput,
    actor: {
      userId: string;
      permissions: string[];
    },
  ): Promise<TicketAssignmentRecord> {
    return sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.current_tenant = '${tenantId}'`);

      // --- Fetch ticket (version-guarded) ---
      type TicketRow = {
        id: string;
        tenant_id: string;
        assignee_user_id: string | null;
        assignment_group_id: string | null;
        organization_id: string;
        updated_at: Date;
      };
      const tickets = await tx<TicketRow[]>`
        SELECT id, tenant_id, assignee_user_id, assignment_group_id, organization_id, updated_at
        FROM tickets
        WHERE tenant_id = ${tenantId}::uuid AND id = ${ticketId}::uuid
        LIMIT 1
        FOR UPDATE
      `;
      const ticket = tickets[0];
      if (!ticket) {
        throw new AssignmentError('TICKET_NOT_FOUND', `Ticket ${ticketId} not found.`);
      }

      // Version check.
      const dbVersionTs = ticket.updated_at instanceof Date
        ? ticket.updated_at.toISOString()
        : String(ticket.updated_at);
      if (input.version !== dbVersionTs) {
        throw new AssignmentError('ASSIGNMENT_CONFLICT', 'Ticket was modified since you last loaded it.', {
          currentVersion: dbVersionTs,
          providedVersion: input.version,
        });
      }

      // --- Scope validation for assignee_user_id ---
      const targetAssigneeId = input.assigneeUserId !== undefined
        ? (input.assigneeUserId ?? null)
        : ticket.assignee_user_id;

      if (input.assigneeUserId !== undefined && input.assigneeUserId !== null) {
        // Check that the target user exists in the same tenant.
        type UserRow = { id: string; org_scope: string[] | null };
        const users = await tx<UserRow[]>`
          SELECT u.id, ARRAY(
            SELECT oas.organization_id::text
            FROM org_access_scopes oas
            WHERE oas.tenant_id = ${tenantId}::uuid AND oas.user_id = u.id
          ) AS org_scope
          FROM users u
          WHERE u.tenant_id = ${tenantId}::uuid AND u.id = ${input.assigneeUserId}::uuid
        `;
        const targetUser = users[0];
        if (!targetUser) {
          throw new AssignmentError('ASSIGNEE_NOT_FOUND', `Assignee ${input.assigneeUserId} not found.`);
        }

        // Scope check: target's org_scope must include the ticket's organization.
        const orgScope = targetUser.org_scope ?? [];
        if (orgScope.length > 0 && !orgScope.includes(ticket.organization_id)) {
          throw new AssignmentError(
            'OUT_OF_SCOPE_ASSIGNEE',
            'The target agent\'s organisation scope does not cover this ticket\'s organisation.',
            { reason: 'out_of_scope_assignee', agentId: input.assigneeUserId, orgId: ticket.organization_id },
          );
        }
      }

      // --- RBAC decision ---
      const decision = decideAssignment({
        actorPermissions: actor.permissions,
        actorUserId: actor.userId,
        currentAssigneeId: ticket.assignee_user_id,
        targetAssigneeId: input.assigneeUserId !== undefined ? (input.assigneeUserId ?? null) : ticket.assignee_user_id,
      });

      if (!decision.allowed) {
        throw new AssignmentError(decision.reason, decision.message);
      }

      // --- Write ---
      const newAssigneeId = input.assigneeUserId !== undefined ? input.assigneeUserId : ticket.assignee_user_id;
      const newGroupId = input.assignmentGroupId !== undefined ? input.assignmentGroupId : ticket.assignment_group_id;

      type UpdatedRow = {
        id: string; tenant_id: string;
        assignee_user_id: string | null;
        assignment_group_id: string | null;
        updated_at: Date;
      };

      let updatedRows: UpdatedRow[];

      if (input.assigneeUserId !== undefined && input.assignmentGroupId !== undefined) {
        updatedRows = await tx<UpdatedRow[]>`
          UPDATE tickets
          SET assignee_user_id = ${newAssigneeId ?? null}::uuid,
              assignment_group_id = ${newGroupId ?? null}::uuid,
              updated_at = now()
          WHERE tenant_id = ${tenantId}::uuid AND id = ${ticketId}::uuid
          RETURNING id, tenant_id, assignee_user_id, assignment_group_id, updated_at
        `;
      } else if (input.assigneeUserId !== undefined) {
        updatedRows = await tx<UpdatedRow[]>`
          UPDATE tickets
          SET assignee_user_id = ${newAssigneeId ?? null}::uuid,
              updated_at = now()
          WHERE tenant_id = ${tenantId}::uuid AND id = ${ticketId}::uuid
          RETURNING id, tenant_id, assignee_user_id, assignment_group_id, updated_at
        `;
      } else {
        updatedRows = await tx<UpdatedRow[]>`
          UPDATE tickets
          SET assignment_group_id = ${newGroupId ?? null}::uuid,
              updated_at = now()
          WHERE tenant_id = ${tenantId}::uuid AND id = ${ticketId}::uuid
          RETURNING id, tenant_id, assignee_user_id, assignment_group_id, updated_at
        `;
      }

      const updated = updatedRows[0];
      if (!updated) throw new AssignmentError('TICKET_NOT_FOUND', 'Ticket disappeared during update.');

      // --- Outbox event ---
      const previousAssigneeId = ticket.assignee_user_id;
      const changedAssignee = input.assigneeUserId !== undefined && newAssigneeId !== previousAssigneeId;

      if (changedAssignee) {
        await tx`
          INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)
          VALUES (
            ${tenantId}::uuid,
            'ticket',
            ${ticketId}::uuid,
            'ticket.assigned',
            ${JSON.stringify({
              ticket_id:            ticketId,
              previous_assignee_id: previousAssigneeId,
              new_assignee_id:      newAssigneeId,
              actor_id:             actor.userId,
              reason:               input.reason ?? null,
            })}::jsonb
          )
        `;

        // --- Audit record ---
        if (this.auditWriter) {
          await this.auditWriter.append(tx, {
            tenantId,
            actorType: 'user',
            actorId: actor.userId,
            action: 'ticket.assigned',
            resourceType: 'ticket',
            resourceId: ticketId,
            beforeState: { assigneeUserId: previousAssigneeId },
            afterState:  { assigneeUserId: newAssigneeId, reason: input.reason ?? null },
          });
        }
      }

      return {
        id:               updated.id,
        tenantId:         updated.tenant_id,
        assigneeUserId:   updated.assignee_user_id,
        assignmentGroupId: updated.assignment_group_id,
        updatedAt:        updated.updated_at,
      };
    });
  }
}
