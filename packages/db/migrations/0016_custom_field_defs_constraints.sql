-- Migration: 0016_custom_field_defs_constraints
-- Adds per-type constraint metadata column to custom_field_defs.
--
-- The constraints JSONB column stores type-specific validation rules:
--   string:       { maxLength?: number, regex?: string }
--   number:       { min?: number, max?: number, integer?: boolean }
--   multi_select: { maxItems?: number }
--
-- This column is nullable; NULL means no additional constraints beyond the
-- data-type check (all values of the correct type are accepted).

ALTER TABLE custom_field_defs
  ADD COLUMN IF NOT EXISTS constraints JSONB;

COMMENT ON COLUMN custom_field_defs.constraints IS
  'Per-type constraint metadata. string: {maxLength, regex}; number: {min, max, integer}; multi_select: {maxItems}. NULL = unconstrained.';
