/**
 * sanitise-file-name.ts — re-exports the canonical filename sanitisation
 * utilities from the tickets/attachments module for use by other modules.
 *
 * The implementation lives at:
 *   apps/api/src/modules/tickets/attachments/filename-sanitiser.ts
 *
 * This re-export gives consumers in common/files a stable import path that
 * won't change if the attachments module is restructured.
 */

export { sanitiseFilename, extractExtension } from '../../modules/tickets/attachments/filename-sanitiser';
