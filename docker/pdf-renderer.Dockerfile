# pdf-renderer.Dockerfile — hardened Chromium PDF renderer image (WO-077)
#
# Security profile:
#   - Runs as non-root user (uid 1001) with read-only root filesystem.
#   - A writable tmpfs is mounted at /tmp at runtime for Chromium's scratch space.
#   - Chromium sandbox is ENABLED (not --no-sandbox) — the pod seccomp profile
#     supplies the required syscalls (clone3, unshare, etc.).
#   - Kubernetes NetworkPolicy (deploy/k8s/pdf-renderer-netpol.yaml) denies ALL
#     egress except the S3 VPC endpoint; Chromium cannot reach the internet.
#   - ECHARTS_BUNDLE_PATH baked in at /usr/share/opsninja/echarts.min.js so
#     the template loads the library from the local filesystem, never a CDN.
#
# Build:
#   docker build -f docker/pdf-renderer.Dockerfile -t opsninja/pdf-renderer:latest .
#   # SBOM:
#   docker sbom opsninja/pdf-renderer:latest --format spdx-json > sbom.pdf-renderer.json
#
# Runtime environment variables:
#   DATABASE_URL            — replica connection string
#   S3_EXPORT_BUCKET        — target bucket for rendered PDFs
#   S3_EXPORT_KMS_KEY_ID    — KMS key ARN for SSE-KMS
#   AWS_REGION              — AWS region (default us-east-1)
#   PDF_ROW_CAP             — per-request row limit (default 5000)
#   ECHARTS_BUNDLE_PATH     — overrides default /usr/share/opsninja/echarts.min.js
#   HEALTH_PORT             — liveness/readiness probe port (default 3003)
#   CONCURRENCY             — parallel SQS messages (default 1 — do not raise)

FROM mcr.microsoft.com/playwright/node:20-jammy AS base

# ── System dependencies ────────────────────────────────────────────────────
# Playwright image already ships Chromium and all required libs.
# We add extra fonts for multilingual report support.
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
        fonts-noto \
        fonts-noto-cjk \
        fonts-liberation \
        fonts-dejavu-core \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ── Application user (non-root) ────────────────────────────────────────────
RUN groupadd -g 1001 opsninja && \
    useradd -u 1001 -g opsninja -m -s /bin/bash opsninja

# ── Node application ────────────────────────────────────────────────────────
WORKDIR /app

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/ ./packages/

# Install production dependencies only.
RUN npm ci --workspace=apps/api --omit=dev --ignore-scripts

# Copy compiled worker source (built by CI before docker build).
COPY apps/api/dist/workers/export/ ./apps/api/dist/workers/export/
COPY apps/api/dist/modules/reporting/domain/ ./apps/api/dist/modules/reporting/domain/

# ── Bundle ECharts ─────────────────────────────────────────────────────────
# Copy the ECharts UMD bundle from the locally installed package so the
# renderer never fetches it from a CDN.  The path is baked into the image
# and referenced by ECHARTS_BUNDLE_PATH.
RUN mkdir -p /usr/share/opsninja && \
    cp /app/node_modules/echarts/dist/echarts.min.js \
       /usr/share/opsninja/echarts.min.js && \
    chmod 444 /usr/share/opsninja/echarts.min.js

# ── Chromium launch flags baked into the launch helper ────────────────────
# These flags are also enforced at runtime in pdf-render.worker.ts via
# the launchBrowser() factory function.  Listing them here for audit:
#
#   --disable-dev-shm-usage      — use /tmp instead of /dev/shm (read-only rootfs)
#   --disable-extensions         — block extension code execution
#   --disable-remote-fonts       — no remote font fetching
#   --no-default-browser-check   — suppress noisy stdout
#   --disable-background-networking — reduce network surface area
#   --disable-sync               — block Google account sync attempts
#   --no-first-run               — skip first-run wizard
#
# NOT passed: --no-sandbox (real sandbox enabled via seccomp + user ns)

ENV ECHARTS_BUNDLE_PATH=/usr/share/opsninja/echarts.min.js \
    HEALTH_PORT=3003 \
    CONCURRENCY=1 \
    NODE_ENV=production

# ── Set ownership and switch to non-root user ──────────────────────────────
RUN chown -R opsninja:opsninja /app
USER opsninja

# ── Health probe ──────────────────────────────────────────────────────────
# Liveness: GET /healthz → 200 OK  (Chromium connected)
# Readiness: GET /readyz  → 200 OK  (at least one render completed, queue draining)
EXPOSE 3003

# Tmpfs for Chromium scratch — mounted by the K8s PodSpec, NOT created here.
# Dockerfile cannot set VOLUME for tmpfs; see deploy/k8s/pdf-renderer.yaml.

CMD ["node", "apps/api/dist/workers/export/pdf-renderer.main.js"]

# ── Labels for SBOM and signing pipeline ──────────────────────────────────
LABEL org.opencontainers.image.title="opsninja-pdf-renderer" \
      org.opencontainers.image.description="Hardened headless Chromium PDF export renderer" \
      org.opencontainers.image.source="https://github.com/opsninja/opsninja" \
      org.opencontainers.image.licenses="UNLICENSED"
