/**
 * DeltaPublisherService — WO-069
 *
 * Runs a 5-second interval loop over active tenants and publishes one compact,
 * sequenced frame per tenant per interval to the Redis pub/sub channel.
 *
 * Key invariants:
 *  - Only one pod publishes per tenant per interval (atomic claim key).
 *  - Unchanged tenants produce no frame (diff returns null).
 *  - Oversized delta payloads (> MAX_FRAME_BYTES) are converted to full
 *    snapshot frames so clients always receive a self-consistent state.
 *  - Reconciler-flagged tenants always emit a snapshot frame (drift correction).
 *  - All Redis operations use the publish-frame Lua script for atomicity.
 *
 * Metrics emitted as structured log entries consumed by the observability pipeline:
 *  - frames_published_total
 *  - frame_bytes
 *  - publish_interval_lag_ms
 *  - snapshot_required_total (when size guard triggers)
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import type Redis from 'ioredis';
import {
  Keys,
  FRAME_RETENTION,
  FRAME_TTL_SECONDS,
  CLAIM_TTL_SECONDS,
  MAX_FRAME_BYTES,
} from '../redis/keys';
import { AggregateStore } from '../redis/aggregate.store';
import { computeDiff, type AggregateSnapshot } from './aggregate-diff';

export const PUBLISH_INTERVAL_MS = parseInt(process.env['PUBLISH_INTERVAL_MS'] ?? '5000', 10);

interface WireFrame {
  type: 'delta' | 'snapshot';
  tenantId: string;
  seq: number;
  prevSeq: number;
  generatedAt: string;
  payload: unknown;
}

@Injectable()
export class DeltaPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeltaPublisherService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private publishScriptSha: string | null = null;

  constructor(
    private readonly redis: Redis,
    private readonly store: AggregateStore,
  ) {}

  async onModuleInit(): Promise<void> {
    const luaPath = join(__dirname, '..', 'redis', 'lua', 'publish-frame.lua');
    let script: string;
    try {
      script = readFileSync(luaPath, 'utf8');
    } catch {
      const altPath = join(__dirname, '..', '..', 'src', 'redis', 'lua', 'publish-frame.lua');
      script = readFileSync(altPath, 'utf8');
    }
    this.publishScriptSha = await this.redis.script('LOAD', script) as string;
    this.logger.log('publish-frame Lua script loaded', { sha: this.publishScriptSha });

    this.timer = setInterval(() => void this.tick(), PUBLISH_INTERVAL_MS);
    this.logger.log(`Delta publisher started — interval ${PUBLISH_INTERVAL_MS}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // --------------------------------------------------------------------------
  // Public (for testing / forced flush)
  // --------------------------------------------------------------------------

  /** Run one publish cycle immediately. Returns number of frames published. */
  async tick(): Promise<number> {
    const tickStart = Date.now();
    const bucket = Math.floor(tickStart / PUBLISH_INTERVAL_MS);

    let activeTenants: string[];
    try {
      activeTenants = await this.redis.smembers(Keys.activeTenants());
    } catch (err) {
      this.logger.error('Failed to read active tenants', { error: String(err) });
      return 0;
    }

    let published = 0;
    for (const tenantId of activeTenants) {
      try {
        const didPublish = await this.publishTenant(tenantId, bucket);
        if (didPublish) published++;
      } catch (err) {
        this.logger.warn('Publish failed for tenant — will retry next interval', {
          tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const lag = Date.now() - tickStart;
    if (lag > PUBLISH_INTERVAL_MS) {
      this.logger.warn('Publish tick exceeded interval', {
        metric: 'publish_interval_lag_ms',
        value: lag,
      });
    }

    return published;
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private async publishTenant(tenantId: string, bucket: number): Promise<boolean> {
    // ── 1. Atomic claim — only one pod publishes this bucket ──────────────
    const claimKey = Keys.claimInterval(tenantId, bucket);
    const claimed = await this.redis.set(claimKey, '1', 'NX', 'EX', CLAIM_TTL_SECONDS);
    if (claimed !== 'OK') {
      // Another pod already published this interval
      return false;
    }

    // ── 2. Check whether reconciler flagged this tenant ───────────────────
    const needsSnapshot = await this.redis.getdel(Keys.needsSnapshot(tenantId));
    const forceSnapshot = needsSnapshot !== null;

    // ── 3. Read current aggregate state ──────────────────────────────────
    const [kpis, category, breachRisk, feedRaw, meta] = await Promise.all([
      this.store.getKpi(tenantId),
      this.store.getCategoryBreakdown(tenantId),
      this.store.getBreachRisk(tenantId, 50),
      this.store.getFeed(tenantId),
      this.store.getMeta(tenantId),
    ]);

    const affectedAreaRaw = await this.redis.zrangebyscore(
      Keys.affectedArea(tenantId),
      '-inf', '+inf',
      'WITHSCORES',
    );
    const affectedArea: Array<{ area: string; count: number }> = [];
    for (let i = 0; i < affectedAreaRaw.length; i += 2) {
      affectedArea.push({
        area: affectedAreaRaw[i]!,
        count: parseInt(affectedAreaRaw[i + 1] ?? '0', 10),
      });
    }

    const curr: AggregateSnapshot = { kpis, category, affectedArea, breachRisk, feed: feedRaw };

    // ── 4. Read last published state ─────────────────────────────────────
    let prev: AggregateSnapshot | undefined;
    const publishedJson = await this.redis.get(Keys.published(tenantId));
    if (publishedJson) {
      try {
        prev = JSON.parse(publishedJson) as AggregateSnapshot;
      } catch {
        prev = undefined;
      }
    }

    // ── 5. Compute diff ───────────────────────────────────────────────────
    let framePayload = forceSnapshot
      ? { type: 'snapshot' as const, payload: curr }
      : computeDiff(prev, curr);

    if (!framePayload) {
      // Nothing changed
      return false;
    }

    // ── 6. Size guard: oversized delta → snapshot ─────────────────────────
    let payloadJson = JSON.stringify(framePayload.payload);
    if (payloadJson.length > MAX_FRAME_BYTES && framePayload.type === 'delta') {
      this.logger.warn('Delta payload exceeds size limit — converting to snapshot', {
        tenantId,
        deltaBytes: payloadJson.length,
        metric: 'snapshot_required_total',
      });
      framePayload = { type: 'snapshot', payload: curr };
      payloadJson = JSON.stringify(curr);
    }

    // ── 7. Read previous seq from meta ────────────────────────────────────
    const prevSeq = parseInt(meta['seq'] ?? '0', 10);

    // ── 8. Build the wire frame (seq is allocated by Lua) ─────────────────
    const generatedAt = new Date().toISOString();
    const frameTemplate: Omit<WireFrame, 'seq'> = {
      type:        framePayload.type,
      tenantId,
      prevSeq,
      generatedAt,
      payload:     framePayload.payload,
    };

    // Lua atomically increments seq and writes the frame
    const frameJson = JSON.stringify({ ...frameTemplate, seq: prevSeq + 1 });

    if (!this.publishScriptSha) {
      throw new Error('publish-frame Lua script not loaded');
    }

    const allocatedSeq = await this.redis.evalsha(
      this.publishScriptSha,
      4,
      Keys.meta(tenantId),
      Keys.published(tenantId),
      Keys.frames(tenantId),
      `dash:${tenantId}`,
      JSON.stringify(curr),                  // ARGV[1]: new published snapshot
      frameJson,                             // ARGV[2]: frame JSON
      String(FRAME_RETENTION),              // ARGV[3]: retention length
      String(FRAME_TTL_SECONDS),            // ARGV[4]: ring-buffer TTL
    ) as number;

    // Patch the frame with the Lua-allocated seq for accurate logging
    const finalFrame: WireFrame = { ...frameTemplate, seq: allocatedSeq };

    this.logger.log('Frame published', {
      metric: 'frames_published_total',
      tenantId,
      type: finalFrame.type,
      seq: allocatedSeq,
      prevSeq,
      bytes: frameJson.length,
    });

    this.logger.log('Frame bytes', {
      metric: 'frame_bytes',
      tenantId,
      bytes: frameJson.length,
    });

    return true;
  }
}
