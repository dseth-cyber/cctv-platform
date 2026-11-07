import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { logger } from '../../lib/logger.js';
import { getPrisma } from '../../lib/prisma.js';
import { nextWorkOrderNumber } from '../cameras/camera-incident.service.js';

export const ATTACHMENT_DIR = '/app/incident-attachments';
export const WORK_ORDER_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'] as const;

export class WorkOrderError extends Error {
  constructor(public code: string, public statusCode: number, message: string) {
    super(message);
    this.name = 'WorkOrderError';
  }
}

const text = (max: number) => z.string().trim().max(max).optional().nullable();

export const updateWorkOrderSchema = z.object({
  status: z.enum(WORK_ORDER_STATUSES).optional(),
  vendorCompany: text(200),
  technicianName: text(200),
  contactPhone: text(64),
  scheduledAt: z.iso.datetime().optional().nullable(),
  parts: text(4000),
  cost: z.number().min(0).max(9_999_999_999).optional().nullable(),
  notes: text(4000),
});

export const listWorkOrdersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(WORK_ORDER_STATUSES).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export interface WorkOrderAttachment {
  filename: string;
  originalName: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
}

const WITH_INCIDENT = {
  incident: { select: { id: true, incidentNumber: true, status: true, reason: true, camera: { select: { id: true, name: true } } } },
} as const;

