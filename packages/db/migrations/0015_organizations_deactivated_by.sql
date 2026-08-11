-- Migration 0015: organizations.deactivated_by column
--
-- Created by: WO-025 Organization deactivation and reactivation lifecycle
--
-- Records the actor who deactivated an organization.
-- NULL for active organizations and for organizations deactivated before this
-- migration was applied.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS deactivated_by UUID;
