-- =============================================================================
-- WO-003: Database Roles and Grant Matrix
-- Description:
--   Creates two purpose-specific roles with least-privilege grants:
--
--   opsninja_migrator  — migration / DDL role. Owns objects and holds
--                        CONNECT + schema CREATE. Used by drizzle-kit and
--                        manual DBA operations. NEVER used by the API process.
--
--   opsninja_app       — canonical name for the runtime API role. In this
--                        codebase the working name is `app_user`; migration
--                        0009_identity_rls.sql creates `app_user` with identical
--                        attributes. `opsninja_app` is created here so the
--                        canonical name is registered and documented, and
--                        future tooling can use either name.
--
--   Role attributes enforced for opsninja_app / app_user:
--     NOSUPERUSER  — cannot elevate to superuser
--     NOBYPASSRLS  — always subject to Row-Level Security
--     NOCREATEDB   — cannot create databases
--     NOCREATEROLE — cannot create or drop roles
--     NOLOGIN      — login not via this role (connect through app_user in prod)
--
--   Grants are applied IF the role already exists (idempotent DO blocks) so
--   this migration is safe to re-run and compose with 0009 which creates
--   app_user separately.
--
-- Note on separation of concerns:
--   This migration creates the roles and documents the intent. The detailed
--   DML grants for app_user are applied by 0009_identity_rls.sql. opsninja_app
--   and app_user share the same privilege level by design.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. opsninja_migrator — DDL / migration role
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'opsninja_migrator') THEN
    CREATE ROLE opsninja_migrator
      NOSUPERUSER
      NOCREATEDB
      CREATEROLE       -- may create sub-roles for owned schemas
      INHERIT
      NOLOGIN
      NOBYPASSRLS;

    COMMENT ON ROLE opsninja_migrator IS
      'Migration role: owns schema objects, holds DDL rights. '
      'Used exclusively by drizzle-kit and DBA sessions. '
      'NEVER used by the API process at runtime.';
  END IF;
END;
$$;

-- opsninja_migrator needs CREATE on the public schema to run DDL.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'opsninja_migrator') THEN
    GRANT CREATE ON SCHEMA public TO opsninja_migrator;
    -- Also grant USAGE so it can reference objects in public.
    GRANT USAGE ON SCHEMA public TO opsninja_migrator;
    -- Grant all table-level privileges so the migrator can ALTER or DROP.
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO opsninja_migrator;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO opsninja_migrator;
    GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO opsninja_migrator;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. opsninja_app — canonical runtime application role
--    (working name in codebase: app_user, created by 0009_identity_rls.sql)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'opsninja_app') THEN
    CREATE ROLE opsninja_app
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOLOGIN
      NOBYPASSRLS;

    COMMENT ON ROLE opsninja_app IS
      'Canonical runtime application role (alias: app_user). '
      'NOSUPERUSER + NOBYPASSRLS ensures tenant RLS is always enforced. '
      'DML grants applied by 0009_identity_rls.sql to app_user.';
  END IF;
END;
$$;

-- opsninja_app: only USAGE on the public schema (no DDL rights).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'opsninja_app') THEN
    GRANT USAGE ON SCHEMA public TO opsninja_app;
    -- Explicitly revoke CREATE to prevent DDL.
    REVOKE CREATE ON SCHEMA public FROM opsninja_app;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. app_user: ensure CREATE is revoked (defensive — 0009 creates this role)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    REVOKE CREATE ON SCHEMA public FROM app_user;
  END IF;
END;
$$;

COMMIT;