export async function listWorkOrders(params: z.infer<typeof listWorkOrdersSchema>) {
  const prisma = getPrisma();
  const page = params.page ?? 1;
  const limit = params.limit ?? 50;
  const where: Prisma.WorkOrderWhereInput = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.q ? {
      OR: [
        { number: { contains: params.q, mode: 'insensitive' } },
        { vendorCompany: { contains: params.q, mode: 'insensitive' } },
        { technicianName: { contains: params.q, mode: 'insensitive' } },
        { parts: { contains: params.q, mode: 'insensitive' } },
        { incident: { incidentNumber: { contains: params.q, mode: 'insensitive' } } },
        { incident: { camera: { name: { contains: params.q, mode: 'insensitive' } } } },
      ],
    } : {}),
  };
  const [total, data] = await Promise.all([
    prisma.workOrder.count({ where }),
    prisma.workOrder.findMany({ where, include: WITH_INCIDENT, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
  ]);
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getWorkOrder(id: string) {
  const order = await getPrisma().workOrder.findUnique({ where: { id }, include: WITH_INCIDENT });
  if (!order) throw new WorkOrderError('NOT_FOUND', 404, 'Work order not found');
  return order;
}

export async function updateWorkOrder(id: string, input: z.infer<typeof updateWorkOrderSchema>) {
  const prisma = getPrisma();
  const before = await getWorkOrder(id);
  const finishing = input.status === 'completed' && before.status !== 'completed';
  const reopening = input.status !== undefined && input.status !== 'completed' && before.status === 'completed';
  const order = await prisma.workOrder.update({
    where: { id },
    data: {
      ...input,
      scheduledAt: input.scheduledAt === undefined ? undefined : input.scheduledAt ? new Date(input.scheduledAt) : null,
      ...(finishing ? { completedAt: new Date() } : {}),
      ...(reopening ? { completedAt: null } : {}),
    },
    include: WITH_INCIDENT,
  });
  if (input.status) await prisma.cameraIncident.update({ where: { id: before.incidentId }, data: { workOrderStatus: input.status } });
  return order;
}

const ALLOWED_FILES: Array<{ extensions: string[]; contentType: string; startsWith: number[] }> = [
  { extensions: ['.jpg', '.jpeg'], contentType: 'image/jpeg', startsWith: [0xff, 0xd8, 0xff] },
  { extensions: ['.png'], contentType: 'image/png', startsWith: [0x89, 0x50, 0x4e, 0x47] },
  { extensions: ['.webp'], contentType: 'image/webp', startsWith: [0x52, 0x49, 0x46, 0x46] },
  { extensions: ['.pdf'], contentType: 'application/pdf', startsWith: [0x25, 0x50, 0x44, 0x46] },
];

/** Goes by what the file really is, not only what it is called: quotes and photos, nothing that could run in a browser. */
export function allowedFileType(filename: string, content: Buffer) {
  const extension = extname(filename).toLowerCase();
  const type = ALLOWED_FILES.find((f) => f.extensions.includes(extension));
  if (!type || !type.startsWith.every((byte, i) => content[i] === byte)) return null;
  return { extension, contentType: type.contentType };
}

const attachmentsOf = (order: { attachments: unknown }) => (Array.isArray(order.attachments) ? (order.attachments as unknown as WorkOrderAttachment[]) : []);

export async function addAttachment(id: string, originalName: string, content: Buffer, uploadedBy: string) {
  const prisma = getPrisma();
  const order = await getWorkOrder(id);
  const type = allowedFileType(originalName, content);
  if (!type) throw new WorkOrderError('INVALID_TYPE', 400, 'Only JPG, PNG, WEBP and PDF files are allowed');
  if (!existsSync(ATTACHMENT_DIR)) mkdirSync(ATTACHMENT_DIR, { recursive: true });
  const filename = `wo-${id}-${randomUUID()}${type.extension}`;
  await writeFile(join(ATTACHMENT_DIR, filename), content);
  const attachment: WorkOrderAttachment = { filename, originalName: originalName.slice(0, 200), size: content.length, uploadedAt: new Date().toISOString(), uploadedBy };
  await prisma.workOrder.update({ where: { id }, data: { attachments: [...attachmentsOf(order), attachment] as unknown as Prisma.InputJsonValue } });
  return attachment;
}

export async function removeAttachment(id: string, filename: string) {
  const prisma = getPrisma();
  const order = await getWorkOrder(id);
  const list = attachmentsOf(order);
  if (!list.some((a) => a.filename === filename)) throw new WorkOrderError('NOT_FOUND', 404, 'Attachment not found');
  await prisma.workOrder.update({ where: { id }, data: { attachments: list.filter((a) => a.filename !== filename) as unknown as Prisma.InputJsonValue } });
  await unlink(join(ATTACHMENT_DIR, filename)).catch(() => {});
}

/** The file of an attachment this work order really holds. A name not on its list reaches nothing. */
export async function attachmentFile(id: string, filename: string) {
  const order = await getWorkOrder(id);
  const attachment = attachmentsOf(order).find((a) => a.filename === filename);
  const path = attachment ? join(ATTACHMENT_DIR, attachment.filename) : null;
  if (!attachment || !path || !existsSync(path)) throw new WorkOrderError('NOT_FOUND', 404, 'Attachment not found');
  const type = ALLOWED_FILES.find((f) => f.extensions.includes(extname(filename).toLowerCase()));
  return { path, originalName: attachment.originalName, contentType: type?.contentType ?? 'application/octet-stream' };
}

/** Files go when the work orders do: the rows follow their incident, the files have to be removed by hand. */
export async function removeWorkOrderFiles(where: Prisma.WorkOrderWhereInput) {
  const orders = await getPrisma().workOrder.findMany({ where, select: { attachments: true } });
  for (const order of orders) {
    for (const attachment of attachmentsOf(order)) await unlink(join(ATTACHMENT_DIR, attachment.filename)).catch(() => {});
  }
}

/**
 * Work orders used to be two fields on the incident, and could share a number. Gives each one a row of its own
 * and a number of its own. Safe to run every start: it only touches incidents without a row.
 */
export async function ensureWorkOrderRows() {
  const prisma = getPrisma();
  const missing = await prisma.cameraIncident.findMany({
    where: { workOrderNumber: { not: null }, workOrder: null },
    select: { id: true, workOrderNumber: true, workOrderStatus: true, updatedAt: true },
    orderBy: { openedAt: 'asc' },
  });
  for (const incident of missing) {
    const taken = await prisma.workOrder.findUnique({ where: { number: incident.workOrderNumber as string } });
    const number = taken ? await nextWorkOrderNumber() : (incident.workOrderNumber as string);
    await prisma.workOrder.create({
      data: {
        number,
        incidentId: incident.id,
        status: incident.workOrderStatus ?? 'open',
        createdBy: 'migrated',
        completedAt: incident.workOrderStatus === 'completed' ? incident.updatedAt : null,
      },
    });
    if (taken) {
      await prisma.cameraIncident.update({ where: { id: incident.id }, data: { workOrderNumber: number } });
      logger.info({ incidentId: incident.id, from: incident.workOrderNumber, to: number }, 'Renumbered a work order that shared its number');
    }
  }
}
