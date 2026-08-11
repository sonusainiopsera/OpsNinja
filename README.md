# OpsNinja

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
