import { describe, it, expect, afterEach } from 'vitest';
import { config } from '../../config/index.js';
import { extractFactoryInput, flattenFactory, toFactoryData } from './camera-factory.js';
import { decrypt } from '../../lib/encryption.js';
import { SECRET_MASK } from '../../lib/rtsp-credentials.js';

const setFactory = (on: boolean) => {
  (config as any).factoryModulesEnabled = on;
};

describe('Camera factory settings [R2.3]', () => {
  afterEach(() => setFactory(false));

  it('ignores bodies without factory fields', () => {
    setFactory(false);
    expect(extractFactoryInput({ name: 'cam', rtspUrl: 'rtsp://x' })).toBeNull();
  });

  it('rejects factory fields while the factory modules are off instead of dropping them', () => {
    setFactory(false);
    expect(() => extractFactoryInput({ name: 'cam', smbSharePath: '//nas/share' })).toThrow(/FACTORY_MODULES_ENABLED/);
    expect(() => extractFactoryInput({ factorySettings: { pollIntervalSeconds: 30 } })).toThrow(/FACTORY_MODULES_ENABLED/);
  });

  it('accepts top-level (sync worker) and nested fields when on, and validates them', () => {
    setFactory(true);
    expect(extractFactoryInput({ smbSharePath: '//nas/share', factorySettings: { pollIntervalSeconds: 60 } })).toEqual({
      smbSharePath: '//nas/share',
      pollIntervalSeconds: 60,
    });
    expect(() => extractFactoryInput({ pollIntervalSeconds: 1 })).toThrow(/Invalid factory camera settings/);
    // Counters are maintained by the server, not accepted from clients.
    expect(extractFactoryInput({ totalImagesCount: 5, lastImageAt: '2026-10-31T00:00:00Z' })).toBeNull();
  });

  it('encrypts the SMB password and treats the mask as unchanged', () => {
    const data = toFactoryData({ smbPasswordEncrypted: 'secret', sourceOldestFileAt: '2026-10-31T00:00:00.000Z' });
    expect(decrypt(String(data.smbPasswordEncrypted))).toBe('secret');
    expect(data.sourceOldestFileAt).toBeInstanceOf(Date);
    expect('smbPasswordEncrypted' in toFactoryData({ smbPasswordEncrypted: SECRET_MASK })).toBe(false);
  });

  it('returns factory fields at the top level only when the modules are on', () => {
    const camera = { id: 'c1', name: 'cam', factorySettings: { cameraId: 'c1', smbSharePath: '//nas/a', createdAt: new Date() } };
    setFactory(false);
    expect(flattenFactory(camera)).toEqual({ id: 'c1', name: 'cam' });
    setFactory(true);
    expect(flattenFactory(camera)).toEqual({ id: 'c1', name: 'cam', smbSharePath: '//nas/a' });
  });
});
