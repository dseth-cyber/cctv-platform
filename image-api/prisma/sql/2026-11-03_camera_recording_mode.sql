-- Per-camera recording mode (approved 2026-11-03): DVR/NVRs keep their own recordings, so the
-- server only records cameras deliberately set to 'continuous'. Every existing camera becomes
-- 'live_only'. Runs before `prisma db push`; idempotent.

DO $$
BEGIN
  IF to_regclass('public.cameras') IS NOT NULL THEN
    ALTER TABLE cameras ADD COLUMN IF NOT EXISTS recording_mode VARCHAR(16) NOT NULL DEFAULT 'live_only';
  END IF;
END $$;
