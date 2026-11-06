import { describe, it, expect, vi, afterEach } from 'vitest';
import { getPrisma } from '../../lib/prisma.js';
import { sealRtspUrl } from '../../lib/rtsp-credentials.js';
import { syncCameraPaths } from './path-sync.js';

describe('MediaMTX camera path sync', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('registers enabled cameras by recording mode, leaves matching ones and sim/ paths alone, removes stale camera pulls', async () => {
    vi.mocked(getPrisma).mockReturnValue({
      camera: {
        findMany: vi.fn().mockResolvedValue([
          { id: '11111111-1111-1111-1111-111111111111', streamPath: 'cam/gate1', rtspUrl: sealRtspUrl('rtsp://u:p@10.0.0.5/main'), rtspUrlSub: 'rtsp://10.0.0.5/sub', recordingMode: 'live_only' },
          { id: '22222222-2222-2222-2222-222222222222', streamPath: null, rtspUrl: 'rtsp://10.0.0.6/main', rtspUrlSub: null, recordingMode: 'continuous' },
          { id: '33333333-3333-3333-3333-333333333333', streamPath: 'sim/ch1', rtspUrl: 'rtsp://10.0.0.7/x', rtspUrlSub: null, recordingMode: 'live_only' },
        ]),
      },
    } as any);

    const calls: Array<[string, string]> = [];
    const bodies: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push([method, url.replace(/^https?:\/\/[^/]+/, '')]);
      if (init?.body) bodies[url.replace(/^.*\/paths\/add\//, '')] = JSON.parse(String(init.body));
      if (url.includes('/v3/config/paths/list')) {
        return new Response(JSON.stringify({ items: [
          { name: 'camera_222222222222', source: 'rtsp://10.0.0.6/main', sourceOnDemand: false, record: true },   // already right
          { name: 'cam/old', source: 'rtsp://10.0.0.9/main' },              // no camera wants it
          { name: 'sim/ch1', source: 'publisher' },                          // static test generator
          { name: 'dvrpb_abc', source: 'rtsp://10.0.0.9/Streaming/tracks/101' }, // someone is watching a recording
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
    // live_only main and every sub stream: pulled on demand, never recorded
    expect(bodies['cam/gate1']).toEqual({ source: 'rtsp://u:p@10.0.0.5/main', sourceOnDemand: true, record: false });
    expect(bodies['cam/gate1_sub']).toEqual({ source: 'rtsp://10.0.0.5/sub', sourceOnDemand: true, record: false });
  });

  it('re-registers a path when the camera switches recording mode', async () => {
    vi.mocked(getPrisma).mockReturnValue({
      camera: { findMany: vi.fn().mockResolvedValue([
        { id: '44444444-4444-4444-4444-444444444444', streamPath: 'cam/door', rtspUrl: 'rtsp://10.0.0.8/main', rtspUrlSub: null, recordingMode: 'continuous' },
      ]) },
    } as any);
    const posts: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/v3/config/paths/list')) {
        return new Response(JSON.stringify({ items: [
          { name: 'cam/door', source: 'rtsp://10.0.0.8/main', sourceOnDemand: true, record: false },
        ] }), { status: 200 });
      }
      if (init?.body) posts.push(JSON.parse(String(init.body)));
      return new Response('', { status: 200 });
    }));

    expect(await syncCameraPaths()).toEqual({ registered: 1, removed: 0, failed: 0 });
    expect(posts[0]).toEqual({ source: 'rtsp://10.0.0.8/main', sourceOnDemand: false, record: true });
  });
});
