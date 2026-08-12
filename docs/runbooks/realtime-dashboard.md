# Runbook: Realtime Dashboard Streaming Pipeline

**Owner:** Platform team  
**SLI definitions:** `packages/observability/slo/realtime.slo.yaml`  
**Alert rules:** `packages/observability/alerts/realtime.rules.yaml`  
**Related services:** `apps/realtime-gateway`, `apps/workers/dashboard-aggregator`

---

## Degradation Ladder

The streaming path degrades gracefully through three rungs. Each rung has a distinct signal.

| Rung | Condition | Client behaviour | Signal |
|------|-----------|-----------------|--------|
| 1 | Gateway unavailable | Agents fall back to snapshot polling | `RealtimeGatewayReadinessDegraded` |
| 2 | Redis unavailable | Counters read from Postgres; agents see a "data may be delayed" banner | `RealtimeSnapshotSourceDatabaseHigh`, readiness 503 |
| 3 | Bedrock/AI unavailable | Dashboards load but AI summaries show "Generating…" indefinitely | AI synthesis alert (separate runbook) |

Clients must never see a silent stall. If the pipeline is stalled, `RealtimeNoFramesPublished` fires within 60 seconds.

---

## Alert: `RealtimeNoFramesPublished`

**Severity:** critical  
**SLI:** `dashboard_freshness`  
**For-duration:** 1 minute

### Symptom
No `realtime_frames_delivered_total` increments for 60 seconds while `dashboard_events_consumed_total{outcome="applied"}` is increasing. Agents are consuming events but nothing is reaching connected browsers.

### Blast radius
All tenants that have had activity in the last 10 minutes see a frozen dashboard. SLA countdown timers stop advancing. On-call agents lose live ticket status visibility and fall back to full-page refreshes (polling).

### First checks
1. **Delta publisher health:**
   ```bash
   kubectl logs -l app=dashboard-aggregator --tail=100 | grep -E "ERROR|WARN|publish"
   ```
2. **Redis pub/sub connectivity from the aggregator pod:**
   ```bash
   kubectl exec -it deploy/dashboard-aggregator -- redis-cli -u $REDIS_URL ping
   ```
3. **Gateway relay:** confirm the gateway is subscribing to the correct Redis channel:
   ```bash
   kubectl logs -l app=realtime-gateway --tail=50 | grep -E "pubsub|subscribe|ERROR"
   ```
4. **Metrics scrape:** check `realtime_frames_delivered_total` rate in Grafana over the last 5 minutes. Zero rate with non-zero `dashboard_events_consumed_total` rate confirms the stall is between publisher and gateway, not on the inbound consumer side.

### Mitigation
1. If the aggregator pod is crash-looping, force a rolling restart:
   ```bash
   kubectl rollout restart deployment/dashboard-aggregator
   ```
2. If Redis pub/sub is broken (connectivity loss), restore Redis and verify the subscriber reconnects:
   ```bash
   # The subscriber uses ioredis with autoReconnect; check logs for "Reconnecting..."
   kubectl logs -l app=dashboard-aggregator | grep -i reconnect
   ```
3. If the gateway pod is not relaying frames despite the aggregator publishing, restart the gateway:
   ```bash
   kubectl rollout restart deployment/realtime-gateway
   ```

### Verification
After mitigation, confirm `realtime_frames_delivered_total` rate returns to > 0 in Grafana. The alert will auto-resolve once `increase(realtime_frames_delivered_total[1m]) > 0` for one evaluation cycle.

### Escalation
If not resolved within 5 minutes, escalate to the platform on-call lead. Check whether the Redis instance itself is unavailable (triggers rung 2 degradation).

---

## Alert: `RealtimeAggregateDriftHigh`

**Severity:** warning  
**SLI:** `aggregate_correctness`  
**For-duration:** 2 minutes (2+ reconcile cycles)

