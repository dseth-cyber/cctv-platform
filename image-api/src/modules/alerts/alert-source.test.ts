import { describe, expect, it, vi } from 'vitest';
import { getPrisma } from '../../lib/prisma.js';
import { describeSources } from './alert-source.js';

vi.mock('../../lib/prisma.js', () => ({ getPrisma: vi.fn() }));

const CAM = '11111111-1111-4111-8111-111111111111';
const GONE_CAM = '22222222-2222-4222-8222-222222222222';
const DEV = '33333333-3333-4333-8333-333333333333';
const INC = '44444444-4444-4444-8444-444444444444';
const LOST = '55555555-5555-4555-8555-555555555555';

describe('alert sources in words', () => {
  it('names cameras, recorders, incidents and checks; says when the thing is gone', async () => {
    vi.mocked(getPrisma).mockReturnValue({
      camera: { findMany: vi.fn(async () => [{ id: CAM, name: 'MD - Ch 4', deletedAt: null }, { id: GONE_CAM, name: 'old', deletedAt: new Date() }]) },
      device: { findMany: vi.fn(async () => [{ id: DEV, name: 'MD' }]) },
      cameraIncident: { findMany: vi.fn(async () => [{ id: INC, incidentNumber: 'INC-000042' }]) },
      storageProvider: { findMany: vi.fn(async () => []) },
    } as any);
    const m = await describeSources([CAM, GONE_CAM, DEV, INC, LOST, 'disk_watermark_monitor', 'cam-x', null]);
    expect(m.get(CAM)).toEqual({ kind: 'camera', name: 'MD - Ch 4', link: `/cctv/cameras/${CAM}` });
    expect(m.get(GONE_CAM)).toMatchObject({ kind: 'deleted', name: 'old', link: null });
    expect(m.get(DEV)).toMatchObject({ kind: 'device', name: 'MD' });
    expect(m.get(INC)).toEqual({ kind: 'incident', name: 'INC-000042', link: '/cctv/incidents?incident=INC-000042' });
    expect(m.get(LOST)).toEqual({ kind: 'deleted', name: null, link: null });
    expect(m.get('disk_watermark_monitor')).toMatchObject({ kind: 'system' });
    expect(m.get('cam-x')).toMatchObject({ kind: 'unknown', name: 'cam-x' });
  });
});
