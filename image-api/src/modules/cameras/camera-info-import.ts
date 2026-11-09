import { getPrisma } from '../../lib/prisma.js';
import { listMasterdataOptions } from '../masterdata/masterdata.service.js';

/**
 * Type, brand and model of many cameras at once, from a sheet filled in walking the site (analog cameras do not
 * report these). Only those three fields change; an empty cell leaves the field as it is. Type and brand must be a
 * master-data entry, given by its code or its Thai or English name.
 */
export interface CameraInfoRow {
  id: string;
  cameraType?: string | null;
  cameraBrand?: string | null;
  cameraModel?: string | null;
}

type Field = 'cameraType' | 'cameraBrand' | 'cameraModel';
export type CameraInfoError = 'NOT_FOUND' | 'UNKNOWN_TYPE' | 'UNKNOWN_BRAND' | 'MODEL_TOO_LONG' | 'DUPLICATE';

export interface CameraInfoResult {
  id: string;
  name: string | null;
  status: 'update' | 'same' | 'error';
  changes: Partial<Record<Field, { from: string | null; to: string }>>;
  errors: CameraInfoError[];
}

const MODEL_MAX = 64;

type Option = { code: string; nameTh: string | null; nameEn: string | null };

/** The master-data code a person meant: its code or its name in Thai or English, in any case. */
export function resolveOption(options: Option[], given: string): string | null {
  const wanted = given.trim().toLowerCase();
  const hit = options.find((o) => [o.code, o.nameTh, o.nameEn].some((n) => n && n.trim().toLowerCase() === wanted));
  return hit ? hit.code : null;
}

const cleanCell = (v: string | null | undefined) => {
  const text = (v ?? '').trim();
  // A cell written as text so Excel would not run it as a formula comes back behind an apostrophe.
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
};

export async function importCameraInfo(rows: CameraInfoRow[], dryRun: boolean) {
  const prisma = getPrisma();
  const [types, brands] = await Promise.all([listMasterdataOptions('camera_type'), listMasterdataOptions('camera_brand')]);
  const ids = [...new Set(rows.map((r) => r.id))];
  const cameras = await prisma.camera.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, name: true, cameraType: true, cameraBrand: true, cameraModel: true },
  });
  const byId = new Map(cameras.map((c) => [c.id, c]));
  const seen = new Set<string>();

  const results: CameraInfoResult[] = rows.map((row) => {
    const camera = byId.get(row.id);
    const result: CameraInfoResult = { id: row.id, name: camera?.name ?? null, status: 'same', changes: {}, errors: [] };
    if (!camera) {
      result.errors.push('NOT_FOUND');
    } else if (seen.has(row.id)) {
      result.errors.push('DUPLICATE');
    }
    seen.add(row.id);
    const type = cleanCell(row.cameraType);
    const brand = cleanCell(row.cameraBrand);
    const model = cleanCell(row.cameraModel);
    const want: Partial<Record<Field, string>> = {};
    if (type) {
      const code = resolveOption(types, type);
      if (code) want.cameraType = code; else result.errors.push('UNKNOWN_TYPE');
    }
    if (brand) {
      const code = resolveOption(brands, brand);
      if (code) want.cameraBrand = code; else result.errors.push('UNKNOWN_BRAND');
    }
    if (model) {
      if (model.length > MODEL_MAX) result.errors.push('MODEL_TOO_LONG'); else want.cameraModel = model;
    }
    if (result.errors.length > 0 || !camera) {
      result.status = 'error';
      return result;
    }
    for (const field of Object.keys(want) as Field[]) {
      const from = camera[field] ?? null;
      if ((from ?? '') !== want[field]) result.changes[field] = { from, to: want[field] as string };
    }
    result.status = Object.keys(result.changes).length > 0 ? 'update' : 'same';
    return result;
  });

  // All or nothing: a sheet with a mistake changes nothing until it is put right.
  const errors = results.filter((r) => r.status === 'error').length;
  const toUpdate = results.filter((r) => r.status === 'update');
  let applied = 0;
  if (!dryRun && errors === 0 && toUpdate.length > 0) {
    await prisma.$transaction(toUpdate.map((r) => prisma.camera.update({
      where: { id: r.id },
      data: Object.fromEntries(Object.entries(r.changes).map(([k, v]) => [k, v!.to])),
    })));
    applied = toUpdate.length;
  }
  return {
    dryRun,
    applied,
    counts: { update: toUpdate.length, same: results.filter((r) => r.status === 'same').length, error: errors },
    results,
  };
}
