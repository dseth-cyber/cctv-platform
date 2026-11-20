-- Escalation phase 5: telegram_users.user_id links a Telegram user to one web account (unique). db push treats adding
-- a unique constraint to an existing table as possible data loss and stops, although a brand-new nullable column has
-- no duplicates (production 2026-11-20: rc12 migrate refused, rolled back to rc11.1). Create it here first, so db push
-- finds it already in place. Idempotent; does nothing on a fresh database (db push creates the table there).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'telegram_users') THEN
    ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS user_id uuid;
    CREATE UNIQUE INDEX IF NOT EXISTS telegram_users_user_id_key ON telegram_users (user_id);
  END IF;
END $$;
