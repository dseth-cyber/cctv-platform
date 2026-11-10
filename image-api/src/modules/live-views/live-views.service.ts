import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { sortByName } from '../../lib/natural-sort.js';

/** Views one person may keep; shared ones count against their owner too. */
export const MAX_VIEWS_PER_USER = 50;
const LAYOUTS = ['1x1', '2x2', '3x3', '4x4'] as const;

const slotSchema = z.object({ slotIndex: z.number().int().min(0).max(15), cameraId: z.guid() });
const slotsSchema = z.array(slotSchema).max(16).refine(
  (slots) => new Set(slots.map((s) => s.slotIndex)).size === slots.length,
  { message: 'Each slot may be used once' },
);

export const createLiveViewSchema = z.object({
  name: z.string().trim().min(1).max(60),
  layout: z.enum(LAYOUTS),
  slots: slotsSchema,
  shared: z.boolean().default(false),
});

export const updateLiveViewSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  layout: z.enum(LAYOUTS).optional(),
  slots: slotsSchema.optional(),
  shared: z.boolean().optional(),
});

export type CreateLiveViewInput = z.infer<typeof createLiveViewSchema>;
export type UpdateLiveViewInput = z.infer<typeof updateLiveViewSchema>;
type Slot = z.infer<typeof slotSchema>;

/** Who is asking: `allowed` null means every camera; `canShare` is the right to manage team views. */
export interface Viewer { id: string; allowed: string[] | null; canShare: boolean }

/**
 * The person's own views and every shared one. Slots keep only cameras that still exist and that this person may
 * see; `hiddenSlots` says how many were left out, so a shared view never names a camera outside their reach.
 */
export async function listLiveViews(viewer: Viewer) {
  const prisma = getPrisma();
  const views = await prisma.liveView.findMany({
    where: { OR: [{ ownerId: viewer.id }, { shared: true }] },
    include: { owner: { select: { id: true, username: true } } },
  });
  const ids = [...new Set(views.flatMap((v) => (v.slots as Slot[]).map((s) => s.cameraId)))];
  const live = new Set((await prisma.camera.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } })).map((c) => c.id));
  const visible = (id: string) => live.has(id) && (viewer.allowed === null || viewer.allowed.includes(id));

  const out = views.map((v) => {
    const slots = (v.slots as Slot[]);
    const kept = slots.filter((s) => visible(s.cameraId));
    const mine = v.ownerId === viewer.id;
    return {
      id: v.id,
      name: v.name,
      layout: v.layout,
      shared: v.shared,
      slots: kept,
      hiddenSlots: slots.length - kept.length,
      owner: { id: v.owner.id, username: v.owner.username },
      mine,
      canEdit: mine || (v.shared && viewer.canShare),
      updatedAt: v.updatedAt,
    };
  })
    // Someone else's shared view with nothing this person may see is noise.
    .filter((v) => v.mine || v.slots.length > 0);
  // Own views first, then the team's, each by name.
  return [...sortByName(out.filter((v) => v.mine)), ...sortByName(out.filter((v) => !v.mine))];
}

async function assertCamerasVisible(viewer: Viewer, slots: Slot[]) {
  const ids = [...new Set(slots.map((s) => s.cameraId))];
  if (viewer.allowed !== null && ids.some((id) => !viewer.allowed!.includes(id))) {
    throw new ForbiddenError('The view has cameras you may not see');
  }
  const found = await getPrisma().camera.count({ where: { id: { in: ids }, deletedAt: null } });
  if (found !== ids.length) throw new ValidationError('Some cameras do not exist or are in the trash');
}

function assertMayShare(viewer: Viewer) {
  if (!viewer.canShare) throw new ForbiddenError('Sharing a view with the team needs the right to change cameras');
}

export async function createLiveView(viewer: Viewer, input: CreateLiveViewInput) {
  if (input.shared) assertMayShare(viewer);
  await assertCamerasVisible(viewer, input.slots);
  const prisma = getPrisma();
  if ((await prisma.liveView.count({ where: { ownerId: viewer.id } })) >= MAX_VIEWS_PER_USER) {
    throw new ValidationError(`At most ${MAX_VIEWS_PER_USER} views per person; delete one first`);
  }
  return prisma.liveView.create({
    data: { name: input.name, layout: input.layout, slots: input.slots, shared: input.shared, ownerId: viewer.id },
  });
}

async function editable(viewer: Viewer, id: string) {
  const view = await getPrisma().liveView.findUnique({ where: { id } });
  // Someone else's private view does not exist as far as this person is concerned.
  if (!view || (view.ownerId !== viewer.id && !view.shared)) throw new NotFoundError('LiveView', id);
  if (view.ownerId !== viewer.id) assertMayShare(viewer);
  return view;
}

export async function updateLiveView(viewer: Viewer, id: string, input: UpdateLiveViewInput) {
  const view = await editable(viewer, id);
  if (input.shared !== undefined && input.shared !== view.shared) assertMayShare(viewer);
  if (input.slots) await assertCamerasVisible(viewer, input.slots);
  const updated = await getPrisma().liveView.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.layout !== undefined ? { layout: input.layout } : {}),
      ...(input.slots !== undefined ? { slots: input.slots } : {}),
      ...(input.shared !== undefined ? { shared: input.shared } : {}),
    },
  });
  return { before: view, after: updated };
}

export async function deleteLiveView(viewer: Viewer, id: string) {
  const view = await editable(viewer, id);
  await getPrisma().liveView.delete({ where: { id } });
  return view;
}
