-- Leftovers from the removed factory Image Service: storage-pressure fields on storage providers
-- (nothing reads them since storage-lifecycle was removed) and factory masterdata types.
-- Runs before `prisma db push`; idempotent.

DO $$
BEGIN
  IF to_regclass('public.storage_providers') IS NOT NULL THEN
    ALTER TABLE storage_providers
      DROP COLUMN IF EXISTS pressure_warning_percent,
      DROP COLUMN IF EXISTS pressure_start_percent,
      DROP COLUMN IF EXISTS pressure_stop_percent,
      DROP COLUMN IF EXISTS pressure_critical_percent,
      DROP COLUMN IF EXISTS pressure_emergency_percent,
      DROP COLUMN IF EXISTS backpressure_strategy,
      DROP COLUMN IF EXISTS current_pressure_state,
      DROP COLUMN IF EXISTS current_pressure_since;
  END IF;

  DROP TYPE IF EXISTS backpressure_strategy;
  DROP TYPE IF EXISTS storage_pressure_state;

  IF to_regclass('public.masterdata') IS NOT NULL THEN
    DELETE FROM masterdata WHERE type IN (
      'camera_type', 'capture_mode', 'image_category', 'defect_type', 'inspection_type',
      'customer', 'job_type', 'production_line', 'image_viewpoint');
  END IF;
END $$;
