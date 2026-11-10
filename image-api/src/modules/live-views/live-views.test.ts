import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '../../lib/prisma.js';
import { createLiveView, createLiveViewSchema, deleteLiveView, listLiveViews, updateLiveView, MAX_VIEWS_PER_USER } from './live-views.service.js';

vi.mock('../../lib/prisma.js', () => ({ getPrisma: vi.fn() }));

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CAM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAM_GONE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const VIEW = '33333333-3333-4333-8333-333333333333';

const view = (over: Record<string, any> = {}) => ({
  id: VIEW, name: 'Gate', layout: '2x2', shared: false, ownerId: ME, updatedAt: new Date(),
  slots: [{ slotIndex: 0, cameraId: CAM_A }], owner: { id: ME, username: 'me' }, ...over,
});

function prismaMock(views: any[] = [], liveCameras = [CAM_A, CAM_B]) {
  const prisma = {
    liveView: {
      findMany: vi.fn().mockResolvedValue(views),
      findUnique: vi.fn().mockResolvedValue(views[0] ?? null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(async ({ data }: any) => ({ id: VIEW, ...data })),
      update: vi.fn(async ({ data }: any) => ({ ...views[0], ...data })),
      delete: vi.fn().mockResolvedValue({}),
    },
    camera: {
      findMany: vi.fn(async ({ where }: any) => where.id.in.filter((id: string) => liveCameras.includes(id)).map((id: string) => ({ id }))),
      count: vi.fn(async ({ where }: any) => where.id.in.filter((id: string) => liveCameras.includes(id)).length),
    },
  };
  vi.mocked(getPrisma).mockReturnValue(prisma as any);
  return prisma;
}

const all = { id: ME, allowed: null, canShare: true };
const limited = { id: ME, allowed: [CAM_A], canShare: false };

describe('live views', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a slot used twice and an unknown layout', () => {
    expect(createLiveViewSchema.safeParse({ name: 'x', layout: '2x2', slots: [{ slotIndex: 0, cameraId: CAM_A }, { slotIndex: 0, cameraId: CAM_B }] }).success).toBe(false);
    expect(createLiveViewSchema.safeParse({ name: 'x', layout: '5x5', slots: [] }).success).toBe(false);
  });

  it('a shared view shows only the cameras this person may see, and drops deleted ones', async () => {
    prismaMock([view({ ownerId: OTHER, shared: true, owner: { id: OTHER, username: 'boss' }, slots: [
      { slotIndex: 0, cameraId: CAM_A }, { slotIndex: 1, cameraId: CAM_B }, { slotIndex: 2, cameraId: CAM_GONE },
    ] })]);
    const [v] = await listLiveViews(limited);
    expect(v.slots).toEqual([{ slotIndex: 0, cameraId: CAM_A }]);
    expect(v.hiddenSlots).toBe(2);
    expect(v.mine).toBe(false);
    expect(v.canEdit).toBe(false);
  });

  it('someone else\'s shared view with nothing visible is left out; own views always show', async () => {
    prismaMock([
      view({ id: 'o', ownerId: OTHER, shared: true, owner: { id: OTHER, username: 'boss' }, slots: [{ slotIndex: 0, cameraId: CAM_B }] }),
      view({ id: 'm', slots: [{ slotIndex: 0, cameraId: CAM_GONE }] }),
    ]);
    const list = await listLiveViews(limited);
    expect(list.map((v) => v.id)).toEqual(['m']);
  });

  it('only someone with the right to change cameras may share', async () => {
    prismaMock();
    await expect(createLiveView(limited, { name: 'x', layout: '1x1', slots: [{ slotIndex: 0, cameraId: CAM_A }], shared: true })).rejects.toThrow(/Sharing/);
    const made = await createLiveView(all, { name: 'x', layout: '1x1', slots: [{ slotIndex: 0, cameraId: CAM_A }], shared: true });
    expect(made.shared).toBe(true);
  });

  it('a view cannot hold a camera outside the person\'s scope, or a deleted one', async () => {
    prismaMock();
    await expect(createLiveView(limited, { name: 'x', layout: '1x1', slots: [{ slotIndex: 0, cameraId: CAM_B }], shared: false })).rejects.toThrow(/may not see/);
    await expect(createLiveView(all, { name: 'x', layout: '1x1', slots: [{ slotIndex: 0, cameraId: CAM_GONE }], shared: false })).rejects.toThrow(/do not exist/);
  });

  it('stops at the per-person limit', async () => {
    const p = prismaMock();
    p.liveView.count.mockResolvedValue(MAX_VIEWS_PER_USER);
    await expect(createLiveView(all, { name: 'x', layout: '1x1', slots: [], shared: false })).rejects.toThrow(/At most/);
  });

  it('someone else\'s private view is not found, and their shared one needs the sharing right', async () => {
    prismaMock([view({ ownerId: OTHER })]);
    await expect(deleteLiveView(all, VIEW)).rejects.toThrow(/not found/i);
    prismaMock([view({ ownerId: OTHER, shared: true })]);
    await expect(deleteLiveView({ ...all, canShare: false }, VIEW)).rejects.toThrow(/Sharing/);
    await expect(deleteLiveView(all, VIEW)).resolves.toMatchObject({ id: VIEW });
  });

  it('the owner may rename their own view but not share it without the right', async () => {
    prismaMock([view()]);
    await expect(updateLiveView(limited, VIEW, { name: 'Gate 2' })).resolves.toMatchObject({ after: { name: 'Gate 2' } });
    await expect(updateLiveView(limited, VIEW, { shared: true })).rejects.toThrow(/Sharing/);
  });
});
