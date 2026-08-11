/**
 * Session-related interfaces for the refresh-token session store.
 */

/**
 * The Redis hash fields for a live session record.
 * Stored under key: session:{tenantId}:{sessionId}
 */
export interface RedisSessionRecord {
  tokenHash: string;
  prevHash: string;
  prevHashExpiresAt: string;   // unix ms as string (Redis hash values are strings)
  userId: string;
  tenantId: string;
  familyId: string;
  rotationCounter: string;     // integer as string
  revoked: string;             // '0' or '1'
  createdAt: string;           // unix ms as string
  expiresAt: string;           // unix ms as string
}

/**
 * Input to SessionService.createSession.
 */
export interface CreateSessionInput {
  userId: string;
  tenantId: string;
  familyId?: string;      // omit to start a new family
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Result of a successful session creation.
 * The raw refreshToken value must be set as a cookie and never stored.
 */
export interface CreatedSession {
  sessionId: string;
  refreshToken: string;   // opaque 256-bit value — set as cookie, never persisted
  familyId: string;
  expiresAt: Date;
}

/**
 * Input to SessionService.rotateSession.
 */
export interface RotateSessionInput {
  sessionId: string;
  tenantId: string;
  presentedToken: string;   // raw opaque value from cookie
  now?: Date;               // injectable clock for testing
}

/** Outcome variants returned by the atomic Lua rotation script. */
export type RotationOutcome =
  | { status: 'ok'; sessionId: string; familyId: string; rotationCounter: number }
  | { status: 'grace_window'; sessionId: string; familyId: string }
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'revoked' }
  | { status: 'reuse_detected'; familyId: string }
  | { status: 'invalid' };

/**
 * Input to SessionService.revokeSession.
 */
export interface RevokeSessionInput {
  sessionId: string;
  tenantId: string;
  reason?: string;
}

/**
 * Structured audit event emitted for every session lifecycle transition.
 */
export interface SessionAuditEvent {
  operation: 'issue' | 'rotate' | 'revoke' | 'reuse_detected' | 'revoke_family';
  sessionId: string;
  familyId?: string;
  userId: string;
  tenantId: string;
  traceId?: string;
  severity: 'info' | 'warn' | 'error';
  metadata?: Record<string, unknown>;
}