### Symptom
`max(dashboard_aggregate_drift)` exceeds 50 for at least two consecutive 60-second reconcile cycles. Open-ticket counts or SLA breach counts in the agent dashboard differ from the authoritative Postgres values.

### Blast radius
All agents see incorrect KPI counters (open ticket counts, SLA breach counts, priority breakdowns). The error is bounded to the drift magnitude — it is not a data loss event. The reconciler corrects drift automatically on the next cycle under normal conditions.

### First checks
1. **Reconciler logs for errors:**
   ```bash
   kubectl logs -l app=dashboard-aggregator --tail=200 | grep -E "Reconcile|drift|ERROR"
   ```
2. **Postgres connectivity from the aggregator:**
   ```bash
   kubectl exec -it deploy/dashboard-aggregator -- psql "$DATABASE_URL" -c "SELECT 1"
   ```
3. **Which tenants are drifting:** query the metric directly:
   ```
   max by(counter, tenant_bucket) (dashboard_aggregate_drift) > 0
   ```
4. **Verify Redis aggregate values against Postgres** (see "Manual reconciliation" below).

### Manual reconciliation (force a single authoritative cycle)
The reconciler exposes a `POST /internal/reconcile` endpoint on the internal admin port. To force an immediate reconciliation for all tenants:
```bash
kubectl port-forward deploy/dashboard-aggregator 8090:8090
curl -X POST http://localhost:8090/internal/reconcile
```
Verify by checking `dashboard_aggregate_drift` drops to 0 after the next metrics scrape.

### Verify Redis aggregates against Postgres
For tenant `<tenantId>`, the open-ticket count should match between Redis and Postgres:
```bash
# Redis value
redis-cli -u $REDIS_URL GET "agg:<tenantId>:open_total"

# Postgres value
psql "$DATABASE_URL" -c "
  SELECT count(*) FROM tickets
  WHERE tenant_id = '<tenantId>'
    AND status IN ('open','new','pending_customer','pending_engineering')
"
```
If they diverge by more than the drift threshold, the reconciler is not correcting drift. Investigate `STATEMENT_TIMEOUT` and Postgres query errors in the reconciler logs.

### Mitigation
1. If drift corrects itself within two reconcile cycles (2 minutes), no action is needed — the alert auto-resolves.
2. If drift persists, force manual reconciliation (see above).
3. If reconciliation fails due to Postgres unavailability, resolve the database issue first.

### Escalation
Persistent drift beyond 10 minutes that does not respond to manual reconciliation should be escalated to the platform on-call lead.

---

## Alert: `RealtimeSnapshotSourceDatabaseHigh`

**Severity:** warning  
**SLI:** `stream_availability`  
**For-duration:** 5 minutes

### Symptom
More than 5% of dashboard snapshots over the last 5 minutes are being served from Postgres rather than the Redis cache. `rate(dashboard_snapshot_source_total{source="database"}[5m])` / total snapshot rate > 0.05.

### Blast radius
Agents are receiving correct data but with higher latency (Postgres read path instead of Redis). The primary database bears additional read load. This is functionally degraded but not an outage.

### First checks
1. **Redis connectivity:**
   ```bash
   redis-cli -u $REDIS_URL ping
   ```
2. **Cache TTL:** confirm aggregate keys exist and have a TTL set:
   ```bash
   redis-cli -u $REDIS_URL TTL "agg:<tenantId>:open_total"
   ```
   A TTL of -2 means the key doesn't exist; -1 means no expiry set (possible misconfiguration).
3. **Reconciler writing to Redis:** check reconciler logs for Redis write errors:
   ```bash
   kubectl logs -l app=dashboard-aggregator | grep -E "Redis|cache|ERROR" | tail -50
   ```
4. **Redis memory pressure:** check `redis_memory_used_bytes` — if Redis is evicting keys under memory pressure, the cache hit rate will drop.

### Mitigation
1. If Redis is unreachable, restore the Redis connection. The aggregator will automatically fall back to writing aggregates once reconnected.
2. If Redis is evicting keys, increase the `maxmemory` limit or the instance size.
3. If the reconciler is not writing to Redis (check logs), restart the aggregator pod.

