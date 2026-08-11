/**
 * comment-cursor.ts — opaque base64url cursor for comment pagination.
 *
 * Comments are paginated by (created_at ASC, id ASC) — stable append-ordered.
 * The cursor encodes the last row's (createdAt, id) so the next page can
 * resume with WHERE (created_at, id) > (cursor.createdAt, cursor.id).
 *
 * Tampered or structurally invalid cursors throw 400 CURSOR_INVALID.
 */

import { BadRequestException } from '@nestjs/common';

export interface CommentCursorPayload {
  createdAt: string; // ISO 8601
  id: string;        // UUID
}

const CURSOR_INVALID_ERROR = {
  error: { code: 'CURSOR_INVALID', message: 'The pagination cursor is malformed or tampered.' },
};

/** Encode the last row's position into an opaque base64url cursor. */
export function encodeCommentCursor(createdAt: Date, id: string): string {
  const payload: CommentCursorPayload = { createdAt: createdAt.toISOString(), id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decode and validate a cursor string.
 * Throws 400 when malformed, empty, or structurally invalid.
 */
export function decodeCommentCursor(encoded: string): CommentCursorPayload {
  if (!encoded || typeof encoded !== 'string') {
    throw new BadRequestException(CURSOR_INVALID_ERROR);
  }

  let payload: unknown;
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    payload = JSON.parse(json);
  } catch {
    throw new BadRequestException(CURSOR_INVALID_ERROR);
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as Record<string, unknown>)['createdAt'] !== 'string' ||
    typeof (payload as Record<string, unknown>)['id'] !== 'string'
  ) {
    throw new BadRequestException(CURSOR_INVALID_ERROR);
  }

  const { createdAt, id } = payload as CommentCursorPayload;

  // Validate ISO 8601 date
  if (isNaN(Date.parse(createdAt))) {
    throw new BadRequestException(CURSOR_INVALID_ERROR);
  }

  return { createdAt, id };
}
