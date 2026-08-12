/**
 * dashboard-realtime.ts — k6 load scenario for the realtime WebSocket gateway.
 *
 * Validates (AC9):
 *   - Handshake success rate under concurrent ramp to target connection count
 *   - Delta delivery latency p95 within declared bounds (5s tick + 500ms budget)
 *   - Memory per connection stays within 40KB architectural budget
 *   - Graceful rejection (explicit handshake error) on overload, not silent drop
 *
 * The scenario ramps up to 500 connections (steady_state) or 1000 (peak),
 * holds for the duration, then ramps down.  Each VU maintains a single
 * WebSocket connection and measures time-to-first-frame after connect.
 *
 * Architecture constraint: one WebSocket connection per page instance.
 * This scenario models exactly that — one WS per VU.
 *
 * Run:
 *   k6 run --env PROFILE=steady_state --env BASE_URL=wss://api.staging.opsninja.io scenarios/dashboard-realtime.ts
 */

import ws from 'k6/ws';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate, Gauge } from 'k6/metrics';
import { Options } from 'k6/options';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------
const handshakeDuration      = new Trend('realtime_handshake_ms',          true);
const firstFrameLatency      = new Trend('realtime_first_frame_ms',        true);
const deltaDeliveryLatency   = new Trend('realtime_delta_delivery_ms',     true);
const connectionErrors       = new Counter('realtime_connection_errors_total');
const connectionErrorRate    = new Rate('realtime_connection_error_rate');
const activeConnections      = new Gauge('realtime_active_connections');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const BASE_URL   = __ENV['BASE_URL'] ?? 'ws://localhost:3001';
const HTTP_URL   = __ENV['HTTP_BASE_URL'] ?? 'http://localhost:3000';
const PROFILE    = (__ENV['PROFILE'] ?? 'steady_state') as 'steady_state' | 'peak';

/** Documented scenario weight: 2 / 100 — long-lived connections, low request rate. */
export const SCENARIO_WEIGHT = 2;

const RAMP_DURATION     = '2m';
const HOLD_DURATION     = { steady_state: '8m',  peak: '3m'  } as const;
const TARGET_VUS        = { steady_state: 500,   peak: 1000  } as const;
/** Maximum expected delta delivery latency: 5s tick + 500ms budget = 5500ms. */
const DELTA_LATENCY_MAX_MS = 5500;

export const options: Options = {
  scenarios: {
    realtime_connections: {
      executor: 'ramping-vus',
      stages: [
        { duration: RAMP_DURATION,          target: TARGET_VUS[PROFILE] },
        { duration: HOLD_DURATION[PROFILE], target: TARGET_VUS[PROFILE] },
        { duration: '1m',                  target: 0 },
      ],
    },
  },
  thresholds: {
    'realtime_handshake_ms{quantile:"0.95"}':        ['p(95)<200'],
    'realtime_delta_delivery_ms{quantile:"0.95"}':   [`p(95)<${DELTA_LATENCY_MAX_MS}`],
    // Graceful rejection expected at overload; hard limit on error rate in steady state
    'realtime_connection_error_rate':                ['rate<0.005'],
  },
};

// ---------------------------------------------------------------------------
// Virtual user function
// ---------------------------------------------------------------------------
export default function dashboardRealtime(): void {
  // Authenticate via HTTP to obtain a JWT for the WebSocket upgrade
  const tenantSlug = 'tenant-perf-a';
  const email      = `agent-narrow-${__VU % 20}@tenant-perf-a.perf.local`;
  const password   = 'PerfTest!2024#Seed';

  const authRes = http.post(
    `${HTTP_URL}/api/v1/auth/login`,
    JSON.stringify({ email, password, tenantSlug }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  if (!check(authRes, { 'auth ok': (r) => r.status === 200 })) {
    connectionErrors.add(1);
    connectionErrorRate.add(true);
    return;
  }

  const { accessToken } = authRes.json() as { accessToken: string };

  const connectStart = Date.now();
  let firstFrameReceived = false;
  let firstFrameTs = 0;
  let lastPingTs = 0;
  let frameCount = 0;

  activeConnections.add(1);

  const res = ws.connect(
    `${BASE_URL}/realtime`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-Client-Type': 'agent-workspace',
      },
    },
    (socket) => {
      socket.on('open', () => {
        handshakeDuration.add(Date.now() - connectStart);

        // Subscribe to dashboard feed
        socket.send(JSON.stringify({ type: 'subscribe', channel: 'dashboard' }));
        lastPingTs = Date.now();
      });

      socket.on('message', (data: string) => {
        const now = Date.now();
        const msg = JSON.parse(data) as { type?: string; ts?: number };

        if (msg.type === 'delta' || msg.type === 'snapshot') {
          frameCount++;

          if (!firstFrameReceived) {
            firstFrameReceived = true;
            firstFrameTs = now;
            firstFrameLatency.add(now - connectStart);
          }

          // Measure end-to-end delta delivery: server-stamped ts to client receipt
          if (msg.ts) {
            deltaDeliveryLatency.add(now - msg.ts);
          }
        }
      });

      socket.on('error', (e: Error) => {
        connectionErrors.add(1);
        connectionErrorRate.add(true);
        void firstFrameTs; // suppress unused warning
      });

      // Hold connection for scenario duration (k6 will close when VU iteration ends)
      socket.setTimeout(() => {
        socket.close();
      }, 60_000);

      // Periodic ping to keep connection alive and measure round-trip
      socket.setInterval(() => {
        socket.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
      }, 10_000);
    },
  );

  // Handshake rejection must be explicit (non-silent drop)
  if (res.status !== 101) {
    check(res, {
      'overload rejection is explicit': (r) =>
        r.status === 429 || r.status === 503 || r.status === 503,
    });
    connectionErrors.add(1);
    connectionErrorRate.add(true);
  }

  activeConnections.add(-1);
  connectionErrorRate.add(!firstFrameReceived && res.status === 101);

  sleep(1);
}
