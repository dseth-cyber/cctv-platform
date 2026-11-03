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

-- Factory incident options (SMB share, image workers). The seed re-creates the CCTV replacements
-- (rtsp_unreachable, media_server_down, rtsp_stream, credentials, software).
DO $$
BEGIN
  IF to_regclass('public.masterdata') IS NOT NULL THEN
    DELETE FROM masterdata WHERE (type = 'incident_reason' AND code IN ('smb_unreachable', 'worker_down'))
                              OR (type = 'incident_root_cause' AND code IN ('smb', 'worker'));
  END IF;
END $$;

-- CCTV replacements for the options above (same as prisma/seed.ts; the seed only runs with RUN_SEED=true).
DO $$
BEGIN
  IF to_regclass('public.masterdata') IS NOT NULL THEN
    INSERT INTO masterdata (id, type, code, name_th, name_en, name_cn, name_mm, name_jp, sort_order, is_active, is_default, created_at, updated_at)
    VALUES
      (gen_random_uuid(), 'incident_reason', 'rtsp_unreachable', 'สตรีม RTSP เชื่อมต่อไม่ได้', 'RTSP Stream Unreachable', 'RTSP流无法访问', 'RTSP stream ချိတ်ဆက်၍မရ', 'RTSPストリーム接続不可', 8, true, false, now(), now()),
      (gen_random_uuid(), 'incident_reason', 'media_server_down', 'Media Server หยุดทำงาน', 'Media Server Down', '媒体服务器停止', 'Media Server ရပ်တန့်သွားသည်', 'メディアサーバー停止', 11, true, false, now(), now()),
      (gen_random_uuid(), 'incident_root_cause', 'rtsp_stream', 'สตรีม RTSP', 'RTSP Stream', 'RTSP流', 'RTSP stream', 'RTSPストリーム', 5, true, false, now(), now()),
      (gen_random_uuid(), 'incident_root_cause', 'credentials', 'รหัสผ่านกล้อง', 'Camera Credentials', '摄像机凭据', 'ကင်မရာ စကားဝှက်', 'カメラ認証情報', 5, true, false, now(), now()),
      (gen_random_uuid(), 'incident_root_cause', 'software', 'ซอฟต์แวร์/บริการ', 'Software/Service', '软件/服务', 'ဆော့ဖ်ဝဲ/ဝန်ဆောင်မှု', 'ソフトウェア/サービス', 6, true, false, now(), now())
    ON CONFLICT (type, code) DO NOTHING;
  END IF;
END $$;
