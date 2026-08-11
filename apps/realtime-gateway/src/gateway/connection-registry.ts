/**
 * In-memory connection registry.
 *
 * Maps tenantId → Set<SocketWrapper>. Provides O(1) lookup by tenant for
 * fan-out and O(1) lookup by principal for per-principal cap enforcement.
 *
 * Thread-safety: Node.js is single-threaded; no locking required.
 * Memory budget: ~40KB per socket; 2,000 sockets ≈ 80MB.
 */

import { Injectable } from '@nestjs/common';
import type { SocketWrapper, SocketPrincipal } from './frame.types';

@Injectable()
export class ConnectionRegistry {
  /** tenantId → Set of wrappers subscribed to that tenant channel. */
  private readonly byTenant = new Map<string, Set<SocketWrapper>>();

  /** socket (identity) → wrapper, for O(1) remove without linear scan. */
  private readonly bySocket = new Map<object, SocketWrapper>();

  /** principalId → count of open sockets. */
  private readonly byPrincipal = new Map<string, number>();

  get totalConnections(): number {
    return this.bySocket.size;
  }

  principalConnectionCount(principalId: string): number {
    return this.byPrincipal.get(principalId) ?? 0;
  }

  /**
   * Register a new socket wrapper. Returns the wrapper for convenience.
   */
  add(
    ws: import('ws').WebSocket,
    principal: SocketPrincipal,
  ): SocketWrapper {
    const wrapper: SocketWrapper = {
      ws,
      principal,
      lastDeliveredSeq: 0,
      lastPongAt: performance.now(),
      subscribed: false,
    };

    // Tenant bucket
    let tenantSet = this.byTenant.get(principal.tenantId);
    if (!tenantSet) {
      tenantSet = new Set();
      this.byTenant.set(principal.tenantId, tenantSet);
    }
    tenantSet.add(wrapper);

    // Socket index
    this.bySocket.set(ws, wrapper);

    // Principal counter
    const prev = this.byPrincipal.get(principal.sub) ?? 0;
    this.byPrincipal.set(principal.sub, prev + 1);

    return wrapper;
  }

  /**
   * Remove a socket from all indexes. Safe to call multiple times.
   */
  remove(ws: import('ws').WebSocket): void {
    const wrapper = this.bySocket.get(ws);
    if (!wrapper) return;

    // Socket index
    this.bySocket.delete(ws);

    // Tenant bucket
    const tenantSet = this.byTenant.get(wrapper.principal.tenantId);
    if (tenantSet) {
      tenantSet.delete(wrapper);
      if (tenantSet.size === 0) {
        this.byTenant.delete(wrapper.principal.tenantId);
      }
    }

    // Principal counter
    const count = this.byPrincipal.get(wrapper.principal.sub) ?? 1;
    if (count <= 1) {
      this.byPrincipal.delete(wrapper.principal.sub);
    } else {
      this.byPrincipal.set(wrapper.principal.sub, count - 1);
    }
  }

  /**
   * Returns all socket wrappers for a tenant channel.
   * Returns an empty set if no sockets are subscribed.
   */
  getTenantSockets(tenantId: string): ReadonlySet<SocketWrapper> {
    return this.byTenant.get(tenantId) ?? new Set();
  }

  /**
   * Returns all wrappers (for heartbeat sweep and drain).
   */
  allSockets(): IterableIterator<SocketWrapper> {
    return this.bySocket.values();
  }

  /**
   * Returns the wrapper for a socket, or undefined if not registered.
   */
  get(ws: import('ws').WebSocket): SocketWrapper | undefined {
    return this.bySocket.get(ws);
  }
}
