/**
 * ConnectionRegistry – in-memory store of all active WebSocket connections.
 *
 * Structure: Map<tenantId, Map<socketId, SocketWrapper>>
 *
 * Thread safety: Node.js is single-threaded; no locking needed.
 * Memory: Each wrapper is ~40KB (dominated by the ws socket buffer).
 */

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type WebSocket from 'ws';
import type { WsPrincipal } from '../auth/jwt-verifier';

export interface SocketWrapper {
  readonly id: string;
  readonly socket: WebSocket;
  readonly principal: WsPrincipal;
  lastPongAt: number;       // monotonic milliseconds (Date.now())
  lastDeliveredSeq: number;
}

@Injectable()
export class ConnectionRegistry {
  // tenantId → socketId → SocketWrapper
  private readonly tenants = new Map<string, Map<string, SocketWrapper>>();
  // principalId → Set<socketId> for per-principal cap enforcement
  private readonly principalSockets = new Map<string, Set<string>>();

  add(socket: WebSocket, principal: WsPrincipal): SocketWrapper {
    const id = randomUUID();
    const wrapper: SocketWrapper = {
      id,
      socket,
      principal,
      lastPongAt: Date.now(),
      lastDeliveredSeq: 0,
    };

    const { tenantId, principalId } = principal;

    if (!this.tenants.has(tenantId)) {
      this.tenants.set(tenantId, new Map());
    }
    this.tenants.get(tenantId)!.set(id, wrapper);

    if (!this.principalSockets.has(principalId)) {
      this.principalSockets.set(principalId, new Set());
    }
    this.principalSockets.get(principalId)!.add(id);

    return wrapper;
  }

  remove(wrapper: SocketWrapper): void {
    const { tenantId, principalId } = wrapper.principal;

    const tenantMap = this.tenants.get(tenantId);
    if (tenantMap) {
      tenantMap.delete(wrapper.id);
      if (tenantMap.size === 0) {
        this.tenants.delete(tenantId);
      }
    }

    const principalSet = this.principalSockets.get(principalId);
    if (principalSet) {
      principalSet.delete(wrapper.id);
      if (principalSet.size === 0) {
        this.principalSockets.delete(principalId);
      }
    }
  }

  getByTenant(tenantId: string): SocketWrapper[] {
    const tenantMap = this.tenants.get(tenantId);
    if (!tenantMap) return [];
    return Array.from(tenantMap.values());
  }

  totalConnections(): number {
    let count = 0;
    for (const m of this.tenants.values()) count += m.size;
    return count;
  }

  connectionCountForPrincipal(principalId: string): number {
    return this.principalSockets.get(principalId)?.size ?? 0;
  }

  allWrappers(): SocketWrapper[] {
    const result: SocketWrapper[] = [];
    for (const m of this.tenants.values()) {
      for (const w of m.values()) result.push(w);
    }
    return result;
  }
}
