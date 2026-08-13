/**
 * content-type-allow-list.ts — re-exports the MIME allow-list and detection
 * utilities from the tickets/attachments/mime module for use by other modules.
 *
 * The implementation lives at:
 *   apps/api/src/modules/tickets/attachments/mime/magic-bytes.ts
 *
 * Permitted content types:
 *   image/png, image/jpeg, image/gif, image/webp,
 *   application/pdf, application/zip, application/gzip,
 *   text/plain (covers .txt, .log, .csv, .tsv, .md),
 *   application/octet-stream (binary fallback, .bin/.dat only)
 *
 * Anything not on this list is rejected during the confirm phase with
 * ATTACHMENT_TYPE_NOT_ALLOWED or ATTACHMENT_TYPE_MISMATCH.
 */

export {
  MAGIC_TABLE,
  ALLOWED_EXTENSIONS,
  detectMimeFromBytes,
  validateMimeAndExtension,
} from '../../modules/tickets/attachments/mime/magic-bytes';
export type { MimeCheckResult } from '../../modules/tickets/attachments/mime/magic-bytes';
