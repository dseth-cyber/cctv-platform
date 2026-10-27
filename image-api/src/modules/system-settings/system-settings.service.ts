import { getPrisma } from '../../lib/prisma.js';
import { encrypt, decrypt } from '../../lib/encryption.js';

/**
 * Settings whose values are credentials and must not sit in the database in the clear.
 * Camera SMB passwords have always been encrypted; these were not, purely because they
 * arrived through a different screen. decrypt() returns unrecognised input unchanged, so
 * values stored before this existed keep working and re-encrypt on their next save.
 */
const SECRET_KEYS = new Set([
  'telegram_bot_token',
  'telegram_api_token',
  'llm_api_key',
]);

function readValue(key: string, value: string): string {
  return SECRET_KEYS.has(key) ? decrypt(value) : value;
}

function writeValue(key: string, value: string): string {
  // Never encrypt an empty string — "not configured" should stay visibly empty rather
  // than becoming a blob that decrypts to nothing.
  return SECRET_KEYS.has(key) && value !== '' ? encrypt(value) : value;
}

export function isSecretSetting(key: string): boolean {
  return SECRET_KEYS.has(key);
}

export async function getSetting(key: string): Promise<string | null> {
  const prisma = getPrisma();
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row ? readValue(key, row.value) : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const prisma = getPrisma();
  const stored = writeValue(key, value);
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value: stored },
    create: { key, value: stored },
  });
}

export async function getSettings(keys: string[]): Promise<Record<string, string | null>> {
  const prisma = getPrisma();
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: keys } },
  });
  const map: Record<string, string | null> = {};
  for (const k of keys) map[k] = null;
  for (const row of rows) map[row.key] = readValue(row.key, row.value);
  return map;
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const prisma = getPrisma();
  const rows = await prisma.systemSetting.findMany();
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = readValue(row.key, row.value);
  return map;
}
