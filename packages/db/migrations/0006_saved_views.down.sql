-- Down migration: 0006_saved_views
-- Reverses the saved views tables.

DROP TABLE IF EXISTS saved_view_pins;
DROP TABLE IF EXISTS saved_views;
