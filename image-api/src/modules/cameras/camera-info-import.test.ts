import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importCameraInfo, resolveOption } from './camera-info-import.js';

const mockPrisma = {
  camera: { findMany: vi.fn(), update: vi.fn((a: unknown) => a) },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
};
vi.mock('../../lib/prisma.js', () => ({ getPrisma: () => mockPrisma }));
vi.mock('../masterdata/masterdata.service.js', () => ({
  listMasterdataOptions: vi.fn(async (type: string) => (type === 'camera_type'
    ? [{ code: 'bullet', nameTh: 'กระบอก', nameEn: 'Bullet' }, { code: 'dome', nameTh: 'โดม', nameEn: 'Dome' }]
    : [{ code: 'Hikvision', nameTh: 'Hikvision / Hilook', nameEn: 'Hikvision / Hilook' }, { code: 'Dahua', nameTh: 'Dahua / IMOU', nameEn: 'Dahua / IMOU' }])),
}));

const CAMS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'MD - Ch 1', cameraType: null, cameraBrand: null, cameraModel: null },
  { id: '22222222-2222-4222-8222-222222222222', name: 'MD - Ch 2', cameraType: 'dome', cameraBrand: 'Hikvision', cameraModel: 'DS-2CE56' },
];

describe('resolveOption', () => {
  it('takes a code or a Thai or English name, in any case', () => {
    const opts = [{ code: 'bullet', nameTh: 'กระบอก', nameEn: 'Bullet' }];
    expect(resolveOption(opts, 'BULLET')).toBe('bullet');
    expect(resolveOption(opts, ' กระบอก ')).toBe('bullet');
    expect(resolveOption(opts, 'box')).toBeNull();
  });
});

describe('importCameraInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.camera.findMany.mockResolvedValue(CAMS);
  });

  it('a dry run says what would change and writes nothing; empty cells leave a field alone', async () => {
    const r = await importCameraInfo([
      { id: CAMS[0].id, cameraType: 'กระบอก', cameraBrand: 'hikvision', cameraModel: 'DS-2CE16D0T' },
      { id: CAMS[1].id, cameraType: '', cameraBrand: 'Hikvision', cameraModel: '' },
    ], true);
    expect(r.counts).toEqual({ update: 1, same: 1, error: 0 });
    expect(r.results[0].changes).toEqual({ cameraType: { from: null, to: 'bullet' }, cameraBrand: { from: null, to: 'Hikvision' }, cameraModel: { from: null, to: 'DS-2CE16D0T' } });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('applies the changes in one transaction', async () => {
    const r = await importCameraInfo([{ id: CAMS[0].id, cameraBrand: 'Dahua / IMOU' }], false);
    expect(r.applied).toBe(1);
    expect(mockPrisma.camera.update).toHaveBeenCalledWith({ where: { id: CAMS[0].id }, data: { cameraBrand: 'Dahua' } });
  });

  it('changes nothing at all while any row has a mistake, and says which', async () => {
    const r = await importCameraInfo([
      { id: CAMS[0].id, cameraBrand: 'Dahua' },
      { id: CAMS[1].id, cameraType: 'spaceship' },
      { id: '33333333-3333-4333-8333-333333333333', cameraModel: 'x' },
      { id: CAMS[0].id, cameraModel: 'y'.repeat(70) },
    ], false);
    expect(r.applied).toBe(0);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(r.results.map((x) => x.errors)).toEqual([[], ['UNKNOWN_TYPE'], ['NOT_FOUND'], ['DUPLICATE', 'MODEL_TOO_LONG']]);
  });

  it('reads a cell Excel was told to keep as text', async () => {
    const r = await importCameraInfo([{ id: CAMS[0].id, cameraModel: "'-12A" }], true);
    expect(r.results[0].changes.cameraModel?.to).toBe('-12A');
  });
});
