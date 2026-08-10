# OpsNinja

Multi-tenant SaaS support and incident management platform for platform engineering organisations.

## Repository Structure

```
opsninja-api/
├── packages/
│   └── db/           # Drizzle ORM schema, migrations, seed and tests
│       ├── src/schema/   # Typed schema modules
│       ├── migrations/   # Versioned SQL migrations
│       ├── scripts/      # Seed and utility scripts
│       └── test/         # Schema invariant and integration tests
```

## Technology Stack

- **Runtime:** Node.js 22 / TypeScript 5.6
- **API:** NestJS 10
- **Database:** PostgreSQL 16 (shared schema, row-level `tenant_id` isolation + RLS)
- **ORM:** Drizzle ORM + drizzle-kit
- **Package manager:** pnpm workspaces

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm 9+
- PostgreSQL 16 (or Docker for tests)

### Install dependencies

```bash
pnpm install
```

### Database setup

```bash
# Generate migrations (from schema changes)
pnpm db:generate

# Apply migrations
DATABASE_URL=postgres://user:pass@localhost:5432/opsninja pnpm db:migrate

# Seed deterministic fixture data
DATABASE_URL=postgres://user:pass@localhost:5432/opsninja pnpm db:seed
```

### Run tests

```bash
# Schema invariant + integration tests (requires Docker)
pnpm db:test
```

## Architecture

See `.forge-context/architecture.md` for detailed architectural decisions.

### Multi-tenancy Design

Every tenant-scoped table carries a non-nullable `tenant_id uuid` as the leading column of its primary key or principal composite index. Cross-tenant containment is structural: composite foreign keys that include `tenant_id` make it impossible to attach records from one tenant to another even if application code is wrong.

### Partition Strategy

High-volume tables (`tickets`, `ticket_comments`, `audit_logs`) use PostgreSQL monthly range partitions on `created_at`. The `ensure_monthly_partitions(table_name, months_ahead)` plpgsql function idempotently creates the next N monthly partitions plus a default catch-all.
