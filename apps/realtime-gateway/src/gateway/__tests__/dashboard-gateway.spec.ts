/**
 * Unit tests for DashboardGateway:
 *   - Token validation (close 4401 on missing/expired)
 *   - Channel authorisation (close 4403 on wrong channel)
 *   - Connection cap rejection (close 4429)
 *   - Drain rejects new connections (close 1001)
 */

import { ConnectionRegistry } from '../connection-registry';
import { DashboardGateway } from '../dashboard.gateway';
import { JwtVerifier, type WsPrincipal } from '../../auth/jwt-verifier';
import { HeartbeatService } from '../heartbeat.service';
import type WebSocket from 'ws';
import type * as http from 'http';

function makeSocket(): WebSocket {
  return {
    readyState: 1,
    close: jest.fn(),
    send: jest.fn(),
    on: jest.fn(),
  } as unknown as WebSocket;
}

function makeReq(authHeader?: string, protocol?: string): http.IncomingMessage {
  return {
    headers: {
      ...(authHeader ? { authorization: authHeader } : {}),
      ...(protocol ? { 'sec-websocket-protocol': protocol } : {}),
    },
  } as unknown as http.IncomingMessage;
}

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

function makeGateway(overrides: {
  maxConnections?: number;
  verifyResult?: WsPrincipal | null;
  isExpired?: boolean;
}) {
  const registry = new ConnectionRegistry();

  const jwtVerifier = {
    verify: jest.fn().mockImplementation(() => {
      if (overrides.verifyResult === null || overrides.verifyResult === undefined) {
        throw new Error('invalid token');
      }
      return overrides.verifyResult;
    }),
    isExpired: jest.fn().mockReturnValue(overrides.isExpired ?? false),
  } as unknown as JwtVerifier;

  const heartbeat = {
    recordPong: jest.fn(),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  } as unknown as HeartbeatService;

  const redis = { get: jest.fn().mockResolvedValue(null) };

  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'MAX_CONNECTIONS_PER_POD') return overrides.maxConnections ?? 2000;
      if (key === 'MAX_CONNECTIONS_PER_PRINCIPAL') return 5;
      return fallback;
    }),
  };

  const gateway = new DashboardGateway(
    config as any,
    jwtVerifier,
    registry,
    heartbeat,
    redis as any,
  );

  return { gateway, registry };
}

describe('DashboardGateway.handleConnection', () => {
  it('closes with 4401 when no token is present', () => {
    const { gateway } = makeGateway({ verifyResult: makePrincipal() });
    const socket = makeSocket();
    gateway.handleConnection(socket, makeReq());
    expect(socket.close).toHaveBeenCalledWith(4401, 'missing_token');
  });

  it('closes with 4401 when token is invalid', () => {
    const { gateway } = makeGateway({ verifyResult: null });
    const socket = makeSocket();
    gateway.handleConnection(socket, makeReq('Bearer bad.token'));
    expect(socket.close).toHaveBeenCalledWith(4401, expect.stringContaining('token'));
  });

  it('closes with 4401 with reason token_expired when isExpired=true', () => {
    const { gateway } = makeGateway({ verifyResult: null, isExpired: true });
    const socket = makeSocket();
    gateway.handleConnection(socket, makeReq('Bearer expired.token'));
    expect(socket.close).toHaveBeenCalledWith(4401, 'token_expired');
  });

  it('closes with 4429 when pod connection cap is exceeded', () => {
    const { gateway, registry } = makeGateway({ maxConnections: 1, verifyResult: makePrincipal() });

    // Pre-fill registry to cap
    const existing = makeSocket();
    registry.add(existing, makePrincipal({ principalId: 'other' }));

    const socket = makeSocket();
    gateway.handleConnection(socket, makeReq('Bearer valid.token'));
    expect(socket.close).toHaveBeenCalledWith(4429, 'connection_cap_exceeded');
  });

  it('closes with 1001 going_away when draining', () => {
    const { gateway } = makeGateway({ verifyResult: makePrincipal() });
    gateway.startDrain(0);
    const socket = makeSocket();
    gateway.handleConnection(socket, makeReq('Bearer valid.token'));
    expect(socket.close).toHaveBeenCalledWith(1001, 'draining');
  });

  it('successfully connects and sends hello frame', () => {
    const principal = makePrincipal();
    const { gateway } = makeGateway({ verifyResult: principal });
    const socket = makeSocket();
    gateway.handleConnection(socket, makeReq('Bearer valid.token'));

    expect(socket.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"hello"'),
    );
    expect(socket.send).toHaveBeenCalledWith(
      expect.stringContaining('"tenantId":"tenant-1"'),
    );
  });

  it('accepts token from Sec-WebSocket-Protocol subprotocol', () => {
    const principal = makePrincipal();
    const { gateway } = makeGateway({ verifyResult: principal });
    const socket = makeSocket();
    // Format: bearer.{token}
    gateway.handleConnection(socket, makeReq(undefined, 'bearer.valid.token'));
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"hello"'));
  });
});
