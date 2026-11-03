import { describe, it, expect, vi, afterEach } from 'vitest';
import { MediaMtxService } from './mediamtx.service.js';

describe('MediaMtxService.registerStreamPath', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pulls and records cameras continuously, with image-api credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await MediaMtxService.registerStreamPath('cam/gate1', 'rtsp://10.0.0.5/stream');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/v3\/config\/paths\/add\/cam\/gate1$/);
    expect(JSON.parse(init.body)).toMatchObject({ source: 'rtsp://10.0.0.5/stream', sourceOnDemand: false, record: true });
    expect(init.headers.Authorization).toMatch(/^Basic /);
  });

  it('pulls sub streams on demand and never records them', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await MediaMtxService.registerStreamPath('cam/gate1_sub', 'rtsp://10.0.0.5/sub', { liveOnly: true });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ source: 'rtsp://10.0.0.5/sub', sourceOnDemand: true, record: false });
  });
});
