-- Drop events table and related objects
DROP TRIGGER IF EXISTS update_events_updated_at ON events;
DROP TABLE IF EXISTS events CASCADE;