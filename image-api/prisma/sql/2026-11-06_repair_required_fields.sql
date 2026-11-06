-- The settings page used to save the required-fields JSON as the text "[object Object]". The real
-- value cannot be recovered, so reset it to "nothing extra required". Idempotent.

DO $$
BEGIN
  IF to_regclass('public.system_configs') IS NOT NULL THEN
    UPDATE system_configs SET value = '{}' WHERE key = 'required_fields' AND value = '[object Object]';
  END IF;
END $$;
