# OpsNinja

Multi-tenant SaaS support and incident management platform for platform engineering organisations.

## Tech stack

| Layer | Tech | Purpose |
|-------|------|---------|
| Monorepo | npm workspaces + Turborepo | One repo for API, frontends, and shared packages |
| Runtime | Node.js ≥ 22, TypeScript 5.x | Shared language across backend and frontend |
| Backend | NestJS 10 (`apps/api`) | REST API under `/api/v1` (tickets, views, auth, orgs, SLA, …) |
| Agent UI | Next.js 15 (`apps/web-agent`) | Support-agent workspace (queue, dashboard, reports) — port **3000** |
| Portal UI | Next.js 15 (`apps/web-portal`) | Customer portal (tickets, submit, knowledge) — port **3001** |
| Database | PostgreSQL 16+ | Primary store with **Row-Level Security (RLS)** for tenant isolation |
| ORM | Drizzle ORM (`packages/db`) | Schema, migrations, and typed DB access |
| Cache / sessions | Redis | Sessions, rate limits, realtime helpers |
| Shared UI | `@opsninja/ui-kit` | Shared components (SLA countdown, badges, …) |
| API client | `@opsninja/api-client` | Typed HTTP client + session helpers for frontends |
| Local demo mocks | MSW (web-agent) | Mock tickets/views without full auth during local UI demos |

Optional later: AWS (S3 / SES / SQS / KMS), OIDC login, background workers under `apps/workers/`.

## Request flow (local)

```
Browser
  ├─ Agent UI  :3000  ──►  API :8080 /api/v1  ──►  Postgres + Redis
  └─ Portal UI :3001  ──►  API :8080 /api/v1  ──►  Postgres + Redis
```

With `NEXT_PUBLIC_USE_MSW=true` on the agent app, some `/api/v1` calls are mocked in the browser so the queue UI can run without a full login flow.

## Repository structure

```
opsninja/
├── apps/
│   ├── api/                 # NestJS REST API
│   ├── web-agent/           # Agent workspace (Next.js) — :3000
│   ├── web-portal/          # Customer portal (Next.js) — :3001
│   ├── realtime-gateway/    # WebSocket gateway (optional)
│   └── workers/             # Background workers (optional)
├── packages/
│   ├── db/                  # Drizzle schema + migrations
│   ├── ui-kit/              # Shared UI components
│   ├── api-client/          # Typed API client
│   └── …                    # filter-compiler, crypto, observability, …
└── docs/
```

## Prerequisites

- Node.js ≥ 22 and npm ≥ 10
- PostgreSQL (local DB named `opsninja` on port `5432`)
- Redis (e.g. Docker: `docker run -d --name opsninja-redis -p 6379:6379 redis:7-alpine`)

## Getting started (terminal)

```powershell
cd "C:\Users\my pc\Projects\OpsNinja"   # or your local clone path

# 1) Install dependencies
npm install

# 2) Configure API env (once)
copy apps\api\.env.example apps\api\.env
# Edit apps\api\.env:
#   DB_HOST=localhost
#   DB_PORT=5432
#   DB_NAME=opsninja
#   DB_USER=postgres
#   DB_PASSWORD=<your-password>
#   PORT=8080
#   REDIS_URL=redis://localhost:6379
#   CORS_ORIGINS=http://localhost:3000,http://localhost:3001

# 3) Start Redis (if using Docker and not already running)
docker start opsninja-redis
# or: docker run -d --name opsninja-redis -p 6379:6379 redis:7-alpine

# 4) Start services (three terminals)
npm run dev -w @opsninja/api
npm run dev -w @opsninja/web-agent
npm run dev -w @opsninja/web-portal
```

### Local URLs

| App | URL |
|-----|-----|
| Agent queue | http://localhost:3000/queue |
| Agent dashboard | http://localhost:3000/dashboard |
| Portal tickets | http://localhost:3001/tickets |
| Portal submit | http://localhost:3001/submit |
| Portal knowledge | http://localhost:3001/knowledge |
| API health | http://localhost:8080/api/v1/health |

Env files (`apps/api/.env`, `apps/web-agent/.env.local`) are gitignored — do not commit secrets.

### Useful commands

```bash
# API only
npm run dev -w @opsninja/api

# Unit tests (API)
npm run test -w @opsninja/api

# Typecheck / lint (turbo)
npm run typecheck
npm run lint
```

## Key design decisions

### Tenant isolation

All tenant isolation is enforced by PostgreSQL RLS policies that read the
`app.current_tenant` session variable. The `TenantContextInterceptor` opens a
database transaction and calls `set_config('app.current_tenant', tenantId, true)`
before any handler executes. The `true` flag makes the setting transaction-local,
which is safe under PgBouncer transaction pooling.

### Single funnel

`withTenantTransaction(principal, fn)` in `apps/api/src/data/unit-of-work.ts` is
the only entry point for database access. An ESLint boundary rule prevents importing
the raw pool outside of `apps/api/src/data`.

### No extra round trips

All six session variables (`app.current_tenant`, `app.current_user`,
`app.principal_kind`, `app.current_org_ids`, `statement_timeout`,
`idle_in_transaction_session_timeout`) are set in a single `SELECT set_config(...)`
call — one extra round trip per request.