### Clients confirm polling fallback
The degradation banner on the agent UI is driven by `realtime_snapshot_required_total{reason="first_frame"}` increasing relative to `realtime_connections_active`. If this ratio is elevated, agents are already seeing the banner.

### Escalation
If the snapshot database ratio does not resolve within 15 minutes of restoring Redis, escalate to the platform on-call lead.

---

## Alert: `RealtimeDlqNonEmpty`

**Severity:** warning  
**SLI:** `aggregate_correctness`  
**For-duration:** 2 minutes

### Symptom
`dashboard_dlq_depth > 0` for 2 minutes. One or more events that the dashboard aggregator could not process are sitting in the dead-letter queue.

### Blast radius
Tenants whose events are in the DLQ have stale aggregate counters. The DLQ will not grow unboundedly by default (SQS maxReceiveCount defaults to 3), but the events will not be retried until manually redriven.

### First checks
1. **DLQ message count and attributes:**
   ```bash
   aws sqs get-queue-attributes \
     --queue-url "$DASHBOARD_AGGREGATES_DLQ_URL" \
     --attribute-names ApproximateNumberOfMessages
   ```
2. **Inspect the DLQ message(s):**
   ```bash
   aws sqs receive-message \
     --queue-url "$DASHBOARD_AGGREGATES_DLQ_URL" \
     --max-number-of-messages 1 \
     --attribute-names All
   ```
   Check `ApproximateFirstReceiveTimestamp` and the message body for the failing event type and tenant.
3. **Aggregator error logs around the time of the first DLQ message:**
   ```bash
   kubectl logs -l app=dashboard-aggregator --since=1h | grep -E "ERROR|WARN|fatal"
   ```

### Mitigation
1. **Determine root cause** before redriving — redriving a poison-pill event will loop it back to the DLQ.
2. If the failure was transient (e.g. Redis connectivity blip), redrive the DLQ:
   ```bash
   aws sqs start-message-move-task \
     --source-arn "$DASHBOARD_AGGREGATES_DLQ_ARN" \
     --destination-arn "$DASHBOARD_AGGREGATES_QUEUE_ARN"
   ```
3. If the message is a poison pill (malformed event), purge it and create a correction event manually if KPI drift warrants it.

### Verification
After redriving, confirm `dashboard_dlq_depth` returns to 0. Watch for the event immediately landing back in the DLQ (confirm root cause was transient).

### Escalation
If the DLQ grows (new messages arriving while existing ones are being investigated), escalate to the platform on-call lead and consider pausing the source consumer temporarily.

---

## Alert: `RealtimeGatewayReadinessDegraded`

**Severity:** critical  
**SLI:** `stream_availability`  
**For-duration:** 1 minute

### Symptom
More than one-third of `realtime-gateway` pods are failing their `/readyz` probe (`kube_pod_status_ready{condition="false"} / total > 0.33`). Traffic is load-balanced to a shrinking pool of healthy pods.

### Blast radius
New WebSocket connections may fail or be routed to an overloaded healthy pod subset. Existing connections on unhealthy pods may be dropped. If all pods fail readiness, all new connections fail and agents fall back to polling.

### First checks
1. **Which pods are failing readiness:**
   ```bash
   kubectl get pods -l app=realtime-gateway -o wide
   ```
2. **Readiness probe response on a failing pod:**
   ```bash
   kubectl exec -it <failing-pod> -- curl -s http://localhost:8081/readyz
   ```
   The response body names the failing dependency (e.g. `Dependencies unhealthy: redis: Redis unreachable`).
3. **Redis connectivity:** a Redis outage is the most common cause since the gateway only checks Redis for readiness.
4. **Pod logs:**
   ```bash
   kubectl logs <failing-pod> --previous | tail -50
   ```

