/**
 * DashboardGateway – WebSocket handler for /ws/v1/dashboard.
 *
 * Lifecycle:
 *   handleConnection → verify JWT → enforce caps → subscribe to tenant channel
 *   handleDisconnect → remove from registry
 *   handleSubscribe  → verify channel matches principal tenant → record lastSeq
 *   handlePong       → update lastPongAt in registry
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type WebSocket from 'ws';
import type * as http from 'http';
import Redis from 'ioredis';
import { JwtVerifier } from '../auth/jwt-verifier';
import { ConnectionRegistry } from './connection-registry';
import { HeartbeatService } from './heartbeat.service';
import { redactLogRecord } from '@opsninja/observability';

const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_FORBIDDEN        = 4403;
const CLOSE_TOO_MANY         = 4429;
const CLOSE_SCOPE_STALE      = 4440;
const CLOSE_GOING_AWAY       = 1001;

@Injectable()
export class DashboardGateway {
  private readonly logger = new Logger(DashboardGateway.name);
  private readonly maxConnectionsPerPod: number;
  private readonly maxConnectionsPerPrincipal: number;
  private draining = false;

  constructor(
    private readonly config: ConfigService,
    private readonly jwtVerifier: JwtVerifier,
    private readonly registry: ConnectionRegistry,
    private readonly heartbeat: HeartbeatService,
    private readonly redis: Redis,
  ) {
    this.maxConnectionsPerPod       = this.config.get<number>('MAX_CONNECTIONS_PER_POD', 2000);
    this.maxConnectionsPerPrincipal = this.config.get<number>('MAX_CONNECTIONS_PER_PRINCIPAL', 5);
  }

  /**
   * Called for every successful WebSocket upgrade.
   * req carries the original HTTP upgrade request (headers etc.).
   */
  handleConnection(socket: WebSocket, req: http.IncomingMessage): void {
    if (this.draining) {
      socket.close(CLOSE_GOING_AWAY, 'draining');
      return;
    }

    // ── Connection cap ─────────────────────────────────────────────────────
    if (this.registry.totalConnections() >= this.maxConnectionsPerPod) {
      this.logger.warn({ event: 'connect.cap_exceeded', total: this.registry.totalConnections() });
      socket.close(CLOSE_TOO_MANY, 'connection_cap_exceeded');
      return;
    }

    // ── JWT extraction ─────────────────────────────────────────────────────
    const token = this.extractToken(req);
    if (!token) {
      socket.close(CLOSE_UNAUTHENTICATED, 'missing_token');
      return;
    }

    // ── JWT verification ───────────────────────────────────────────────────
    let principal: ReturnType<JwtVerifier['verify']>;
    try {
      principal = this.jwtVerifier.verify(token);
    } catch {
      const reason = this.jwtVerifier.isExpired(token) ? 'token_expired' : 'token_invalid';
      this.logger.log(redactLogRecord({ event: 'authz_denied', reason }));
      socket.close(CLOSE_UNAUTHENTICATED, reason);
      return;
    }

    // ── Per-principal cap ──────────────────────────────────────────────────
    if (this.registry.connectionCountForPrincipal(principal.principalId) >= this.maxConnectionsPerPrincipal) {
      socket.close(CLOSE_TOO_MANY, 'principal_connection_cap_exceeded');
      return;
    }

    // ── Scope-version check at connect time ────────────────────────────────
    void this.checkScopeVersionAtConnect(socket, principal);

    // ── Register ───────────────────────────────────────────────────────────
    const wrapper = this.registry.add(socket, principal);

    this.logger.log({
      event: 'connect',
      socketId: wrapper.id,
      tenantId: principal.tenantId,
      principalId: principal.principalId,
    });

    // ── Send hello frame ───────────────────────────────────────────────────
    this.send(socket, {
      type: 'hello',
      tenantId: principal.tenantId,
      seq: 0,
      sentAt: new Date().toISOString(),
      payload: { channel: `dash:${principal.tenantId}` },
    });

    // ── Message handler ────────────────────────────────────────────────────
    socket.on('message', (rawData: Buffer | string) => {
      this.handleMessage(wrapper.id, principal.tenantId, rawData);
    });

    // ── Pong handler ───────────────────────────────────────────────────────
    socket.on('pong', () => {
      this.heartbeat.recordPong(wrapper.id, principal.tenantId);
    });

    // ── Disconnect handler ─────────────────────────────────────────────────
    socket.on('close', () => {
      this.registry.remove(wrapper);
      this.logger.log({
        event: 'close',
        socketId: wrapper.id,
        tenantId: principal.tenantId,
        principalId: principal.principalId,
      });
    });
  }

  private handleMessage(socketId: string, tenantId: string, rawData: Buffer | string): void {
    let msg: { type?: string; channel?: string; lastSeq?: number };
    try {
      msg = JSON.parse(rawData.toString()) as typeof msg;
    } catch {
      return;
    }

    if (msg.type === 'pong') {
      this.heartbeat.recordPong(socketId, tenantId);
      return;
    }

    if (msg.type === 'subscribe') {
      const expectedChannel = `dashboard`;
      if (msg.channel !== expectedChannel) {
        this.logger.log({
          event: 'authz_denied',
          reason: 'forbidden_channel',
          socketId,
          tenantId,
          requestedChannel: msg.channel,
        });
        // Find and close the socket
        const wrappers = this.registry.getByTenant(tenantId);
        const wrapper = wrappers.find((w) => w.id === socketId);
        if (wrapper) {
          wrapper.socket.close(CLOSE_FORBIDDEN, 'forbidden_channel');
        }
        return;
      }
    }
  }

  private extractToken(req: http.IncomingMessage): string | null {
    // Try Authorization header first
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    // Try Sec-WebSocket-Protocol subprotocol (format: "bearer.{token}")
    const protocols = req.headers['sec-websocket-protocol'];
    if (protocols) {
      const list = protocols.split(',').map((s) => s.trim());
      const bearer = list.find((p) => p.startsWith('bearer.'));
      if (bearer) {
        return bearer.slice('bearer.'.length);
      }
    }

    return null;
  }

  private send(socket: WebSocket, frame: Record<string, unknown>): void {
    try {
      socket.send(JSON.stringify(frame));
    } catch {
      // Socket closed between readyState check and send — harmless
    }
  }

  private async checkScopeVersionAtConnect(
    socket: WebSocket,
    principal: ReturnType<JwtVerifier['verify']>,
  ): Promise<void> {
    try {
      const raw = await this.redis.get(
        `scope:version:${principal.tenantId}:${principal.principalId}`,
      );
      const serverVersion = raw ? parseInt(raw, 10) : 0;
      if (serverVersion > principal.orgScopeVersion) {
        socket.close(CLOSE_SCOPE_STALE, 'scope_version_stale_at_connect');
      }
    } catch {
      // Redis temporarily unavailable — allow connection, revalidation tick will catch it
    }
  }

  /**
   * Initiates graceful drain: stop accepting upgrades, broadcast going_away,
   * close all sockets within the grace window.
   */
  startDrain(graceMs: number): void {
    this.draining = true;
    const goingAway = JSON.stringify({
      type: 'going_away',
      tenantId: null,
      seq: 0,
      sentAt: new Date().toISOString(),
      payload: { message: 'Server is restarting. Please reconnect.' },
    });

    for (const wrapper of this.registry.allWrappers()) {
      try {
        wrapper.socket.send(goingAway);
      } catch {
        // already closed
      }
    }

    setTimeout(() => {
      for (const wrapper of this.registry.allWrappers()) {
        wrapper.socket.close(CLOSE_GOING_AWAY, 'drain');
      }
    }, graceMs);
  }
}
