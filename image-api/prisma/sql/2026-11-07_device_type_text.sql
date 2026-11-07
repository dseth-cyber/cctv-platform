-- Device types become a master data list people can add to, so the column stops being a fixed enum.
-- Every existing value is kept as its text. db push cannot do this without calling it data loss. Idempotent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = 'device_type' AND data_type = 'USER-DEFINED'
  ) THEN
    ALTER TABLE devices ALTER COLUMN device_type DROP DEFAULT;
    ALTER TABLE devices ALTER COLUMN device_type TYPE varchar(32) USING device_type::text;
    ALTER TABLE devices ALTER COLUMN device_type SET DEFAULT 'dvr';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeviceType') THEN
    DROP TYPE "DeviceType";
  END IF;
END $$;
