import { describe, expect, it } from 'vitest';
import { carriesKeyframeData, FastRtpRewriter, videoOnlySdp } from './fast-playback-proxy.js';

/** An RTP packet with these fields and a payload starting with these bytes. */
function rtp(sequence: number, timestamp: number, payload: number[]): Buffer {
  const packet = Buffer.alloc(12 + payload.length);
  packet[0] = 0x80;
  packet[1] = 96;
  packet.writeUInt16BE(sequence, 2);
  packet.writeUInt32BE(timestamp >>> 0, 4);
  payload.forEach((b, i) => {
    packet[12 + i] = b;
  });
  return packet;
}
const HEVC_IDR = [19 << 1, 1];
const HEVC_P = [1 << 1, 1];
const HEVC_FU_IDR_START = [49 << 1, 1, 0x80 | 19];
const HEVC_FU_P = [49 << 1, 1, 0x80 | 1];

describe('FastRtpRewriter', () => {
  it('squeezes timestamps by the speed', () => {
    const rewriter = new FastRtpRewriter(4, 'H265');
    const stamps = [1000, 1000 + 3600, 1000 + 7200].map((t, i) => rewriter.rewrite(rtp(i, t, HEVC_P))!.readUInt32BE(4));
    expect(stamps).toEqual([1000, 1000 + 900, 1000 + 1800]);
  });

  it('carries on across the wrap of the 32-bit clock', () => {
    const rewriter = new FastRtpRewriter(2, 'H265');
    const start = 0xffffff00;
    rewriter.rewrite(rtp(0, start, HEVC_P));
    expect(rewriter.rewrite(rtp(1, (start + 0x200) >>> 0, HEVC_P))!.readUInt32BE(4)).toBe((start + 0x100) >>> 0);
  });

  it('leaves the original packet untouched', () => {
    const packet = rtp(7, 5000, HEVC_P);
    const rewriter = new FastRtpRewriter(2, 'H265');
    rewriter.rewrite(rtp(6, 1000, HEVC_P));
    rewriter.rewrite(packet);
    expect(packet.readUInt32BE(4)).toBe(5000);
    expect(packet.readUInt16BE(2)).toBe(7);
  });

  it('sends every frame below 8x', () => {
    const rewriter = new FastRtpRewriter(5, 'H265');
    expect(rewriter.rewrite(rtp(0, 0, HEVC_P))).not.toBeNull();
  });

  it('sends only whole pictures from 8x, with unbroken sequence numbers', () => {
    const rewriter = new FastRtpRewriter(8, 'H265');
    const out = [HEVC_IDR, HEVC_P, HEVC_FU_P, HEVC_FU_IDR_START].map((p, i) => rewriter.rewrite(rtp(100 + i, i * 3600, p)));
    expect(out[1]).toBeNull();
    expect(out[2]).toBeNull();
    expect(out[0]!.readUInt16BE(2)).toBe(0);
    expect(out[3]!.readUInt16BE(2)).toBe(1);
  });

  it('leaves out what is not the video, whose clock would upset the timing', () => {
    const rewriter = new FastRtpRewriter(2, 'H265', 96);
    const other = rtp(0, 999999, HEVC_P);
    other[1] = 112;
    expect(rewriter.rewrite(other)).toBeNull();
    expect(rewriter.rewrite(rtp(1, 1000, HEVC_P))!.readUInt32BE(4)).toBe(1000);
  });

  it('keeps counting the recording while frames are left out', () => {
    const rewriter = new FastRtpRewriter(8, 'H265');
    rewriter.rewrite(rtp(0, 0, HEVC_IDR));
    expect(rewriter.rewrite(rtp(1, 180000, HEVC_P))).toBeNull();
    expect(rewriter.recordingSeconds).toBe(2);
  });

  it('ignores a packet too short to be RTP', () => {
    expect(new FastRtpRewriter(2, 'H264').rewrite(Buffer.alloc(4))).toBeNull();
  });
});

describe('carriesKeyframeData', () => {
  it('knows H.265 pictures and settings', () => {
    for (const nal of [19, 20, 21, 32, 33, 34]) expect(carriesKeyframeData(Buffer.from([nal << 1, 1]), true)).toBe(true);
    for (const nal of [0, 1, 9, 39]) expect(carriesKeyframeData(Buffer.from([nal << 1, 1]), true)).toBe(false);
  });

  it('knows H.264 pictures and settings', () => {
    for (const nal of [5, 7, 8]) expect(carriesKeyframeData(Buffer.from([nal]), false)).toBe(true);
    expect(carriesKeyframeData(Buffer.from([1]), false)).toBe(false);
    expect(carriesKeyframeData(Buffer.from([28, 0x80 | 5]), false)).toBe(true);
    expect(carriesKeyframeData(Buffer.from([28, 0x80 | 1]), false)).toBe(false);
  });
});

describe('videoOnlySdp', () => {
  const sdp = ['v=0', 'o=- 1 1 IN IP4 10.0.0.1', 's=Media', 't=0 0', 'a=control:rtsp://rec/x', 'a=range:clock=x', 'm=video 0 RTP/AVP 96', 'a=rtpmap:96 H265/90000', 'a=control:rtsp://rec/x/trackID=1', 'm=audio 0 RTP/AVP 0', 'a=control:rtsp://rec/x/trackID=2'].join('\r\n');

  it('keeps the video, drops the audio and remembers the real track', () => {
    const out = videoOnlySdp(sdp)!;
    expect(out.control).toBe('rtsp://rec/x/trackID=1');
    expect(out.codec).toBe('H265');
    expect(out.payloadType).toBe(96);
    expect(out.sdp).toContain('m=video');
    expect(out.sdp).not.toContain('m=audio');
    expect(out.sdp).not.toContain('rtsp://rec');
  });

  it('gives nothing back when there is no video', () => {
    expect(videoOnlySdp('v=0\r\nm=audio 0 RTP/AVP 0')).toBeNull();
  });
});
