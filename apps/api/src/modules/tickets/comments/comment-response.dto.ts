/**
 * CommentResponseDto — canonical comment shape returned by agent-facing endpoints.
 *
 * Security note:
 *   - visibility is included in agent responses (agents need to see it).
 *   - body is NOT sanitised here; clients render it through a sanitising
 *     markdown renderer with an allow-listed tag set (never via innerHTML).
 *   - Portal responses use a separate PortalCommentDto that omits visibility.
 */

import type { TicketComment } from '@opsninja/db';

export interface AttachmentSummaryDto {
  id: string;
  filename: string;
  mimeType: string;
}

export interface CommentDto {
  id: string;
  ticketId: string;
  authorId: string | null;
  visibility: string;
  body: string;
  attachments: AttachmentSummaryDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CommentPageDto {
  data: CommentDto[];
  /** Opaque base64url cursor for the next page, null when no more rows. */
  next_cursor: string | null;
}

export function mapToCommentDto(
  comment: TicketComment,
  attachments: AttachmentSummaryDto[] = [],
): CommentDto {
  return {
    id: comment.id,
    ticketId: comment.ticketId,
    authorId: comment.authorId ?? null,
    visibility: comment.visibility,
    body: comment.body,
    attachments,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}
