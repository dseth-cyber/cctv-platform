/**
 * Checks that every value this installation encrypted can still be decrypted with the ENCRYPTION_KEY in the
 * environment: recorder passwords, camera RTSP URLs that carry credentials, secret system settings. Run it after
 * a restore drill (against the restored copy) or after moving the key, to learn now, not on the day of a real
 * restore, whether the backup and the key belong together. Read-only. Prints counts and record names, never a
 * value or the key.
 *
 *   docker run --rm --network <net> --env-file .env.production -e DATABASE_URL=postgresql://... \
 *     --entrypoint node cctv-api:<version> dist/scripts/verify-secrets.js
 *
 * Exit 0 = everything decrypts; 1 = something does not (the key does not match this database); 2 = could not run.
 */
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';

// Same shape test as rtsp-credentials.ts: encrypt() output is iv(16 bytes):tag(16 bytes):data, all hex.
const SEALED_RE = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/i;
// Keep in step with SECRET_KEYS in modules/system-settings/system-settings.service.ts.
const SECRET_SETTING_KEYS = ['telegram_bot_token', 'telegram_api_token', 'llm_api_key'];

export interface SecretGroupResult {
  checked: number;
  ok: number;
  /** Stored without encryption (older rows): readable, but not protected. */
  plaintext: number;
  failed: string[];
}
export interface SecretCheckResult {
  recorderPasswords: SecretGroupResult;
  cameraRtspUrls: SecretGroupResult;
  secretSettings: SecretGroupResult;
  allDecrypt: boolean;
}

const group = (): SecretGroupResult => ({ checked: 0, ok: 0, plaintext: 0, failed: [] });

type Decrypt = (ciphertext: string) => string;

function tryOne(decrypt: Decrypt, g: SecretGroupResult, value: string | null | undefined, label: string, sealedOnly: boolean) {
  if (!value) return;
  if (!SEALED_RE.test(value)) {
    // A credential-free RTSP URL is meant to be stored as is; a recorder password or secret setting is not.
    if (!sealedOnly) { g.checked++; g.plaintext++; }
    return;
  }
  g.checked++;
  try {
    decrypt(value);
    g.ok++;
  } catch {
    if (!g.failed.includes(label)) g.failed.push(label);
  }
}

export async function verifySecrets(prisma: Pick<PrismaClient, 'device' | 'camera' | 'systemSetting'>, decrypt: Decrypt): Promise<SecretCheckResult> {
  const recorderPasswords = group();
  const cameraRtspUrls = group();
  const secretSettings = group();

  const devices = await prisma.device.findMany({ where: { passwordEncrypted: { not: null } }, select: { name: true, passwordEncrypted: true } });
  for (const d of devices) tryOne(decrypt, recorderPasswords, d.passwordEncrypted, d.name, false);

  let cursor: string | undefined;
  for (;;) {
    const cams = await prisma.camera.findMany({
      select: { id: true, name: true, rtspUrl: true, rtspUrlSub: true },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const c of cams) {
      tryOne(decrypt, cameraRtspUrls, c.rtspUrl, c.name, true);
      tryOne(decrypt, cameraRtspUrls, c.rtspUrlSub, c.name, true);
    }
    if (cams.length < 500) break;
    cursor = cams[cams.length - 1].id;
  }

  const settings = await prisma.systemSetting.findMany({ where: { key: { in: SECRET_SETTING_KEYS } }, select: { key: true, value: true } });
  for (const s of settings) tryOne(decrypt, secretSettings, s.value, s.key, false);

  const allDecrypt = [recorderPasswords, cameraRtspUrls, secretSettings].every((g) => g.failed.length === 0);
  return { recorderPasswords, cameraRtspUrls, secretSettings, allDecrypt };
}

function report(r: SecretCheckResult) {
  const line = (name: string, g: SecretGroupResult) => {
    const bad = g.failed.length;
    console.log(`${bad ? 'FAIL' : 'ok  '} ${name}: ${g.ok}/${g.checked - g.plaintext} decrypt${g.plaintext ? `, ${g.plaintext} stored unencrypted` : ''}${bad ? `; cannot decrypt: ${g.failed.slice(0, 10).join(', ')}${bad > 10 ? ` and ${bad - 10} more` : ''}` : ''}`);
  };
  line('recorder passwords', r.recorderPasswords);
  line('camera RTSP URLs with credentials', r.cameraRtspUrls);
  line('secret system settings', r.secretSettings);
  console.log(r.allDecrypt
    ? 'All encrypted values decrypt with this ENCRYPTION_KEY.'
    : 'Some values do NOT decrypt: this ENCRYPTION_KEY does not belong to this database (or the rows are damaged).');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  // Loaded here, not at the top: the app config refuses to load in production without its secrets, and that
  // must read as "could not run" (exit 2), never as "does not decrypt" (exit 1). Pass the whole --env-file.
  const prisma = new PrismaClient();
  import('../lib/encryption.js')
    .then(({ decrypt }) => verifySecrets(prisma, decrypt))
    .then((r) => { report(r); process.exitCode = r.allDecrypt ? 0 : 1; })
    .catch((err) => { console.error(`Could not check: ${err instanceof Error ? err.message.split(String.fromCharCode(10))[0] : err}`); process.exitCode = 2; })
    .finally(() => prisma.$disconnect());
}
