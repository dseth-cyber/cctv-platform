import { describe, it, expect, vi, afterEach } from 'vitest';
import { getPrisma } from '../../lib/prisma.js';
import { sealRtspUrl } from '../../lib/rtsp-credentials.js';
import { syncCameraPaths } from './path-sync.js';

describe('MediaMTX camera path sync', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('registers enabled cameras, leaves matching ones and sim/ paths alone, removes stale camera pulls', async () => {
    vi.mocked(getPrisma).mockReturnValue({
      camera: {
        findMany: vi.fn().mockResolvedValue([
          { id: '11111111-1111-1111-1111-111111111111', streamPath: 'cam/gate1', rtspUrl: sealRtspUrl('rtsp://u:p@10.0.0.5/main'), rtspUrlSub: 'rtsp://10.0.0.5/sub' },
          { id: '22222222-2222-2222-2222-222222222222', streamPath: null, rtspUrl: 'rtsp://10.0.0.6/main', rtspUrlSub: null },
          { id: '33333333-3333-3333-3333-333333333333', streamPath: 'sim/ch1', rtspUrl: 'rtsp://10.0.0.7/x', rtspUrlSub: null },
        ]),
      },
    } as any);

    const calls: Array<[string, string]> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push([method, url.replace(/^https?:\/\/[^/]+/, '')]);
      if (url.includes('/v3/config/paths/list')) {
        return new Response(JSON.stringify({ items: [
          { name: 'camera_222222222222', source: 'rtsp://10.0.0.6/main' },   // already right
          { name: 'cam/old', source: 'rtsp://10.0.0.9/main' },              // no camera wants it
          { name: 'sim/ch1', source: 'publisher' },                          // static test generator
          { name: 'all_others', source: '' },
        ] }), { status: 200 });
      }
      return new Response('', { status: 200 });
    }));

    const summary = await syncCameraPaths();

    expect(summary).toEqual({ registered: 2, removed: 1, failed: 0 });
    const writes = calls.filter(([m]) => m !== 'GET').map(([m, u]) => `${m} ${u}`);
    expect(writes).toEqual([
      'POST /v3/config/paths/add/cam/gate1',
      'POST /v3/config/paths/add/cam/gate1_sub',
      'DELETE /v3/config/paths/delete/cam/old',
    ]);
  });
});
