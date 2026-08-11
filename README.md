# OpsNinja

Multi-tenant ITSM platform. NestJS + TypeScript strict mode monorepo.

## Monorepo Structure

```
apps/
  api/          — Core NestJS API (versioned /api/v1)
packages/
  shared/       — Framework-agnostic utilities: env schema, cursor pagination, base errors
```

## Quick Start

```bash
pnpm install
cp .env.example .env   # Fill in required env vars
make dev
```

## Environment Variables

| Variable       | Required | Description                                        |
|----------------|----------|----------------------------------------------------|
| `DATABASE_URL` | ✅        | PostgreSQL connection string                       |
| `REDIS_URL`    | ✅        | Redis connection string                            |
| `OIDC_ISSUER`  | ✅        | OIDC provider base URL for JWT validation          |
| `HMAC_SECRET`  | ✅        | ≥32-char secret for cursor HMAC signing            |
| `LOG_LEVEL`    | —         | `trace/debug/info/warn/error/fatal` (default: info)|
| `NODE_ENV`     | —         | `development/test/production` (default: development)|
| `PORT`         | —         | HTTP port (default: 3000)                          |
| `BUILD_SHA`    | —         | Git SHA injected at build time (default: local)    |

Missing or empty required variables abort startup with a descriptive error listing every offending key.

## API Conventions

All endpoints are under `/api/v1`.

### Error Envelope (frozen — all failures use this shape)
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "ticket 'TKT-001' not found",
    "details": [],
    "traceId": "uuid-v4"
  }
}
```

### List Envelope
```json
{
  "items": [...],
  "next_cursor": "base64url.hmac" 
}
```

### Health Endpoints

| Route             | Auth | Purpose                               |
|-------------------|------|---------------------------------------|
| `GET /api/v1/healthz` | None | Liveness — always 200               |
| `GET /api/v1/readyz`  | None | Readiness — 200/503 with dep map    |
| `GET /api/v1/openapi.json` | None | OpenAPI 3.1 document         |

## Development Commands

```bash
make build         # tsc compile all packages
make lint          # eslint (fails on any)
make test          # vitest run all suites
make test-cov      # with coverage (≥90% on critical files)
make typecheck     # tsc --noEmit strict check
make generate-openapi   # regenerate openapi-snapshot.json
make check-openapi      # CI diff check
```

## Module Boundaries

Cross-module database access is mechanically prevented by `eslint-plugin-boundaries`.

Domain modules under `apps/api/src/modules/` **must not** import `.repository.ts`,
`.schema.ts`, or `.entity.ts` files from any other domain module. This rule
mirrors the architectural decision that each module owns its own data layer.

Current domain modules (empty seams, domain logic added in subsequent work orders):

- `identity` — User identity and principal resolution
- `organizations` — Tenant organisations and custom fields
- `tickets` — Ticket management and transactional outbox
- `sla` — SLA policies and timers
- `views` — Saved views and filter compilation
- `reporting` — Analytics, report builder, exports
- `integrations` — Jira sync, webhook ingestion

## Logging

Structured JSON via `nestjs-pino`. Every request emits one line with:
`traceId`, `method`, `route`, `status`, `duration_ms`, `tenant_id`, `principal_id`.

PII redaction: email addresses, IPv4 addresses, and phone numbers are stripped
from all log values before writing. Blocked fields (`password`, `authorization`,
`cookie`, etc.) are replaced with `[REDACTED]`.
Multi-tenant SaaS support and incident management platform for platform engineering organisations.

## Architecture

- **API**: NestJS 10 / TypeScript 5 / Node 22 (`apps/api`)
- **DB**: PostgreSQL 16 with Row-Level Security + Drizzle ORM (`packages/db`)
- **Cache / Pub-Sub**: ElastiCache Redis 7
- **Queue**: SQS (standard + FIFO)

## Project Structure

```
apps/
  api/          NestJS REST API + Jira Webhook Receiver
packages/
  db/           Drizzle schema, migrations, connection pool
```

## Getting Started

```bash
npm install
# Configure environment
cp apps/api/.env.example apps/api/.env
# Start API in dev mode
npm run start:dev -w apps/api
```

## Multi-Tenancy

Tenant isolation is enforced at the PostgreSQL layer via Row-Level Security policies.
Every request runs inside a transaction where `app.current_tenant` is set via
`set_config()` before any handler executes. See `apps/api/src/data/unit-of-work.ts`.
