/**
 * Audit module — barrel export for the audit write path.
 *
 * The AuditWriter class is framework-agnostic (no NestJS decorators) so it
 * can be used directly in tests and non-NestJS contexts. When NestJS is
 * adopted, wrap with @Injectable() and register in a NestJS module here.
 */

export { AuditWriter, AuditAdvisoryLockError } from './audit-writer.service.js';
export type { AuditRecord, VerifyResult, RedisHashCache, ClockFn, LoggerPort } from './audit-writer.service.js';
export {
  canonicalSerialize,
  computeChainHash,
  deriveChangedFields,
  truncateState,
  partitionName,
  GENESIS_HASH,
  MAX_STATE_BYTES,
} from './audit-hash.js';
export type { TruncateResult } from './audit-hash.js';
