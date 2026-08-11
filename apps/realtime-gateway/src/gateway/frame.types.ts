/**
 * WebSocket frame type definitions for the Realtime Gateway.
 *
 * Server → client frames carry type, tenantId, seq and sentAt.
 * Client → server messages are subscribe and pong.
 */

// ---------------------------------------------------------------------------
// Principal stored per socket
// ---------------------------------------------------------------------------

export interface SocketPrincipal {
  sub: string;
  tenantId: string;
  roles: string[];
  orgScopeVersion: number;
  /** Set of organisation UUIDs the principal may see. Empty = all (manager/admin). */
  orgScopeIds: Set<string>;
  userType: string;
}

// ---------------------------------------------------------------------------
// Per-socket wrapper stored in the registry
// ---------------------------------------------------------------------------

export interface SocketWrapper {
  /** The raw ws socket. */
  ws: import('ws').WebSocket;
  /** Authenticated principal. */
  principal: SocketPrincipal;
  /** Last seq delivered to this socket. */
  lastDeliveredSeq: number;
  /** Monotonic timestamp of last pong (performance.now()). */
  lastPongAt: number;
  /** True after subscribe message received. */
  subscribed: boolean;
}

// ---------------------------------------------------------------------------
// Server → client frames
// ---------------------------------------------------------------------------

export interface BaseServerFrame {
  type: string;
  tenantId: string;
  seq: number;
  sentAt: string; // ISO-8601
}

export interface HelloFrame extends BaseServerFrame {
  type: 'hello';
  payload: Record<string, never>;
}

export interface OrgBreakdownItem {
  organizationId: string;
  counters: Record<string, number>;
}

export interface DeltaPayload {
  globalCounters: Record<string, number>;
  orgBreakdown: OrgBreakdownItem[];
}

export interface DeltaFrame extends BaseServerFrame {
  type: 'delta';
  payload: DeltaPayload;
}

export interface SnapshotRequiredFrame extends BaseServerFrame {
  type: 'snapshot_required';
  payload: Record<string, never>;
}

export interface GoingAwayFrame extends BaseServerFrame {
  type: 'going_away';
  payload: { reconnectAfterMs: number };
}

export interface ErrorFrame extends BaseServerFrame {
  type: 'error';
  payload: { code: string; message: string };
}

export type ServerFrame =
  | HelloFrame
  | DeltaFrame
  | SnapshotRequiredFrame
  | GoingAwayFrame
  | ErrorFrame;

// ---------------------------------------------------------------------------
// Client → server messages
// ---------------------------------------------------------------------------

export interface SubscribeMessage {
  type: 'subscribe';
  channel: 'dashboard';
  lastSeq: number;
}

export interface PongMessage {
  type: 'pong';
}

export type ClientMessage = SubscribeMessage | PongMessage;

// ---------------------------------------------------------------------------
// Redis pub/sub payload (published by workers under dash:{tenantId})
// ---------------------------------------------------------------------------

export interface RedisPublishPayload {
  tenantId: string;
  seq: number;
  sentAt: string;
  globalCounters: Record<string, number>;
  orgBreakdown: OrgBreakdownItem[];
}
