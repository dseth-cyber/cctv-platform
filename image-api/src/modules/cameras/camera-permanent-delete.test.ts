import { beforeEach, describe, expect, it, vi } from 'vitest';

const impactOf = vi.fn();
const removeFiles = vi.fn();
vi.mock('./camera-deletion.js', () => ({
  cameraDeletionImpact: (...a: unknown[]) => impactOf(...a),
  removeRecordingFiles: (...a: unknown[]) => removeFiles(...a),
}));

const order: string[] = [];
const tx = {
  cameraIncident: { deleteMany: vi.fn(async () => ({})) },
  cameraDailySummary: { deleteMany: vi.fn(async () => ({})) },
  cameraEvent: { deleteMany: vi.fn(async () => ({})) },
  camera: {
    delete: vi.fn(async () => { order.push('db'); return {}; }),
    deleteMany: vi.fn(async ({ where }: any) => { order.push('db'); return { count: where.id.in.length }; }),
  },
};
const prisma = {
  camera: { findUnique: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
};
vi.mock('../../lib/prisma.js', () => ({ getPrisma: () => prisma }));

const { emptyCameraTrash, permanentlyDeleteCamera } = await import('./cameras.service.js');

const impact = (over: object = {}) => ({ clips: 0, recordings: 0, bytes: 0, legalHold: 0, heldCameraIds: [], clipRecords: [], files: [], ...over });

describe('permanently deleting a camera', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    order.length = 0;
    prisma.camera.findUnique.mockResolvedValue({ id: 'c1', name: 'cam' });
    removeFiles.mockImplementation(async (files: string[]) => { order.push('files'); return { removed: files.length, failed: [] }; });
  });

  it('removes the files, and only after the database has let go of them', async () => {
    impactOf.mockResolvedValue(impact({ clips: 1, recordings: 1, files: ['/r/a.mp4', '/r/b.mp4'] }));
    const out = await permanentlyDeleteCamera('c1');
    expect(removeFiles).toHaveBeenCalledWith(['/r/a.mp4', '/r/b.mp4']);
    expect(order).toEqual(['db', 'files']);
    expect(out.files).toEqual({ removed: 2, failed: [] });
  });

  it('refuses while anything is under Legal Hold, and touches nothing', async () => {
    impactOf.mockResolvedValue(impact({ clips: 1, legalHold: 1, heldCameraIds: ['c1'], files: ['/r/a.mp4'] }));
    await expect(permanentlyDeleteCamera('c1')).rejects.toMatchObject({ statusCode: 409, details: { code: 'CAMERA_LEGAL_HOLD', legalHold: 1 } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(removeFiles).not.toHaveBeenCalled();
  });

  it('leaves the files if the database refuses', async () => {
    impactOf.mockResolvedValue(impact({ files: ['/r/a.mp4'] }));
    prisma.$transaction.mockRejectedValueOnce(new Error('db down'));
    await expect(permanentlyDeleteCamera('c1')).rejects.toThrow('db down');
    expect(removeFiles).not.toHaveBeenCalled();
  });
});

describe('emptying the trash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    order.length = 0;
    removeFiles.mockImplementation(async (files: string[]) => ({ removed: files.length, failed: [] }));
  });

  it('keeps cameras holding anything under Legal Hold, and removes the rest with their files', async () => {
    prisma.camera.findMany.mockResolvedValue([{ id: 'held' }, { id: 'free' }]);
    impactOf
      .mockResolvedValueOnce(impact({ legalHold: 1, heldCameraIds: ['held'] }))
      .mockResolvedValueOnce(impact({ clips: 1, files: ['/r/free.mp4'] }));
    const out = await emptyCameraTrash();
    expect(impactOf).toHaveBeenLastCalledWith(['free']);
    expect(tx.camera.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['free'] } } });
    expect(removeFiles).toHaveBeenCalledWith(['/r/free.mp4']);
    expect([out.deleted, out.keptForLegalHold]).toEqual([1, 1]);
  });

  it('does nothing when everything in it is held', async () => {
    prisma.camera.findMany.mockResolvedValue([{ id: 'held' }]);
    impactOf
      .mockResolvedValueOnce(impact({ legalHold: 2, heldCameraIds: ['held'] }))
      .mockResolvedValueOnce(impact());
    const out = await emptyCameraTrash();
    expect(tx.camera.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [] } } });
    expect([out.deleted, out.keptForLegalHold]).toEqual([0, 1]);
  });
});
