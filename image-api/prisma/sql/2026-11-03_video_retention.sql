-- Video retention: replace the image-oriented retention policy fields with recording_retention_days
-- (default 30, approved 2026-11-03) and record when a recording was moved to quarantine.
-- Runs before `prisma db push`; idempotent.

DO $$
BEGIN
  IF to_regclass('public.retention_policies') IS NOT NULL THEN
    ALTER TABLE retention_policies ADD COLUMN IF NOT EXISTS recording_retention_days INTEGER NOT NULL DEFAULT 30;
    ALTER TABLE retention_policies
      DROP COLUMN IF EXISTS raw_retention_days,
      DROP COLUMN IF EXISTS processed_retention_days,
      DROP COLUMN IF EXISTS thumbnail_retention_days,
      DROP COLUMN IF EXISTS archive_raw_days,
      DROP COLUMN IF EXISTS archive_enabled,
      DROP COLUMN IF EXISTS cold_storage_class,
      DROP COLUMN IF EXISTS cleanup_mode,
      DROP COLUMN IF EXISTS delete_order,
      DROP COLUMN IF EXISTS allow_emergency_cleanup;
  END IF;

  IF to_regclass('public.camera_recordings') IS NOT NULL THEN
    ALTER TABLE camera_recordings ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP(3);
    -- Rows quarantined before this column existed: their last update is when they were moved.
    UPDATE camera_recordings SET archived_at = updated_at WHERE is_archived AND archived_at IS NULL;
  END IF;

  DROP TYPE IF EXISTS storage_class;
  DROP TYPE IF EXISTS cleanup_mode;
END $$;
