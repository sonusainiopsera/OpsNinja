-- Rollback: 0007_sla_policies
-- Drops all SLA tables in reverse dependency order.

DROP TABLE IF EXISTS sla_policy_versions;
DROP TABLE IF EXISTS sla_policies;
DROP TABLE IF EXISTS sla_calendar_holidays;
DROP TABLE IF EXISTS sla_calendar_windows;
DROP TABLE IF EXISTS sla_calendars;

DROP FUNCTION IF EXISTS prevent_sla_policy_version_modification();
