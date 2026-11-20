import { Prisma, type AssetRecord } from '@prisma/client';
import type { ScheduledTask } from 'node-cron';
import cron from 'node-cron';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { getAllConfigs } from '../system-config/system-config.service.js';
import { backupTimeZone, localClock } from '../backup/backup-settings.js';
import { createAlert, dispatchAlertNotifications } from '../alerts/alerts.service.js';
import {
  ageBucket, ageYears, effectiveRecord, FAULT_ALERT_TYPES, isDay, noticeDue, parseNoticeDays, thaiDay, today,
  warrantyEnd, warrantyNoteText, warrantyStatus, type AgeBucket, type WarrantyFrom, type WarrantyStatus,
} from './asset-logic.js';

/**
 * Purchase, warranty and installation of recorders and cameras (phase 5.5): the card on each recorder and camera,
 * the list and report, the warranty notices, and the warranty line on fault alerts.
 * Price is part of a record only for people with assets:price; everyone else neither sees nor changes it.
 */

export type AssetKind = 'device' | 'camera';

const day = z.string().refine(isDay, 'A date is YYYY-MM-DD');
const text = (max: number) => z.string().trim().max(max).transform((v) => (v ? v : null)).nullable().optional();

export const assetInputSchema = z.object({
  purchaseDate: day.nullable().optional(),
  installDate: day.nullable().optional(),
  warrantyMonths: z.number().int().min(0).max(240).nullable().optional(),
  warrantyFrom: z.enum(['purchase', 'install']).optional(),
  warrantyUntil: day.nullable().optional(),
  warrantyManual: z.boolean().optional(),
  vendorCode: text(64),
  installer: text(200),
  poNumber: text(64),
  assetTag: text(64),
  purchasePrice: z.number().min(0).max(9_999_999_999).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type AssetInput = z.infer<typeof assetInputSchema>;

export interface Vendor { code: string; name: string; contactName: string | null; phone: string | null; email: string | null; isActive: boolean }

export interface AssetDto {
  purchaseDate: string | null;
  installDate: string | null;
  warrantyMonths: number | null;
  warrantyFrom: WarrantyFrom;
  warrantyUntil: string | null;
  warrantyManual: boolean;
  vendorCode: string | null;
  installer: string | null;
  poNumber: string | null;
  assetTag: string | null;
  purchasePrice?: number | null;
  notes: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

const dayOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dateOf = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);

export function toDto(r: AssetRecord, canPrice: boolean): AssetDto {
  return {
    purchaseDate: dayOf(r.purchaseDate),
    installDate: dayOf(r.installDate),
    warrantyMonths: r.warrantyMonths,
    warrantyFrom: (r.warrantyFrom === 'install' ? 'install' : 'purchase'),
    warrantyUntil: dayOf(r.warrantyUntil),
    warrantyManual: r.warrantyManual,
    vendorCode: r.vendorCode,
    installer: r.installer,
    poNumber: r.poNumber,
    assetTag: r.assetTag,
    ...(canPrice ? { purchasePrice: r.purchasePrice == null ? null : Number(r.purchasePrice) } : {}),
    notes: r.notes,
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function assetSettings(): Promise<{ noticeDays: number[]; soonDays: number; timeZone: string }> {
  const c = await getAllConfigs();
  const noticeDays = parseNoticeDays(c.asset_warranty_notice_days?.value);
  return { noticeDays, soonDays: Math.max(...noticeDays), timeZone: backupTimeZone() };
}

export async function listVendors(): Promise<Map<string, Vendor>> {
  const rows = await getPrisma().masterdata.findMany({ where: { type: 'vendor' }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
  return new Map(rows.map((r) => {
    const c = (r.config ?? {}) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return [r.code, { code: r.code, name: r.nameTh || r.nameEn || r.code, contactName: s(c.contactName), phone: s(c.phone), email: s(c.email), isActive: r.isActive }];
  }));
}

async function targetExists(kind: AssetKind, id: string): Promise<{ name: string }> {
  const prisma = getPrisma();
  const found = kind === 'device'
    ? await prisma.device.findUnique({ where: { id }, select: { name: true } })
    : await prisma.camera.findFirst({ where: { id, deletedAt: null }, select: { name: true } });
  if (!found) throw new NotFoundError(kind === 'device' ? 'Device' : 'Camera', id);
  return found;
}

const whereOf = (kind: AssetKind, id: string) => (kind === 'device' ? { deviceId: id } : { cameraId: id });

/** The card of one recorder or camera: its own record and, for a channel camera, the recorder's it falls back to. */
export async function getAsset(kind: AssetKind, id: string, canPrice: boolean) {
  const prisma = getPrisma();
  await targetExists(kind, id);
  const own = await prisma.assetRecord.findUnique({ where: whereOf(kind, id) });
  let fromDevice: AssetRecord | null = null;
  let deviceName: string | null = null;
  if (kind === 'camera') {
    const cam = await prisma.camera.findUnique({ where: { id }, select: { deviceId: true, device: { select: { name: true } } } });
    if (cam?.deviceId) {
      fromDevice = await prisma.assetRecord.findUnique({ where: { deviceId: cam.deviceId } });
      deviceName = cam.device?.name ?? null;
    }
  }
  const { record, inherited } = effectiveRecord(own, fromDevice);
  const settings = await assetSettings();
  const vendors = await listVendors();
  const until = record ? dayOf(record.warrantyUntil) : null;
  const now = today(new Date(), settings.timeZone);
  const status = warrantyStatus(until, now, settings.soonDays);
  const vendor = record?.vendorCode ? vendors.get(record.vendorCode) ?? null : null;
  return {
    own: own ? toDto(own, canPrice) : null,
    device: fromDevice ? toDto(fromDevice, canPrice) : null,
    deviceName,
    inherited,
    effective: record ? toDto(record, canPrice) : null,
    warranty: { ...status, until },
    vendor,
    ageYears: record ? ageYears({ installDate: dayOf(record.installDate), purchaseDate: dayOf(record.purchaseDate) }, now) : null,
    canPrice,
  };
}

/** Closes the open warranty notice of one recorder or camera, e.g. when its warranty end was changed. */
async function closeWarrantyAlerts(source: string, by: string): Promise<number> {
  const at = new Date();
  const r = await getPrisma().alert.updateMany({
    where: { alertType: 'warranty_expiring', source, resolvedAt: null, deletedAt: null },
    data: { resolvedAt: at, resolvedBy: by, acknowledgedAt: at, acknowledgedBy: by },
  });
  return r.count;
}

/**
 * Saves the card. Fields left out stay as they are; null clears one. The warranty end is worked out again unless
 * the person typed it. A new end starts its notices over and closes a notice about the old end.
 */
export async function saveAsset(kind: AssetKind, id: string, input: AssetInput, opts: { by: string; canPrice: boolean }) {
  const prisma = getPrisma();
  await targetExists(kind, id);
  if (input.vendorCode) {
    const vendors = await listVendors();
    if (!vendors.has(input.vendorCode)) throw new ValidationError(`Unknown vendor '${input.vendorCode}': add it under Master data → Vendors first`, { code: 'UNKNOWN_VENDOR' });
  }
  const existing = await prisma.assetRecord.findUnique({ where: whereOf(kind, id) });
  const cur = existing ? toDto(existing, true) : null;
  const pick = <K extends keyof AssetInput>(k: K, fallback: unknown) => (input[k] !== undefined ? input[k] : fallback);
  const merged = {
    purchaseDate: pick('purchaseDate', cur?.purchaseDate ?? null) as string | null,
    installDate: pick('installDate', cur?.installDate ?? null) as string | null,
    warrantyMonths: pick('warrantyMonths', cur?.warrantyMonths ?? null) as number | null,
    warrantyFrom: pick('warrantyFrom', cur?.warrantyFrom ?? 'purchase') as WarrantyFrom,
    warrantyManual: pick('warrantyManual', cur?.warrantyManual ?? false) as boolean,
    warrantyUntil: pick('warrantyUntil', cur?.warrantyUntil ?? null) as string | null,
  };
  if (merged.warrantyManual && !merged.warrantyUntil) throw new ValidationError('Type the warranty end date, or let it be worked out from the months', { code: 'WARRANTY_DATE_REQUIRED' });
  const until = warrantyEnd(merged);
  const data = {
    purchaseDate: dateOf(merged.purchaseDate),
    installDate: dateOf(merged.installDate),
    warrantyMonths: merged.warrantyMonths,
    warrantyFrom: merged.warrantyFrom,
    warrantyManual: merged.warrantyManual,
    warrantyUntil: dateOf(until),
    vendorCode: pick('vendorCode', cur?.vendorCode ?? null) as string | null,
    installer: pick('installer', cur?.installer ?? null) as string | null,
    poNumber: pick('poNumber', cur?.poNumber ?? null) as string | null,
    assetTag: pick('assetTag', cur?.assetTag ?? null) as string | null,
    notes: (pick('notes', cur?.notes ?? null) as string | null) || null,
    // Without assets:price the price is neither shown nor changed.
    ...(opts.canPrice && input.purchasePrice !== undefined ? { purchasePrice: input.purchasePrice == null ? null : new Prisma.Decimal(input.purchasePrice) } : {}),
    updatedBy: opts.by,
  };
  const endMoved = (cur?.warrantyUntil ?? null) !== until;
  const saved = await prisma.assetRecord.upsert({
    where: whereOf(kind, id),
    create: { ...whereOf(kind, id), ...data },
    update: { ...data, ...(endMoved ? { warrantyNoticeDays: null } : {}) },
  });
  if (existing && endMoved) await closeWarrantyAlerts(id, opts.by);
  const changed = cur
    ? (Object.keys(data) as (keyof typeof data)[]).filter((k) => k !== 'updatedBy' && JSON.stringify((toDto(saved, true) as any)[k] ?? null) !== JSON.stringify((cur as any)[k] ?? null))
    : ['created'];
  return { record: toDto(saved, opts.canPrice), changed };
}

/** Removes the card; a channel camera then falls back to its recorder's again. */
export async function deleteAsset(kind: AssetKind, id: string, by: string): Promise<boolean> {
  const prisma = getPrisma();
  const r = await prisma.assetRecord.deleteMany({ where: whereOf(kind, id) });
  if (r.count) await closeWarrantyAlerts(id, by);
  return r.count > 0;
}

// ── List and report ───────────────────────────────────────────────────────────

export interface AssetRow {
  kind: AssetKind;
  id: string;
  name: string;
  deviceName: string | null;
  channel: number | null;
  siteName: string | null;
  zoneName: string | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  inherited: boolean;
  record: AssetDto | null;
  warrantyStatus: WarrantyStatus;
  daysLeft: number | null;
  ageYears: number | null;
  ageBucket: AgeBucket;
  vendorName: string | null;
  faults12m: number;
}

/**
 * Every recorder and camera within reach with its effective record. `scope` is the person's camera filter
 * (undefined = everything); a recorder is listed when at least one of its cameras is.
 */
export async function listAssets(scope: Prisma.CameraWhereInput | undefined, canPrice: boolean, now = new Date()): Promise<AssetRow[]> {
  const prisma = getPrisma();
  const settings = await assetSettings();
  const d = today(now, settings.timeZone);
  const cameraWhere: Prisma.CameraWhereInput = { deletedAt: null, ...(scope ? { AND: [scope] } : {}) };
  const cameras = await prisma.camera.findMany({
    where: cameraWhere,
    select: { id: true, name: true, channelNumber: true, cameraBrand: true, cameraModel: true, spec: true, deviceId: true, site: { select: { name: true } }, zone: { select: { name: true } }, device: { select: { name: true } } },
    orderBy: [{ name: 'asc' }],
  });
  const deviceIds = [...new Set(cameras.map((c) => c.deviceId).filter((x): x is string => !!x))];
  const devices = await prisma.device.findMany({
    where: scope ? { id: { in: deviceIds } } : {},
    select: { id: true, name: true, brand: true, model: true, serialNumber: true, site: { select: { name: true } }, zone: { select: { name: true } } },
    orderBy: [{ name: 'asc' }],
  });
  const records = await prisma.assetRecord.findMany({
    where: { OR: [{ deviceId: { in: devices.map((x) => x.id) } }, { cameraId: { in: cameras.map((c) => c.id) } }] },
  });
  const byDevice = new Map(records.filter((r) => r.deviceId).map((r) => [r.deviceId!, r]));
  const byCamera = new Map(records.filter((r) => r.cameraId).map((r) => [r.cameraId!, r]));
  const vendors = await listVendors();

  // Faults in the past 12 months: incidents of a camera; HDD/recording alerts of a recorder.
  const since = new Date(now.getTime() - 365 * 86_400_000);
  const incidents = await prisma.cameraIncident.groupBy({ by: ['cameraId'], where: { createdAt: { gte: since }, cameraId: { in: cameras.map((c) => c.id) } }, _count: { _all: true } });
  const incidentCount = new Map(incidents.map((i) => [i.cameraId, i._count._all]));
  const deviceAlerts = devices.length
    ? await prisma.alert.groupBy({ by: ['source'], where: { createdAt: { gte: since }, alertType: { in: ['hdd_problem', 'recording_stopped'] }, source: { in: devices.map((x) => x.id) } }, _count: { _all: true } })
    : [];
  const deviceFaults = new Map(deviceAlerts.map((a) => [a.source ?? '', a._count._all]));

  const row = (base: Omit<AssetRow, 'record' | 'warrantyStatus' | 'daysLeft' | 'ageYears' | 'ageBucket' | 'vendorName'>, rec: AssetRecord | null): AssetRow => {
    const dto = rec ? toDto(rec, canPrice) : null;
    const st = warrantyStatus(dto?.warrantyUntil ?? null, d, settings.soonDays);
    const age = dto ? ageYears(dto, d) : null;
    return {
      ...base, record: dto, warrantyStatus: st.status, daysLeft: st.daysLeft, ageYears: age, ageBucket: ageBucket(age),
      vendorName: dto?.vendorCode ? vendors.get(dto.vendorCode)?.name ?? dto.vendorCode : null,
    };
  };
  const out: AssetRow[] = devices.map((x) => row({
    kind: 'device', id: x.id, name: x.name, deviceName: null, channel: null, siteName: x.site?.name ?? null, zoneName: x.zone?.name ?? null,
    brand: x.brand, model: x.model, serialNumber: x.serialNumber, inherited: false, faults12m: deviceFaults.get(x.id) ?? 0,
  }, byDevice.get(x.id) ?? null));
  for (const c of cameras) {
    const { record, inherited } = effectiveRecord(byCamera.get(c.id), c.deviceId ? byDevice.get(c.deviceId) : null);
    const spec = (c.spec ?? {}) as Record<string, any>;
    out.push(row({
      kind: 'camera', id: c.id, name: c.name, deviceName: c.device?.name ?? null, channel: c.channelNumber, siteName: c.site?.name ?? null, zoneName: c.zone?.name ?? null,
      brand: c.cameraBrand, model: c.cameraModel, serialNumber: typeof spec.ipCamera?.serialNumber === 'string' ? spec.ipCamera.serialNumber : null, inherited, faults12m: incidentCount.get(c.id) ?? 0,
    }, record));
  }
  return out;
}

/** Counts for the report page. Items are recorders and cameras (a camera counts once, with its own or its recorder's record). */
export function summarize(rows: AssetRow[], d: string) {
  const status: Record<WarrantyStatus, number> = { none: 0, active: 0, expiring: 0, expired: 0 };
  const ages: Record<AgeBucket, number> = { under1: 0, '1to3': 0, '3to5': 0, over5: 0, unknown: 0 };
  const months = new Map<string, number>();
  const horizon = d.slice(0, 7);
  const vendor = new Map<string, { vendor: string; items: number; active: number; expiring: number; expired: number; faults: number; price: number | null }>();
  const model = new Map<string, { brand: string; model: string; items: number; faults: number }>();
  let withRecord = 0;
  for (const r of rows) {
    status[r.warrantyStatus]++;
    ages[r.ageBucket]++;
    if (r.record) withRecord++;
    const until = r.record?.warrantyUntil;
    if (until && until.slice(0, 7) >= horizon) months.set(until.slice(0, 7), (months.get(until.slice(0, 7)) ?? 0) + 1);
    const vName = r.vendorName ?? '—';
    const v = vendor.get(vName) ?? { vendor: vName, items: 0, active: 0, expiring: 0, expired: 0, faults: 0, price: null };
    v.items++;
    if (r.warrantyStatus === 'active') v.active++;
    if (r.warrantyStatus === 'expiring') v.expiring++;
    if (r.warrantyStatus === 'expired') v.expired++;
    v.faults += r.faults12m;
    // Price only once per record: inherited cameras share their recorder's purchase.
    if (r.record?.purchasePrice != null && !r.inherited) v.price = (v.price ?? 0) + r.record.purchasePrice;
    vendor.set(vName, v);
    if (r.brand || r.model) {
      const key = `${r.kind}|${r.brand ?? ''}|${r.model ?? ''}`;
      const m = model.get(key) ?? { brand: r.brand ?? '—', model: r.model ?? '—', items: 0, faults: 0 };
      m.items++;
      m.faults += r.faults12m;
      model.set(key, m);
    }
  }
  const nextMonths = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 12).map(([month, count]) => ({ month, count }));
  const rate = (faults: number, items: number) => (items ? Math.round((faults / items) * 100) / 100 : 0);
  return {
    total: rows.length,
    withRecord,
    status,
    ages,
    expiringByMonth: nextMonths,
    byVendor: [...vendor.values()].map((v) => ({ ...v, faultsPerItem: rate(v.faults, v.items) })).sort((a, b) => b.items - a.items),
    byModel: [...model.values()].map((m) => ({ ...m, faultsPerItem: rate(m.faults, m.items) })).sort((a, b) => b.faultsPerItem - a.faultsPerItem || b.items - a.items).slice(0, 30),
  };
}

export async function assetReport(scope: Prisma.CameraWhereInput | undefined, canPrice: boolean, now = new Date()) {
  const rows = await listAssets(scope, canPrice, now);
  const settings = await assetSettings();
  return { day: today(now, settings.timeZone), soonDays: settings.soonDays, noticeDays: settings.noticeDays, ...summarize(rows, today(now, settings.timeZone)), rows };
}

/** Recorders and cameras with their own card whose warranty ends soon or ended (for the weekly summary). */
export async function warrantyCounts(now = new Date()): Promise<{ expiring: number; expired: number; soonDays: number }> {
  const settings = await assetSettings();
  const d = today(now, settings.timeZone);
  const rows = await getPrisma().assetRecord.findMany({ where: { warrantyUntil: { not: null } }, select: { warrantyUntil: true } });
  let expiring = 0, expired = 0;
  for (const r of rows) {
    const st = warrantyStatus(dayOf(r.warrantyUntil), d, settings.soonDays).status;
    if (st === 'expiring') expiring++;
    if (st === 'expired') expired++;
  }
  return { expiring, expired, soonDays: settings.soonDays };
}

// ── Import from a sheet ───────────────────────────────────────────────────────

export const importRowSchema = z.object({
  kind: z.enum(['device', 'camera']),
  id: z.string().uuid(),
  purchaseDate: z.string().optional(),
  installDate: z.string().optional(),
  warrantyMonths: z.string().optional(),
  warrantyFrom: z.string().optional(),
  warrantyUntil: z.string().optional(),
  vendor: z.string().optional(),
  installer: z.string().optional(),
  poNumber: z.string().optional(),
  assetTag: z.string().optional(),
  purchasePrice: z.string().optional(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

const cell = (v: string | undefined) => {
  const t = (v ?? '').trim();
  return /^'[=+\-@]/.test(t) ? t.slice(1) : t;
};

/** 15/01/2026 (day first, as typed in Thailand; a Buddhist year above 2400 is turned back) or 2026-01-15. */
export function readDay(v: string): string | null {
  if (isDay(v)) return v;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (!m) return null;
  let y = +m[3];
  if (y > 2400) y -= 543;
  const s = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isDay(s) ? s : null;
}

/**
 * Many cards at once from a sheet. An empty cell leaves the field as it is. All or nothing: any error and nothing
 * changes; dryRun only shows what would change.
 */
export async function importAssets(rows: ImportRow[], opts: { dryRun: boolean; by: string; canPrice: boolean }) {
  const prisma = getPrisma();
  const vendors = await listVendors();
  const vendorCode = (given: string) => {
    const w = given.toLowerCase();
    for (const v of vendors.values()) if ([v.code, v.name].some((n) => n.toLowerCase() === w)) return v.code;
    return null;
  };
  const [deviceIds, cameraIds] = [rows.filter((r) => r.kind === 'device').map((r) => r.id), rows.filter((r) => r.kind === 'camera').map((r) => r.id)];
  const [devices, cameras] = await Promise.all([
    prisma.device.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true } }),
    prisma.camera.findMany({ where: { id: { in: cameraIds }, deletedAt: null }, select: { id: true, name: true } }),
  ]);
  const names = new Map([...devices, ...cameras].map((x) => [x.id, x.name]));
  // What each card holds now, so a sheet downloaded and sent back unchanged changes nothing.
  const existing = await prisma.assetRecord.findMany({ where: { OR: [{ deviceId: { in: deviceIds } }, { cameraId: { in: cameraIds } }] } });
  const current = new Map(existing.map((r) => [(r.deviceId ?? r.cameraId)!, toDto(r, true)]));
  const seen = new Set<string>();
  const results = rows.map((r) => {
    const errors: string[] = [];
    const input: AssetInput = {};
    const name = names.get(r.id) ?? null;
    if (!name) errors.push('NOT_FOUND');
    if (seen.has(r.id)) errors.push('DUPLICATE');
    seen.add(r.id);
    for (const key of ['purchaseDate', 'installDate', 'warrantyUntil'] as const) {
      const v = cell(r[key]);
      if (!v) continue;
      const parsed = readDay(v);
      if (parsed) input[key] = parsed; else errors.push(`BAD_DATE:${key}`);
    }
    if (input.warrantyUntil) input.warrantyManual = true;
    const months = cell(r.warrantyMonths);
    if (months) {
      const n = Number(months);
      if (Number.isInteger(n) && n >= 0 && n <= 240) input.warrantyMonths = n; else errors.push('BAD_MONTHS');
    }
    const from = cell(r.warrantyFrom).toLowerCase();
    if (from) {
      if (['purchase', 'ซื้อ', 'วันซื้อ'].includes(from)) input.warrantyFrom = 'purchase';
      else if (['install', 'ติดตั้ง', 'วันติดตั้ง'].includes(from)) input.warrantyFrom = 'install';
      else errors.push('BAD_FROM');
    }
    const vendor = cell(r.vendor);
    if (vendor) {
      const code = vendorCode(vendor);
      if (code) input.vendorCode = code; else errors.push('UNKNOWN_VENDOR');
    }
    for (const [key, max] of [['installer', 200], ['poNumber', 64], ['assetTag', 64]] as const) {
      const v = cell(r[key]);
      if (!v) continue;
      if (v.length > max) errors.push(`TOO_LONG:${key}`); else input[key] = v;
    }
    const price = cell(r.purchasePrice).replace(/,/g, '');
    if (price && opts.canPrice) {
      const n = Number(price);
      if (Number.isFinite(n) && n >= 0) input.purchasePrice = n; else errors.push('BAD_PRICE');
    }
    const now = current.get(r.id);
    for (const key of Object.keys(input) as (keyof AssetInput)[]) {
      const before = now ? (now as any)[key] : undefined;
      const unchanged = now ? before === input[key] : (key === 'warrantyFrom' && input[key] === 'purchase') || (key === 'warrantyManual' && input[key] === false);
      if (unchanged) delete input[key];
    }
    if (input.warrantyManual && !input.warrantyUntil && now?.warrantyManual) delete input.warrantyManual;
    const status = errors.length ? 'error' : Object.keys(input).length ? 'update' : 'same';
    return { kind: r.kind, id: r.id, name, status, fields: Object.keys(input), errors, input };
  });
  const errors = results.filter((r) => r.status === 'error').length;
  const toApply = results.filter((r) => r.status === 'update');
  let applied = 0;
  if (!opts.dryRun && errors === 0) {
    for (const r of toApply) {
      await saveAsset(r.kind, r.id, r.input, { by: opts.by, canPrice: opts.canPrice });
      applied++;
    }
  }
  return {
    dryRun: opts.dryRun,
    applied,
    counts: { update: toApply.length, same: results.filter((r) => r.status === 'same').length, error: errors },
    results: results.map(({ input: _input, ...rest }) => rest),
  };
}

// ── The warranty line on a fault alert ────────────────────────────────────────

/** For an alert about a camera or recorder fault: still covered (and whom to call) or ended. Null when unknown. */
export async function warrantyNoteFor(alertType: string, source: string | null | undefined, now = new Date()): Promise<string | null> {
  if (!source || !FAULT_ALERT_TYPES.has(alertType) || !/^[0-9a-f-]{36}$/i.test(source)) return null;
  const prisma = getPrisma();
  let record: AssetRecord | null = null;
  const camera = await prisma.camera.findUnique({ where: { id: source }, select: { id: true, deviceId: true } }).catch(() => null);
  if (camera) {
    const own = await prisma.assetRecord.findUnique({ where: { cameraId: camera.id } });
    const dev = !own && camera.deviceId ? await prisma.assetRecord.findUnique({ where: { deviceId: camera.deviceId } }) : null;
    record = own ?? dev;
  } else {
    record = await prisma.assetRecord.findUnique({ where: { deviceId: source } }).catch(() => null);
  }
  if (!record?.warrantyUntil) return null;
  const vendors = record.vendorCode ? await listVendors() : new Map<string, Vendor>();
  return warrantyNoteText({ until: dayOf(record.warrantyUntil), day: today(now, backupTimeZone()), vendor: record.vendorCode ? vendors.get(record.vendorCode) ?? null : null });
}

// ── Warranty notices ──────────────────────────────────────────────────────────

/**
 * Every 15 minutes between 08:00 and 20:00 (app time zone): each record whose warranty reaches a notice day gets
 * one alert (the nearest stage only; the last stage is a warning and follows the escalation chains, earlier ones are
 * info). An ended warranty closes its notice and leaves a closed "ended" note. Everything raised in one round goes
 * out as one Telegram message, so a batch bought together does not flood the group.
 */
export async function warrantyTick(now = new Date()): Promise<{ raised: number; told: number }> {
  const prisma = getPrisma();
  const settings = await assetSettings();
  const { hhmm } = localClock(now, settings.timeZone);
  if (hhmm < '08:00' || hhmm > '20:00') return { raised: 0, told: 0 };
  const d = today(now, settings.timeZone);
  const records = await prisma.assetRecord.findMany({
    where: { warrantyUntil: { not: null } },
    include: { device: { select: { id: true, name: true } }, camera: { select: { id: true, name: true, deletedAt: true } } },
  });
  const vendors = await listVendors();
  const lastStage = Math.min(...settings.noticeDays);
  const lines: { stage: number; text: string }[] = [];
  let raised = 0;
  for (const r of records) {
    if (r.camera?.deletedAt) continue;
    const until = dayOf(r.warrantyUntil)!;
    const due = noticeDue(until, d, settings.noticeDays, r.warrantyNoticeDays);
    if (!due) continue;
    const source = r.deviceId ?? r.cameraId!;
    const name = r.device?.name ?? r.camera?.name ?? source;
    const what = r.deviceId ? 'เครื่องบันทึก' : 'กล้อง';
    const vendor = r.vendorCode ? vendors.get(r.vendorCode) : null;
    const who = vendor ? ` · ${vendor.name}${vendor.phone ? ` โทร ${vendor.phone}` : ''}` : '';
    const st = warrantyStatus(until, d, settings.soonDays);
    if (due.stage === 0) {
      await closeWarrantyAlerts(source, 'system');
      if (!due.quiet) {
        await createAlert({
          alertType: 'warranty_expiring', severity: 'info', source, skipNotify: true, skipDedup: true, closeOnCreate: true,
          title: `Warranty ended: ${name}`,
          message: `ประกัน${what} ${name} หมดแล้วเมื่อ ${thaiDay(until)}${who}`,
          details: { warrantyUntil: until, stage: 0 },
        });
        lines.push({ stage: 0, text: `⛔ ${name} (${what}) หมดแล้ว ${thaiDay(until)}${who}` });
      }
    } else {
      const severity = due.stage === lastStage ? 'warning' : 'info';
      const title = `Warranty ends in ${st.daysLeft} days: ${name}`;
      const message = `ประกัน${what} ${name} จะหมด ${thaiDay(until)} (อีก ${st.daysLeft} วัน)${who} — ต่อประกัน เปลี่ยน หรือรับทราบว่าไม่ต่อ แล้วกด "แก้ไขแล้ว"`;
      const open = await prisma.alert.findFirst({ where: { alertType: 'warranty_expiring', source, resolvedAt: null, deletedAt: null } });
      if (open) {
        await prisma.alert.update({ where: { id: open.id }, data: { severity, title, message, details: { ...((open.details ?? {}) as object), warrantyUntil: until, stage: due.stage } } });
      } else {
        await createAlert({ alertType: 'warranty_expiring', severity, source, skipNotify: true, skipDedup: true, title, message, details: { warrantyUntil: until, stage: due.stage } });
      }
      lines.push({ stage: due.stage, text: `${severity === 'warning' ? '⚠️' : 'ℹ️'} ${name} (${what}) หมด ${thaiDay(until)} อีก ${st.daysLeft} วัน${who}` });
    }
    await prisma.assetRecord.update({ where: { id: r.id }, data: { warrantyNoticeDays: due.stage } });
    raised++;
  }
  if (lines.length) {
    const MAX = 30;
    const sorted = lines.sort((a, b) => a.stage - b.stage);
    const body = sorted.slice(0, MAX).map((l) => l.text);
    if (sorted.length > MAX) body.push(`…และอีก ${sorted.length - MAX} รายการ`);
    const anyWarning = sorted.some((l) => l.stage === 0 || l.stage === lastStage);
    await dispatchAlertNotifications({
      alertType: 'warranty_expiring',
      severity: anyWarning ? 'warning' : 'info',
      title: `ประกันอุปกรณ์ใกล้หมด/หมดแล้ว ${sorted.length} รายการ`,
      message: `${body.join('\n')}\nดูทั้งหมดที่ รายงาน → ทรัพย์สินและการรับประกัน`,
      bypassCooldown: true,
    });
  }
  return { raised, told: lines.length };
}

let task: ScheduledTask | null = null;
let ticking = false;

export function startWarrantyNotices(): void {
  if (task) return;
  task = cron.schedule('*/15 * * * *', () => {
    if (ticking) return;
    ticking = true;
    warrantyTick().catch((err) => logger.error({ err }, 'Warranty notice round failed')).finally(() => { ticking = false; });
  });
  logger.info('Warranty notices started (recorders and cameras with a warranty end)');
}

export function stopWarrantyNotices(): void {
  task?.stop();
  task = null;
}

const FLAG = 'asset_defaults_ready';

/** Once: the alert rule that tells the Telegram group about warranty notices. Removing it later is the admin's choice. */
export async function ensureAssetDefaults(): Promise<{ created: boolean }> {
  const prisma = getPrisma();
  if (await prisma.systemConfig.findUnique({ where: { key: FLAG } })) return { created: false };
  if (!(await prisma.alertRule.count({ where: { alertType: 'warranty_expiring' } }))) {
    await prisma.alertRule.create({
      data: { name: 'ประกันอุปกรณ์ใกล้หมด', alertType: 'warranty_expiring', description: 'แจ้งกลุ่ม Telegram เมื่อประกันเครื่องบันทึก/กล้องใกล้หมดหรือหมดแล้ว (วันแจ้งตั้งที่ asset_warranty_notice_days)', enabled: true, condition: {}, cooldownMinutes: 60, notificationChannels: ['telegram'] },
    });
  }
  await prisma.systemConfig.create({ data: { key: FLAG, value: 'true', valueType: 'boolean', category: 'internal', description: 'Asset defaults created (warranty alert rule)' } });
  return { created: true };
}
