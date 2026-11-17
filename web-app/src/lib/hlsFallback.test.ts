import { describe, expect, it, beforeEach } from 'vitest';
import { canPlayNativeHls, liveTransport, whepToHlsUrl } from './hlsFallback';

describe('whepToHlsUrl', () => {
  it('keeps the stream path and the token query', () => {
    expect(whepToHlsUrl('/mediamtx/webrtc/dvr_6a1120aa_ch1_sub/whep?token=1.u.abc')).toBe(
      '/mediamtx/hls/dvr_6a1120aa_ch1_sub/index.m3u8?token=1.u.abc',
    );
  });

  it('works without a query', () => {
    expect(whepToHlsUrl('/mediamtx/webrtc/camera_abc/whep')).toBe('/mediamtx/hls/camera_abc/index.m3u8');
  });

  it('refuses URLs it does not know', () => {
    expect(whepToHlsUrl('')).toBeNull();
    expect(whepToHlsUrl('https://example.com/cam/whep')).toBeNull();
    expect(whepToHlsUrl('/mediamtx/webrtc/cam/whep/session-id')).toBeNull();
    expect(whepToHlsUrl('/mediamtx/hls/cam/index.m3u8')).toBeNull();
  });
});

describe('canPlayNativeHls', () => {
  const video = (answer: string) => ({ canPlayType: () => answer }) as unknown as HTMLVideoElement;
  it('follows the browser', () => {
    expect(canPlayNativeHls(video('maybe'))).toBe(true);
    expect(canPlayNativeHls(video(''))).toBe(false);
    expect(canPlayNativeHls(null)).toBe(false);
  });
});

describe('liveTransport', () => {
  beforeEach(() => liveTransport.reset());
  it('remembers for the page that WebRTC does not get through', () => {
    expect(liveTransport.preferHls()).toBe(false);
    liveTransport.markWebrtcUnreachable();
    expect(liveTransport.preferHls()).toBe(true);
  });
});
