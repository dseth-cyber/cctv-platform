-- Remove the legacy factory Image Service schema from the CCTV platform.
--
-- Runs before `prisma db push` (docker-entrypoint.sh migrate). Idempotent: every drop is IF EXISTS.
-- The code that used these tables is gone (git tag legacy-image-service-final keeps it).
--
-- Safety: refuses to run while any factory data table still holds rows, so a database that
-- carries real factory images is never emptied by a routine migrate. Take a pg_dump, move or
-- archive that data deliberately, then re-run. camera_factory_settings (per-camera SMB/processing
-- settings) and the factory columns of camera_templates are configuration and are dropped
-- together with the code; take a pg_dump first on any database whose values matter.

DO $$
DECLARE
  t TEXT;
  n BIGINT;
BEGIN
  FOREACH t IN ARRAY ARRAY['images', 'image_files', 'image_tags', 'processing_jobs', 'storage_profiles', 'migration_jobs', 'storage_snapshots', 'cleanup_runs']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'Legacy table % still has % row(s); back it up and empty it deliberately before removing the legacy schema', t, n;
      END IF;
    END IF;
  END LOOP;

  DROP TABLE IF EXISTS image_tags;
  DROP TABLE IF EXISTS image_files;
  DROP TABLE IF EXISTS processing_jobs;
  DROP TABLE IF EXISTS images;
  DROP TABLE IF EXISTS storage_snapshots;
  DROP TABLE IF EXISTS migration_jobs;
  DROP TABLE IF EXISTS storage_profiles;
  DROP TABLE IF EXISTS cleanup_runs;
  DROP TABLE IF EXISTS camera_factory_settings;

  ALTER TABLE IF EXISTS camera_templates
    DROP COLUMN IF EXISTS accepted_extensions,
    DROP COLUMN IF EXISTS convert_to_png,
    DROP COLUMN IF EXISTS keep_smaller,
    DROP COLUMN IF EXISTS generate_thumbnail,
    DROP COLUMN IF EXISTS thumbnail_size,
    DROP COLUMN IF EXISTS compression_quality,
    DROP COLUMN IF EXISTS poll_interval_seconds,
    DROP COLUMN IF EXISTS capture_mode;

  DROP TYPE IF EXISTS image_status;
  DROP TYPE IF EXISTS migration_status;
  DROP TYPE IF EXISTS file_type;
  DROP TYPE IF EXISTS cleanup_trigger;
  DROP TYPE IF EXISTS cleanup_run_status;
END $$;
