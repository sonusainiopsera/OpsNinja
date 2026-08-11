/**
 * Unit tests for ConnectionRegistry (WO-066 AC #6, #9, #10).
 *
 * Uses a fake WebSocket object — no network required.
 */

import { ConnectionRegistry } from './connection-registry';
import type { SocketPrincipal } from './frame.types';
import { TENANT_A_ID, TENANT_B_ID, AGENT_A_ID, MANAGER_B_ID } from '../../test/fixtures/jwt.fixtures';

// Minimal fake WebSocket substitute.
function fakeWs(): import('ws').WebSocket {
  return {} as import('ws').WebSocket;
}

function makePrincipal(overrides: Partial<SocketPrincipal> = {}): SocketPrincipal {
  return {
    sub: AGENT_A_ID,
    tenantId: TENANT_A_ID,
    roles: ['agent'],
    orgScopeVersion: 1,
    orgScopeIds: new Set(),
    userType: 'staff',
    ...overrides,
  };
}

describe('ConnectionRegistry', () => {
  let registry: ConnectionRegistry;

  beforeEach(() => {
    registry = new ConnectionRegistry();
  });

  describe('add', () => {
    it('increments totalConnections', () => {
      registry.add(fakeWs(), makePrincipal());
      expect(registry.totalConnections).toBe(1);
    });

    it('creates a tenant bucket on first add', () => {
      registry.add(fakeWs(), makePrincipal({ tenantId: TENANT_A_ID }));
      expect(registry.getTenantSockets(TENANT_A_ID).size).toBe(1);
    });

    it('adds multiple sockets to the same tenant bucket', () => {
      registry.add(fakeWs(), makePrincipal({ tenantId: TENANT_A_ID }));
      registry.add(fakeWs(), makePrincipal({ tenantId: TENANT_A_ID }));
      expect(registry.getTenantSockets(TENANT_A_ID).size).toBe(2);
    });

    it('keeps tenant buckets isolated', () => {
      registry.add(fakeWs(), makePrincipal({ tenantId: TENANT_A_ID }));
      registry.add(fakeWs(), makePrincipal({ tenantId: TENANT_B_ID, sub: MANAGER_B_ID }));
      expect(registry.getTenantSockets(TENANT_A_ID).size).toBe(1);
      expect(registry.getTenantSockets(TENANT_B_ID).size).toBe(1);
    });

    it('tracks per-principal connection count', () => {
      registry.add(fakeWs(), makePrincipal({ sub: AGENT_A_ID }));
      registry.add(fakeWs(), makePrincipal({ sub: AGENT_A_ID }));
      expect(registry.principalConnectionCount(AGENT_A_ID)).toBe(2);
    });

    it('returns a wrapper with subscribed=false', () => {
      const ws = fakeWs();
      const wrapper = registry.add(ws, makePrincipal());
      expect(wrapper.subscribed).toBe(false);
    });
  });

  describe('remove', () => {
    it('decrements totalConnections', () => {
      const ws = fakeWs();
      registry.add(ws, makePrincipal());
      registry.remove(ws);
      expect(registry.totalConnections).toBe(0);
    });

    it('removes socket from tenant bucket', () => {
      const ws = fakeWs();
      registry.add(ws, makePrincipal({ tenantId: TENANT_A_ID }));
      registry.remove(ws);
      expect(registry.getTenantSockets(TENANT_A_ID).size).toBe(0);
    });

    it('cleans up empty tenant bucket', () => {
      const ws = fakeWs();
      registry.add(ws, makePrincipal({ tenantId: TENANT_A_ID }));
      registry.remove(ws);
      // Should return empty set, not throw
      expect(registry.getTenantSockets(TENANT_A_ID).size).toBe(0);
    });

    it('decrements per-principal count', () => {
      const ws1 = fakeWs();
      const ws2 = fakeWs();
      registry.add(ws1, makePrincipal({ sub: AGENT_A_ID }));
      registry.add(ws2, makePrincipal({ sub: AGENT_A_ID }));
      registry.remove(ws1);
      expect(registry.principalConnectionCount(AGENT_A_ID)).toBe(1);
    });

    it('is safe to call multiple times on the same socket', () => {
      const ws = fakeWs();
      registry.add(ws, makePrincipal());
      registry.remove(ws);
      expect(() => registry.remove(ws)).not.toThrow();
      expect(registry.totalConnections).toBe(0);
    });

    it('does not affect other sockets in the same tenant bucket', () => {
      const ws1 = fakeWs();
      const ws2 = fakeWs();
      registry.add(ws1, makePrincipal({ tenantId: TENANT_A_ID }));
      registry.add(ws2, makePrincipal({ tenantId: TENANT_A_ID }));
      registry.remove(ws1);
      expect(registry.getTenantSockets(TENANT_A_ID).size).toBe(1);
    });
  });

  describe('1000-cycle soak test', () => {
    it('registry returns to zero after 1000 add/remove cycles', () => {
      for (let i = 0; i < 1_000; i++) {
        const ws = fakeWs();
        registry.add(ws, makePrincipal({ sub: `principal-${i}` }));
        registry.remove(ws);
      }
      expect(registry.totalConnections).toBe(0);
      expect(registry.getTenantSockets(TENANT_A_ID).size).toBe(0);
    });
  });

  describe('get', () => {
    it('returns the wrapper for a registered socket', () => {
      const ws = fakeWs();
      const wrapper = registry.add(ws, makePrincipal());
      expect(registry.get(ws)).toBe(wrapper);
    });

    it('returns undefined for an unregistered socket', () => {
      expect(registry.get(fakeWs())).toBeUndefined();
    });
  });

  describe('allSockets', () => {
    it('iterates over all registered sockets', () => {
      registry.add(fakeWs(), makePrincipal({ sub: 'p1' }));
      registry.add(fakeWs(), makePrincipal({ sub: 'p2', tenantId: TENANT_B_ID }));
      const all = [...registry.allSockets()];
      expect(all).toHaveLength(2);
    });
  });
});
