import { describe, it, expect } from 'vitest';
import { buildChannelRtspUrl, findDeviceTemplate } from './devices.service.js';
import { extractRtspPassword } from '../../lib/rtsp-credentials.js';
import { encrypt } from '../../lib/encryption.js';

describe('buildChannelRtspUrl (vendor templates)', () => {
  it('keeps the existing Hikvision / Dahua / Uniview / Generic URLs', () => {
    expect(buildChannelRtspUrl('Hikvision', '10.0.0.5', 554, 1, 'admin', 'p@ss')).toBe('rtsp://admin:p%40ss@10.0.0.5:554/Streaming/Channels/101');
    expect(buildChannelRtspUrl('hikvision', '10.0.0.5', 554, 3, 'admin', 'x', 'sub')).toBe('rtsp://admin:x@10.0.0.5:554/Streaming/Channels/302');
    expect(buildChannelRtspUrl('IMOU', '10.0.0.5', 554, 2, 'admin', 'x', 'sub')).toBe('rtsp://admin:x@10.0.0.5:554/cam/realmonitor?channel=2&subtype=1');
    expect(buildChannelRtspUrl('Uniview', '10.0.0.5', 554, 1, null, null)).toBe('rtsp://10.0.0.5:554/unicast/c1/s0/live');
    expect(buildChannelRtspUrl('something-else', '10.0.0.5', 8554, 1, 'u', null)).toBe('rtsp://u@10.0.0.5:8554/ch1/main');
  });

  it('uses the templates for brands that were previously falling back to generic', () => {
    expect(buildChannelRtspUrl('Hanwha', '10.0.0.5', 554, 1, 'admin', 'x')).toBe('rtsp://admin:x@10.0.0.5:554/profile2/media.smp');
    expect(buildChannelRtspUrl('Tiandy', '10.0.0.5', 554, 4, 'a', 'b', 'sub')).toBe('rtsp://a:b@10.0.0.5:554/live/ch4_sub');
  });

  it('puts credentials in the path (not userinfo) when the pattern asks for them', () => {
    expect(buildChannelRtspUrl('Xiongmai', '10.0.0.5', 554, 1, 'admin', 'a&b')).toBe('rtsp://10.0.0.5:554/user=admin&password=a%26b&channel=1&stream=0.sdp');
  });

  it('maps brand aliases', () => {
    expect(findDeviceTemplate('HiLook').brand).toBe('Hikvision');
    expect(findDeviceTemplate('Samsung Wisenet').brand).toBe('Hanwha');
    expect(findDeviceTemplate(undefined).brand).toBe('Generic');
  });
});

describe('extractRtspPassword', () => {
  it('reads the userinfo password from a sealed URL', () => {
    expect(extractRtspPassword(encrypt('rtsp://admin:p%40ss@10.0.0.5:554/Streaming/Channels/101'))).toBe('p@ss');
  });
  it('reads a password= path parameter', () => {
    expect(extractRtspPassword(encrypt('rtsp://10.0.0.5:554/user=admin&password=a%26b&channel=1&stream=0.sdp'))).toBe('a&b');
  });
  it('returns null when there is no password', () => {
    expect(extractRtspPassword('rtsp://10.0.0.5:554/live')).toBeNull();
    expect(extractRtspPassword('rtsp://admin@10.0.0.5:554/live')).toBeNull();
    expect(extractRtspPassword(null)).toBeNull();
  });
});
