// Configuration
export { envSchema, validateEnv } from './config/env.schema';
export type { Env } from './config/env.schema';

// Base errors
export { BaseAppError, isBaseAppError } from './errors/base-error';

// Pagination
export {
  encodeCursor,
  decodeCursor,
  applyLimitCap,
  buildListEnvelope,
  TamperedCursorError,
  LIMIT_CAP,
} from './pagination/cursor';
export type { CursorPayload, ListEnvelope } from './pagination/cursor';
