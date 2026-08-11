/**
 * Unit tests for heartbeat timeout, pong recording, and scope-version invalidation.
 * Uses fake timers and in-memory mocks.
 */

import { ConnectionRegistry } from '../connection-registry';
import { HeartbeatService } from '../heartbeat.service';
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

function makeSocket(readyState = 1): WebSocket {
  return {
    readyState,
    close: jest.fn(),
    send: jest.fn(),
    ping: jest.fn(),
  } as unknown as WebSocket;
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    HEARTBEAT_INTERVAL_MS: 30_000,
    SCOPE_REVALIDATE_MS: 60_000,
    ...overrides,
  };
  return { get: <T>(k: string, d?: T) => (defaults[k] as T) ?? d };
}

describe('HeartbeatService', () => {
  let registry: ConnectionRegistry;
  let mockRedis: { get: jest.Mock };

  beforeEach(() => {
    registry = new ConnectionRegistry();
    mockRedis = { get: jest.fn().mockResolvedValue(null) };
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function makeService(configOverrides: Record<string, unknown> = {}) {
    return new HeartbeatService(
      makeConfig(configOverrides) as any,
      registry,
      mockRedis as any,
    );
  }

  it('pings open sockets on interval', () => {
    const socket = makeSocket();
    const wrapper = registry.add(socket, makePrincipal());

    const svc = makeService({ HEARTBEAT_INTERVAL_MS: 1000 });
    svc.onModuleInit();

    jest.advanceTimersByTime(1_000);
    expect(socket.ping).toHaveBeenCalled();

    svc.onModuleDestroy();
  });

  it('closes socket with 1001 when pong is overdue', () => {
    const socket = makeSocket();
    const wrapper = registry.add(socket, makePrincipal());

    // Set lastPongAt far in the past
    wrapper.lastPongAt = Date.now() - 50_000;

    const svc = makeService({ HEARTBEAT_INTERVAL_MS: 1000 });
    svc.onModuleInit();

    jest.advanceTimersByTime(1_000);
    expect(socket.close).toHaveBeenCalledWith(1001, 'pong_timeout');

    svc.onModuleDestroy();
  });

  it('does not ping already-closed sockets', () => {
    const socket = makeSocket(3 /* CLOSED */);
    registry.add(socket, makePrincipal());

    const svc = makeService({ HEARTBEAT_INTERVAL_MS: 1000 });
    svc.onModuleInit();

    jest.advanceTimersByTime(1_000);
    expect(socket.ping).not.toHaveBeenCalled();
    expect(socket.close).not.toHaveBeenCalled();

    svc.onModuleDestroy();
  });

  it('recordPong updates lastPongAt', () => {
    const socket = makeSocket();
    const wrapper = registry.add(socket, makePrincipal({ tenantId: 'tenant-1' }));
    wrapper.lastPongAt = 0;

    const svc = makeService();
    svc.recordPong(wrapper.id, 'tenant-1');

    expect(wrapper.lastPongAt).toBeGreaterThan(0);
  });

  it('closes socket with 4440 when server scope_version is higher', async () => {
    const socket = makeSocket();
    const principal = makePrincipal({ orgScopeVersion: 1 });
    registry.add(socket, principal);

    mockRedis.get.mockResolvedValue('2'); // server version is 2, token is 1

    const svc = makeService({ SCOPE_REVALIDATE_MS: 1000 });
    svc.onModuleInit();

    jest.advanceTimersByTime(1_000);
    await Promise.resolve(); // flush async tick

    expect(socket.close).toHaveBeenCalledWith(4440, 'scope_version_invalidated');

    svc.onModuleDestroy();
  });

  it('does not close socket when scope_version matches', async () => {
    const socket = makeSocket();
    registry.add(socket, makePrincipal({ orgScopeVersion: 1 }));

    mockRedis.get.mockResolvedValue('1'); // matches

    const svc = makeService({ SCOPE_REVALIDATE_MS: 1000 });
    svc.onModuleInit();

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();

    expect(socket.close).not.toHaveBeenCalled();

    svc.onModuleDestroy();
  });
});