### Confirm clients have fallen back to polling
When the gateway is degraded, agents fall back to polling the REST API for dashboard data. This is visible as:
- `realtime_snapshot_required_total{reason="reconnect"}` increasing
- Browser network tab showing repeated `GET /api/v1/dashboard/snapshot` requests
- The agent UI banner: "Live updates unavailable — refreshing every 30s"

### Mitigation
1. **If Redis is unavailable:** restore Redis. The gateway readiness indicator uses a 5-second hysteresis so readiness will flip back within 5 seconds of Redis recovering.
2. **If pods are crash-looping:** force a rolling restart:
   ```bash
   kubectl rollout restart deployment/realtime-gateway
   ```
3. **If one pod is stuck:** delete and let Kubernetes recreate it:
   ```bash
   kubectl delete pod <failing-pod>
   ```

### Verification
After mitigation, confirm:
1. `kubectl get pods -l app=realtime-gateway` shows all pods `Running 1/1`.
2. `/readyz` on all pods returns `{"status":"ok","dependencies":{"redis":{"healthy":true}}}`.
3. `realtime_snapshot_required_total{reason="reconnect"}` rate decreases.
4. The agent UI banner disappears.

### Escalation
If more than two-thirds of pods fail simultaneously and Redis is healthy, escalate to the platform on-call lead. This may indicate a configuration rollout issue or a version incompatibility.

---

## Forcing an authoritative reconciliation

When aggregate drift is suspected but not yet alerting, or after a Redis flush event:

```bash
# 1. Port-forward to the aggregator's internal admin port
kubectl port-forward deploy/dashboard-aggregator 8090:8090

# 2. Trigger full reconciliation for all tenants
curl -X POST http://localhost:8090/internal/reconcile

# 3. Watch the drift metric drop to zero
watch -n 5 'redis-cli -u $REDIS_URL info keyspace'
```

Reconciliation runs per-tenant with a 5-second statement timeout. Each tenant takes ~100ms under normal load. With 200 tenants, a full cycle completes in ~20 seconds.

---

## Verifying a tenant's Redis aggregates against Postgres

For deep investigation, the following pattern can be run against any tenant:

```bash
TENANT="<tenantId>"

# Redis open-ticket total
REDIS_OPEN=$(redis-cli -u $REDIS_URL GET "agg:${TENANT}:open_total")
echo "Redis open: $REDIS_OPEN"

# Postgres open-ticket total
PG_OPEN=$(psql "$DATABASE_URL" -tAc "
  SET app.current_tenant = '${TENANT}';
  SELECT count(*) FROM tickets
  WHERE tenant_id = '${TENANT}'
    AND status IN ('open','new','pending_customer','pending_engineering')
")
echo "Postgres open: $PG_OPEN"

if [ "$REDIS_OPEN" != "$PG_OPEN" ]; then
  echo "DRIFT DETECTED: Redis=$REDIS_OPEN PG=$PG_OPEN diff=$(( PG_OPEN - REDIS_OPEN ))"
fi
```

---

## Distributed trace correlation

Every outbox event carries a `traceId` propagated through SQS message attributes into the aggregator span, publish span and the delivered WebSocket frame. To trace an event end-to-end:

1. Find the `traceId` from a browser-reported stale frame (available in the frame payload `meta.traceId`).
2. Search Jaeger / X-Ray: `traceId = "<traceId>"`.
3. The trace spans: `outbox.publish` → `sqs.receive` → `aggregator.apply` → `publisher.publish` → `gateway.deliver`.

---

## Error budget and SLO context

| SLI | Target | 30-day budget |
|-----|--------|--------------|
| Dashboard freshness (p95 frame age < 10s) | 99.0% | 7.2 h |
| Stream availability (sessions in live state > 99%) | 99.0% | 7.2 h |
| Aggregate correctness (drift-free cycles > 99.9%) | 99.9% | 43.2 min |

An on-call event that lasts 30 minutes and affects all agents burns ~7% of the 30-day availability budget. Treat any `critical` alert as an immediate error-budget event.
