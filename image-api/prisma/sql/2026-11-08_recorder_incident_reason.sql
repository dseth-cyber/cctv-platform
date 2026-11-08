-- One incident for a whole recorder going down needs a reason to show. Safe to run more than once.
DO $$
BEGIN
  IF to_regclass('public.masterdata') IS NOT NULL THEN
    INSERT INTO masterdata (id, type, code, name_th, name_en, name_cn, name_mm, name_jp, sort_order, is_active, is_default, created_at, updated_at)
    VALUES (gen_random_uuid(), 'incident_reason', 'recorder_offline', 'เครื่องบันทึกไม่ตอบ', 'Recorder Not Responding', '录像机无响应', 'Recorder တုံ့ပြန်မှုမရှိ', 'レコーダー応答なし', 8, true, false, now(), now())
    ON CONFLICT (type, code) DO NOTHING;
  END IF;
END $$;
