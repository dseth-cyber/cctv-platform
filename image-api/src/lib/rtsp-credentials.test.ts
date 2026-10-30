import { describe, it, expect } from 'vitest';
import { sealRtspUrl, openRtspUrl, redactRtspUrl, isMaskedRtspUrl, SECRET_MASK } from './rtsp-credentials.js';
import { toPublicCamera } from '../modules/cameras/cameras.service.js';

describe('RTSP credential handling [R1.1 / R1.2]', () => {
  const withUserinfo = 'rtsp://admin:S3cret!@192.168.10.5:554/Streaming/Channels/101';
  const withParams = 'rtsp://192.168.10.6:554/user=admin&password=S3cret!&channel=1&stream=0.sdp';
  const plain = 'rtsp://192.168.10.7:554/live';

  it('encrypts URLs that carry credentials and round-trips them', () => {
    for (const url of [withUserinfo, withParams]) {
      const sealed = sealRtspUrl(url)!;
      expect(sealed).not.toContain('S3cret');
      expect(sealed).not.toContain('rtsp://');
      expect(openRtspUrl(sealed)).toBe(url);
    }
  });

  it('stores credential-free URLs unchanged and reads legacy plaintext rows', () => {
    expect(sealRtspUrl(plain)).toBe(plain);
    expect(openRtspUrl(withUserinfo)).toBe(withUserinfo);
  });

  it('redacts userinfo and password params from sealed and legacy values', () => {
    expect(redactRtspUrl(sealRtspUrl(withUserinfo))).toBe(`rtsp://${SECRET_MASK}@192.168.10.5:554/Streaming/Channels/101`);
    expect(redactRtspUrl(withUserinfo)).not.toContain('S3cret');
    expect(redactRtspUrl(sealRtspUrl(withParams))).toBe(`rtsp://192.168.10.6:554/user=admin&password=${SECRET_MASK}&channel=1&stream=0.sdp`);
    expect(redactRtspUrl(plain)).toBe(plain);
  });

  it('refuses to store a redacted URL echoed back by a client', () => {
    const redacted = redactRtspUrl(withUserinfo)!;
    expect(isMaskedRtspUrl(redacted)).toBe(true);
    expect(() => sealRtspUrl(redacted)).toThrow();
  });

  it('toPublicCamera never exposes credentials to normal users', () => {
    const camera = {
      id: 'c1',
      rtspUrl: sealRtspUrl(withUserinfo),
      rtspUrlSub: withParams,
      smbPasswordEncrypted: 'decrypted-smb-pass',
      device: { id: 'd1', passwordEncrypted: 'iv:tag:data' },
    };

    const out = toPublicCamera(camera, 'viewer');
    const json = JSON.stringify(out);
    expect(json).not.toContain('S3cret');
    expect(json).not.toContain('decrypted-smb-pass');
    expect(json).not.toContain('iv:tag:data');
    expect(out.smbPasswordEncrypted).toBe(SECRET_MASK);
  });

  it('toPublicCamera keeps the SMB password only for the system service key', () => {
    const out = toPublicCamera({ id: 'c1', rtspUrl: withUserinfo, smbPasswordEncrypted: 'decrypted-smb-pass' }, 'system');
    expect(out.smbPasswordEncrypted).toBe('decrypted-smb-pass');
    expect(out.rtspUrl).not.toContain('S3cret');
  });
});
