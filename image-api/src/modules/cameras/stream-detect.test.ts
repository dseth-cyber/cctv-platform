import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectCameraStream, type StreamProbe } from './stream-detect.service.js';
import { probeTcpEndpoint } from './camera-probe.service.js';

vi.mock('./camera-probe.service.js', () => ({ probeTcpEndpoint: vi.fn() }));

const open = (ports: number[]) =>
  vi.mocked(probeTcpEndpoint).mockImplementation(async (_h, port) => ({ reachable: ports.includes(port ?? 554), latencyMs: 1 }));

const video = { codec: 'h264', width: 1920, height: 1080 };
const base = { ipAddress: '10.0.0.5', username: 'admin', password: 'secret' };

describe('detectCameraStream', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finds a Hikvision/HiLook camera on the first try', async () => {
    open([554]);
    const probe = vi.fn<StreamProbe>().mockResolvedValue({ ok: true, video });
    const r = await detectCameraStream(base, probe);
    expect(r).toEqual({ status: 'found', brand: 'Hikvision', port: 554, channel: 1, video });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe.mock.calls[0][0]).toBe('rtsp://admin:secret@10.0.0.5:554/Streaming/Channels/101');
  });

  it('moves on when a pattern is rejected without a 401 (wrong path)', async () => {
    open([554]);
    const probe = vi.fn<StreamProbe>()
      .mockResolvedValueOnce({ ok: false, unauthorized: false })
      .mockResolvedValueOnce({ ok: true, video });
    const r = await detectCameraStream(base, probe);
    expect(r).toMatchObject({ status: 'found', brand: 'Dahua' });
  });

  it('stops after the second 401 so the camera does not lock the account', async () => {
    open([554]);
    const probe = vi.fn<StreamProbe>().mockResolvedValue({ ok: false, unauthorized: true });
    const r = await detectCameraStream(base, probe);
    expect(r).toEqual({ status: 'auth_failed', port: 554 });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('tolerates one 401 from a server that also answers 401 for an unknown path', async () => {
    open([554]);
    const probe = vi.fn<StreamProbe>()
      .mockResolvedValueOnce({ ok: false, unauthorized: true })
      .mockResolvedValueOnce({ ok: true, video });
    expect(await detectCameraStream(base, probe)).toMatchObject({ status: 'found', brand: 'Dahua' });
  });

  it('uses 554 when the given port is the vendor app port (iVMS 8000)', async () => {
    open([554]);
    const probe = vi.fn<StreamProbe>().mockResolvedValue({ ok: true, video: null });
    const r = await detectCameraStream({ ...base, port: 8000 }, probe);
    expect(r).toMatchObject({ status: 'found', port: 554 });
  });

  it('reports unreachable without trying any stream', async () => {
    open([]);
    const probe = vi.fn<StreamProbe>();
    expect(await detectCameraStream(base, probe)).toEqual({ status: 'unreachable', ports: [554] });
    expect(probe).not.toHaveBeenCalled();
  });

  it('tries the chosen brand first', async () => {
    open([554]);
    const probe = vi.fn<StreamProbe>().mockResolvedValue({ ok: true, video: null });
    await detectCameraStream({ ...base, brand: 'Uniview' }, probe);
    expect(probe.mock.calls[0][0]).toContain('/unicast/c1/s0/live');
  });

  it('a 401 on a credentials-in-path pattern is not treated as a wrong password', async () => {
    open([554]);
    const probe = vi.fn<StreamProbe>().mockImplementation(async (url) =>
      url.includes('stream=0.sdp') ? { ok: false, unauthorized: true } : { ok: false, unauthorized: false });
    const r = await detectCameraStream(base, probe);
    expect(r).toEqual({ status: 'not_found', port: 554, tried: ['Hikvision', 'Dahua', 'Uniview', 'Hanwha', 'Tiandy', 'Xiongmai', 'Generic'] });
  });
});

describe('detectCameraStream time budget', () => {
  it('stops trying patterns once the budget is spent', async () => {
    vi.mocked(probeTcpEndpoint).mockResolvedValue({ reachable: true, latencyMs: 1 });
    const probe = vi.fn<StreamProbe>().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { ok: false, unauthorized: false };
    });
    const r = await detectCameraStream({ ipAddress: '10.0.0.5', username: 'a', password: 'b' }, probe, 50);
    expect(r.status).toBe('not_found');
    expect(probe.mock.calls.length).toBeLessThan(7);
  });
});
