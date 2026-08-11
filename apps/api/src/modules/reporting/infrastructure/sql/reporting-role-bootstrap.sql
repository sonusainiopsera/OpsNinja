-- Reporting read-replica application role
--
-- This role is used by the OpsNinja API to connect to the reporting read-replica.
-- It must be created on the REPLICA database (or primary if replication is not yet
-- configured) before the API can connect.
--
-- Security requirements (AC-5):
--   NOSUPERUSER  – cannot bypass normal privilege checks
--   NOBYPASSRLS  – cannot bypass Row Level Security policies
--
-- The role has CONNECT + SELECT grants on reporting-readable tables only.
-- It must NOT have INSERT, UPDATE, DELETE, TRUNCATE, or DDL grants.
--
-- Run as a superuser on the target database:

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'opsninja_reporting') THEN
    CREATE ROLE opsninja_reporting
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      LOGIN
      NOBYPASSRLS
      CONNECTION LIMIT 20;
  END IF;
END
$$;

-- Grant connect on database (substitute 'opsninja' with the actual database name)
-- GRANT CONNECT ON DATABASE opsninja TO opsninja_reporting;

-- Grant SELECT on reporting-readable tables only.
-- Replace the schema list with your actual tenant-scoped tables.
-- GRANT SELECT ON TABLE
--   public.tickets,
--   public.sla_records,
--   public.organizations,
--   public.ai_writeback
-- TO opsninja_reporting;

-- Do NOT grant USAGE on sequences or write permissions of any kind.
-- Row Level Security is enforced at the Postgres level via app.current_tenant
-- set_config calls inside every TenantScopedReplicaRunner transaction.
