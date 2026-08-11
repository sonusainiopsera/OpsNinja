import { ConnectionRegistry, type SocketWrapper } from '../connection-registry';
import type { WsPrincipal } from '../../auth/jwt-verifier';
import type WebSocket from 'ws';

function makePrincipal(overrides: Partial<WsPrincipal> = {}): WsPrincipal {
  return {
    principalId: 'user-1',
    tenantId: 'tenant-1',
    roles: ['agent'],
    orgScopeIds: new Set(['org-1']),
    orgScopeVersion: 1,
    userType: 'staff',
    jti: 'jti-1',
    ...overrides,
  };
}

function makeSocket(): WebSocket {
  return { readyState: 1, close: jest.fn(), send: jest.fn() } as unknown as WebSocket;
}

describe('ConnectionRegistry', () => {
  let registry: ConnectionRegistry;

  beforeEach(() => {
    registry = new ConnectionRegistry();
  });

  it('starts empty', () => {
    expect(registry.totalConnections()).toBe(0);
    expect(registry.allWrappers()).toHaveLength(0);
  });

  it('adds a connection and returns the wrapper', () => {
    const wrapper = registry.add(makeSocket(), makePrincipal());
    expect(wrapper.id).toBeTruthy();
    expect(registry.totalConnections()).toBe(1);
  });

  it('retrieves connections by tenant', () => {
    registry.add(makeSocket(), makePrincipal({ tenantId: 'tenant-a' }));
    registry.add(makeSocket(), makePrincipal({ tenantId: 'tenant-b' }));

    expect(registry.getByTenant('tenant-a')).toHaveLength(1);
    expect(registry.getByTenant('tenant-b')).toHaveLength(1);
    expect(registry.getByTenant('tenant-c')).toHaveLength(0);
  });

  it('removes a connection and updates totals', () => {
    const wrapper = registry.add(makeSocket(), makePrincipal());
    registry.remove(wrapper);
    expect(registry.totalConnections()).toBe(0);
    expect(registry.getByTenant('tenant-1')).toHaveLength(0);
  });

  it('removes per-principal tracking on disconnect', () => {
    const p = makePrincipal({ principalId: 'user-1' });
    const w1 = registry.add(makeSocket(), p);
    registry.add(makeSocket(), p);

    expect(registry.connectionCountForPrincipal('user-1')).toBe(2);
    registry.remove(w1);
    expect(registry.connectionCountForPrincipal('user-1')).toBe(1);
  });

  it('clears tenant key when last socket for tenant is removed', () => {
    const wrapper = registry.add(makeSocket(), makePrincipal({ tenantId: 'tenant-z' }));
    registry.remove(wrapper);
    // getByTenant returns [] for unknown tenants and after last removal
    expect(registry.getByTenant('tenant-z')).toHaveLength(0);
  });

  it('tracks connections across multiple tenants', () => {
    for (let i = 0; i < 5; i++) {
      registry.add(makeSocket(), makePrincipal({ tenantId: 'tenant-a', principalId: `u${i}` }));
    }
    for (let i = 0; i < 3; i++) {
      registry.add(makeSocket(), makePrincipal({ tenantId: 'tenant-b', principalId: `v${i}` }));
    }
    expect(registry.totalConnections()).toBe(8);
    expect(registry.getByTenant('tenant-a')).toHaveLength(5);
    expect(registry.getByTenant('tenant-b')).toHaveLength(3);
  });

  it('1000-cycle connect/disconnect leaves registry empty', () => {
    const sockets: SocketWrapper[] = [];
    for (let i = 0; i < 1000; i++) {
      sockets.push(
        registry.add(
          makeSocket(),
          makePrincipal({ tenantId: `tenant-${i % 10}`, principalId: `user-${i}` }),
        ),
      );
    }
    expect(registry.totalConnections()).toBe(1000);

    for (const w of sockets) {
      registry.remove(w);
    }
    expect(registry.totalConnections()).toBe(0);
    expect(registry.allWrappers()).toHaveLength(0);
  });

  it('connectionCountForPrincipal returns 0 for unknown principal', () => {
    expect(registry.connectionCountForPrincipal('unknown')).toBe(0);
  });
});
