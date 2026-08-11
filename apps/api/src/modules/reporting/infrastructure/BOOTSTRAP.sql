-- Reporting replica application role bootstrap.
--
-- Run this ONCE on the read-replica PostgreSQL instance after provisioning.
-- The role intentionally carries NOSUPERUSER and NOBYPASSRLS so that:
--   NOSUPERUSER  — cannot alter system configuration or bypass OS-level restrictions
--   NOBYPASSRLS  — every query issued by this role is filtered by active RLS policies
--
-- The application sets app.current_tenant via SET LOCAL inside each transaction
-- before any query runs. RLS policies read current_setting('app.current_tenant')
-- to enforce tenant isolation.
--
-- Do NOT grant BYPASSRLS or SUPERUSER to this role under any circumstances.

CREATE ROLE opsninja_reporting
  NOSUPERUSER
  NOBYPASSRLS
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  LOGIN
  PASSWORD 'INJECT_FROM_SECRETS_MANAGER';

-- Connection grant
GRANT CONNECT ON DATABASE opsninja TO opsninja_reporting;

-- Schema visibility
GRANT USAGE ON SCHEMA public TO opsninja_reporting;

-- Read access on reporting-readable tables only.
-- Schema DDL is owned by WOREF-073; these grants are applied after the tables exist.
GRANT SELECT ON TABLE
  tenants,
  organizations,
  tickets,
  ticket_sla,
  ticket_ai_summaries
TO opsninja_reporting;

-- RLS is already active on all tenant-scoped tables (enforced by the platform
-- RLS baseline from WO-003). No additional policy grants are required here.
