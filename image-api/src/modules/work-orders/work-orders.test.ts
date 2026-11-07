import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allowedFileType, ensureWorkOrderRows } from './work-orders.service.js';

const table = {
  cameraIncident: { findMany: vi.fn(), update: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
  workOrder: { findUnique: vi.fn(), create: vi.fn() },
  documentCounter: { update: vi.fn() },
};
vi.mock('../../lib/prisma.js', () => ({ getPrisma: () => table }));

const row = (id: string, number: string, status = 'open') => ({ id, workOrderNumber: number, workOrderStatus: status, updatedAt: new Date('2026-11-01T00:00:00Z') });

describe('ensureWorkOrderRows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    table.workOrder.findUnique.mockResolvedValue(null);
  });

  it('gives each old work order a row', async () => {
    table.cameraIncident.findMany.mockResolvedValue([row('a', 'WO-2026-00001', 'completed')]);
    await ensureWorkOrderRows();
    expect(table.workOrder.create.mock.calls[0][0].data).toMatchObject({ number: 'WO-2026-00001', incidentId: 'a', status: 'completed', createdBy: 'migrated' });
    expect(table.cameraIncident.update).not.toHaveBeenCalled();
  });

  it('gives a new number to one that shared its number', async () => {
    table.cameraIncident.findMany.mockResolvedValue([row('b', 'WO-2026-00002')]);
    table.workOrder.findUnique.mockResolvedValue({ id: 'other' });
    table.documentCounter.update.mockResolvedValue({ value: 9 });
    await ensureWorkOrderRows();
    expect(table.workOrder.create.mock.calls[0][0].data.number).toMatch(/^WO-\d{4}-00009$/);
    expect(table.cameraIncident.update.mock.calls[0][0]).toMatchObject({ where: { id: 'b' }, data: { workOrderNumber: expect.stringMatching(/00009$/) } });
  });

  it('does nothing when every work order has its row', async () => {
    table.cameraIncident.findMany.mockResolvedValue([]);
    await ensureWorkOrderRows();
    expect(table.workOrder.create).not.toHaveBeenCalled();
  });
});

describe('allowedFileType', () => {
  const pdf = Buffer.from('%PDF-1.7 ...');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]);

  it('accepts a quote or a photo', () => {
    expect(allowedFileType('quote.PDF', pdf)).toEqual({ extension: '.pdf', contentType: 'application/pdf' });
    expect(allowedFileType('site.png', png)?.contentType).toBe('image/png');
  });

  it('refuses a file that is not what it is called', () => {
    expect(allowedFileType('quote.pdf', Buffer.from('<html><script>'))).toBeNull();
    expect(allowedFileType('photo.png', pdf)).toBeNull();
  });

  it('refuses kinds that could run in a browser, or anything else', () => {
    expect(allowedFileType('x.svg', Buffer.from('<svg>'))).toBeNull();
    expect(allowedFileType('x.html', pdf)).toBeNull();
    expect(allowedFileType('x.exe', pdf)).toBeNull();
  });
});
