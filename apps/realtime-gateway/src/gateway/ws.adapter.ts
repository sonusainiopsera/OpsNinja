/**
 * WsAdapter – custom NestJS WebSocketAdapter over the ws library.
 *
 * Replaces the default socket.io adapter so:
 *   - Frames are raw JSON text (no socket.io envelope overhead).
 *   - Per-connection memory stays near 40KB.
 *   - Upgrade handling and max-payload limits are controlled explicitly.
 *   - The only valid upgrade path is /ws/v1/dashboard.
 *
 * Authentication, registry management and heartbeat are handled outside this
 * adapter in DashboardGateway via the standard NestJS WebSocket lifecycle hooks.
 */

import { WebSocketAdapter, INestApplicationContext } from '@nestjs/common';
import type { MessageMappingProperties } from '@nestjs/websockets';
import type { Observable } from 'rxjs';
import { WebSocketServer } from 'ws';
import type * as http from 'http';

const ALLOWED_PATH = '/ws/v1/dashboard';
const MAX_PAYLOAD_BYTES = 64 * 1024; // 64 KB

export class WsAdapter implements WebSocketAdapter {
  private wss: WebSocketServer | null = null;

  constructor(private readonly app: INestApplicationContext) {}

  create(_port: number, options: Record<string, unknown> = {}): WebSocketServer {
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_PAYLOAD_BYTES,
      ...options,
    });
    return this.wss;
  }

  bindClientConnect(server: WebSocketServer, callback: (...args: unknown[]) => void): void {
    server.on('connection', callback);
  }

  bindClientDisconnect(client: unknown, callback: (...args: unknown[]) => void): void {
    (client as { on(ev: string, fn: (...a: unknown[]) => void): void }).on('close', callback);
  }

  bindMessageHandlers(
    client: unknown,
    handlers: MessageMappingProperties[],
    transform: (data: unknown) => Observable<unknown>,
  ): void {
    (client as { on(ev: string, fn: (data: Buffer | string) => void): void }).on(
      'message',
      (rawData: Buffer | string) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawData.toString());
        } catch {
          return;
        }

        const message = parsed as { type?: string };
        const handler = handlers.find((h) => h.message === message.type);
        if (!handler) return;

        const result$ = transform(handler.callback(client, message));
        if (result$) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (result$ as any).subscribe({
            next: (response: unknown) => {
              if (response) {
                (client as { send(d: string): void }).send(JSON.stringify(response));
              }
            },
          });
        }
      },
    );
  }

  close(server: WebSocketServer): void {
    server.close();
  }

  /**
   * Called from main.ts to wire the upgrade event on the HTTP server so only
   * /ws/v1/dashboard upgrades are handled; all others get 404.
   */
  bindUpgradeHandler(
    httpServer: http.Server,
    onUpgradeRejected: (req: http.IncomingMessage, socket: NodeJS.Socket) => void,
  ): void {
    if (!this.wss) return;
    const wss = this.wss;

    httpServer.on('upgrade', (req, socket, head) => {
      const url = req.url ?? '';
      const path = url.split('?')[0];

      if (path !== ALLOWED_PATH) {
        onUpgradeRejected(req, socket as NodeJS.Socket);
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket as NodeJS.Socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });
  }
}
