import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { encrypt, decrypt } from '../lib/encryption.js';
import { verifySecrets } from './verify-secrets.js';

/** What encrypt() would produce under a different ENCRYPTION_KEY (e.g. a backup restored with the wrong key). */
function encryptWithOtherKey(text: string) {
  const key = crypto.createHash('sha256').update('some-other-installation-key').digest();
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = c.update(text, 'utf8', 'hex') + c.final('hex');
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${data}`;
}

function prismaWith(devices: any[], cameras: any[], settings: any[]) {
  return {
    device: { findMany: vi.fn().mockResolvedValue(devices) },
    camera: { findMany: vi.fn().mockResolvedValue(cameras) },
    systemSetting: { findMany: vi.fn().mockResolvedValue(settings) },
  } as any;
}

describe('verify-secrets (after a restore)', () => {
  it('passes when everything decrypts with this key; credential-free RTSP URLs are not counted', async () => {
    const r = await verifySecrets(prismaWith(
      [{ name: 'NVR-1', passwordEncrypted: encrypt('pw') }],
      [{ id: 'a', name: 'Cam 1', rtspUrl: encrypt('rtsp://u:p@10.0.0.1/1'), rtspUrlSub: 'rtsp://10.0.0.1:554/sub' }],
      [{ key: 'telegram_bot_token', value: encrypt('123:abc') }],
    ), decrypt);
    expect(r.allDecrypt).toBe(true);
    expect(r.recorderPasswords).toMatchObject({ checked: 1, ok: 1, failed: [] });
    expect(r.cameraRtspUrls).toMatchObject({ checked: 1, ok: 1, failed: [] });
    expect(r.secretSettings).toMatchObject({ checked: 1, ok: 1 });
  });

  it('fails and names the records when the key does not belong to the database', async () => {
    const r = await verifySecrets(prismaWith(
      [{ name: 'NVR-1', passwordEncrypted: encryptWithOtherKey('pw') }, { name: 'NVR-2', passwordEncrypted: encrypt('pw') }],
      [{ id: 'a', name: 'Cam 1', rtspUrl: encryptWithOtherKey('rtsp://u:p@x/1'), rtspUrlSub: encryptWithOtherKey('rtsp://u:p@x/2') }],
      [],
    ), decrypt);
    expect(r.allDecrypt).toBe(false);
    expect(r.recorderPasswords).toMatchObject({ checked: 2, ok: 1, failed: ['NVR-1'] });
    expect(r.cameraRtspUrls.failed).toEqual(['Cam 1']);
  });

  it('reports a recorder password stored without encryption, without failing', async () => {
    const r = await verifySecrets(prismaWith([{ name: 'Old NVR', passwordEncrypted: 'plain-legacy' }], [], []), decrypt);
    expect(r.allDecrypt).toBe(true);
    expect(r.recorderPasswords).toMatchObject({ checked: 1, plaintext: 1, ok: 0 });
  });
});
