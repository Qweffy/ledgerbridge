CREATE OR REPLACE FUNCTION notify_sync_events() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('sync_events', '');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS sync_events_notify ON sync_events;
--> statement-breakpoint
CREATE TRIGGER sync_events_notify AFTER INSERT ON sync_events FOR EACH ROW EXECUTE FUNCTION notify_sync_events();
