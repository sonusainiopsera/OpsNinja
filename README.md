# OpsNinja

Multi-tenant SaaS support and incident management platform for platform engineering organisations.

## Architecture

- **API**: NestJS 10 / TypeScript 5.6 / Node 22
- **Database**: PostgreSQL 16 with Row-Level Security (RLS)
- **ORM**: Drizzle ORM with PgBouncer transaction pooling
- **Monorepo**: npm workspaces + Turborepo

## Repository Structure

```
opsninja/
├── apps/
│   └── api/              # NestJS REST API (apps/api)
│       ├── src/
│       │   ├── main.ts
│       │   ├── app.module.ts
│       │   ├── common/tenant/    # Tenant interceptor & decorators
│       │   ├── data/             # Unit-of-work & base repository
│       │   ├── health/           # Health-check endpoints
│       │   └── observability/    # AsyncLocalStorage request context
│       └── test/
│           ├── factories/        # Reusable test principal factories
│           ├── fixtures/         # Seed data for integration tests
│           └── *.e2e-spec.ts
└── packages/
    └── db/               # Shared Drizzle schema, pool, client
```

## Key Design Decisions

### Tenant Isolation
All tenant isolation is enforced by PostgreSQL RLS policies that read the
`app.current_tenant` session variable. The `TenantContextInterceptor` opens a
database transaction and calls `set_config('app.current_tenant', tenantId, true)`
before any handler executes. The `true` flag makes the setting transaction-local,
which is safe under PgBouncer transaction pooling.

### Single Funnel
`withTenantTransaction(principal, fn)` in `apps/api/src/data/unit-of-work.ts` is
the only entry point for database access. An ESLint boundary rule prevents importing
the raw pool outside of `apps/api/src/data`.

### No Extra Round Trips
All six session variables (`app.current_tenant`, `app.current_user`,
`app.principal_kind`, `app.current_org_ids`, `statement_timeout`,
`idle_in_transaction_session_timeout`) are set in a single `SELECT set_config(...)` 
call — one extra round trip per request.

## Getting Started

```bash
# Install dependencies
npm install

# Start the API in development mode
npm run dev --workspace=apps/api

# Run unit tests
npm run test --workspace=apps/api

# Run e2e tests (requires DATABASE_URL)
DATABASE_URL=postgres://... npm run test:e2e --workspace=apps/api
```
