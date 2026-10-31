-- [R2.3] Move factory image-pipeline fields from cameras into camera_factory_settings.
--
-- Runs before `prisma db push` (docker-entrypoint.sh migrate). Idempotent: it only does work while
-- cameras still has the old columns, so it is a no-op on fresh databases and on re-runs.
-- The data is copied first and the columns dropped afterwards, inside one DO block (one transaction).
-- Take a pg_dump before running it on any database that holds real data.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cameras' AND column_name = 'smb_share_path'
  ) THEN
    RAISE NOTICE 'R2.3: cameras has no factory columns, nothing to migrate';
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS camera_factory_settings (
    camera_id                UUID         NOT NULL,
    smb_share_path           TEXT,
    smb_domain               VARCHAR(128),
    smb_username             VARCHAR(256),
    smb_password_encrypted   TEXT,
    smb_subdirectory_pattern VARCHAR(256),
    poll_interval_seconds    INTEGER      NOT NULL DEFAULT 30,
    capture_mode             VARCHAR(32)  NOT NULL DEFAULT 'periodic',
    camera_type_code         VARCHAR(64),
    viewpoint_code           VARCHAR(64),
    accepted_extensions      TEXT[]       DEFAULT ARRAY[]::TEXT[],
    convert_to_png           BOOLEAN,
    keep_smaller             BOOLEAN,
    generate_thumbnail       BOOLEAN,
    thumbnail_size           INTEGER,
    compression_quality      INTEGER,
    source_oldest_file_at    TIMESTAMP(3),
    source_file_count        INTEGER,
    last_image_at            TIMESTAMP(3),
    total_images_count       BIGINT       NOT NULL DEFAULT 0,
    created_at               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT camera_factory_settings_pkey PRIMARY KEY (camera_id),
    CONSTRAINT camera_factory_settings_camera_id_fkey FOREIGN KEY (camera_id)
      REFERENCES cameras(id) ON DELETE CASCADE ON UPDATE CASCADE
  );

  -- Every camera gets its row, so nothing is lost even for cameras that never used SMB.
  INSERT INTO camera_factory_settings (
    camera_id, smb_share_path, smb_domain, smb_username, smb_password_encrypted, smb_subdirectory_pattern,
    poll_interval_seconds, capture_mode, camera_type_code, viewpoint_code, accepted_extensions,
    convert_to_png, keep_smaller, generate_thumbnail, thumbnail_size, compression_quality,
    source_oldest_file_at, source_file_count, last_image_at, total_images_count
  )
  SELECT
    id, smb_share_path, "smbDomain", smb_username, smb_password_encrypted, smb_subdirectory_pattern,
    poll_interval_seconds, capture_mode, camera_type_code, viewpoint_code, accepted_extensions,
    convert_to_png, keep_smaller, generate_thumbnail, thumbnail_size, compression_quality,
    source_oldest_file_at, source_file_count, last_image_at, total_images_count
  FROM cameras
  ON CONFLICT (camera_id) DO NOTHING;

  -- Refuse to drop anything unless every camera has its copy.
  IF (SELECT count(*) FROM cameras) <> (SELECT count(*) FROM camera_factory_settings f JOIN cameras c ON c.id = f.camera_id) THEN
    RAISE EXCEPTION 'R2.3: camera_factory_settings is missing rows; columns were not dropped';
  END IF;

  ALTER TABLE cameras
    DROP COLUMN smb_share_path,
    DROP COLUMN "smbDomain",
    DROP COLUMN smb_username,
    DROP COLUMN smb_password_encrypted,
    DROP COLUMN smb_subdirectory_pattern,
    DROP COLUMN poll_interval_seconds,
    DROP COLUMN capture_mode,
    DROP COLUMN camera_type_code,
    DROP COLUMN viewpoint_code,
    DROP COLUMN accepted_extensions,
    DROP COLUMN convert_to_png,
    DROP COLUMN keep_smaller,
    DROP COLUMN generate_thumbnail,
    DROP COLUMN thumbnail_size,
    DROP COLUMN compression_quality,
    DROP COLUMN source_oldest_file_at,
    DROP COLUMN source_file_count,
    DROP COLUMN last_image_at,
    DROP COLUMN total_images_count;

  RAISE NOTICE 'R2.3: moved factory fields of % cameras into camera_factory_settings', (SELECT count(*) FROM camera_factory_settings);
END $$;
