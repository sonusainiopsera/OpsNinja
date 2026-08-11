/**
 * AssignmentController — HTTP handler for POST /api/v1/tickets/:id/assign.
 */

import type { Sql } from 'postgres';
import { AssignmentService, AssignmentError } from './assignment.service.js';

export interface AssignmentRequest {
  method: string;
  path: string;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body: unknown;
  tenantId: string;
  userId: string;
  permissions: string[];
}

export interface AssignmentResponse {
  status: number;
  body?: unknown;
}

export class AssignmentController {
  constructor(
    private readonly service: AssignmentService,
    private readonly getSql: () => Sql,
  ) {}

  // POST /api/v1/tickets/:id/assign
  async assign(req: AssignmentRequest): Promise<AssignmentResponse> {
    const ticketId = req.params['id'];
    if (!ticketId) return errorResponse(400, 'MISSING_ID', 'Ticket id is required.');

    const body = req.body as Record<string, unknown>;
    const version = typeof body['version'] === 'string' ? body['version'] : null;
    if (!version) return errorResponse(400, 'MISSING_VERSION', 'version is required for optimistic locking.');

    const assigneeUserId = 'assignee_user_id' in body
      ? (typeof body['assignee_user_id'] === 'string' ? body['assignee_user_id'] : null)
      : undefined;

    const assignmentGroupId = 'assignment_group_id' in body
      ? (typeof body['assignment_group_id'] === 'string' ? body['assignment_group_id'] : null)
      : undefined;

    const reason = typeof body['reason'] === 'string' ? body['reason'] : null;

    const sql = this.getSql();
    try {
      const result = await this.service.assignTicket(
        sql,
        req.tenantId,
        ticketId,
        { version, assigneeUserId, assignmentGroupId, reason },
        { userId: req.userId, permissions: req.permissions },
      );
      return { status: 200, body: result };
    } catch (err) {
      return handleServiceError(err);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleServiceError(err: unknown): AssignmentResponse {
  if (err instanceof AssignmentError) {
    switch (err.code) {
      case 'TICKET_NOT_FOUND':
      case 'ASSIGNEE_NOT_FOUND':
        return errorResponse(404, err.code, err.message);
      case 'INSUFFICIENT_PERMISSION':
        return errorResponse(403, err.code, err.message);
      case 'OUT_OF_SCOPE_ASSIGNEE':
        return errorResponse(422, err.code, err.message, err.meta);
      case 'ASSIGNMENT_CONFLICT':
        return errorResponse(409, err.code, err.message, err.meta);
    }
  }
  throw err;
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  meta?: Record<string, unknown>,
): AssignmentResponse {
  return { status, body: { error: code, message, ...meta } };
}
