import { Prisma } from '@prisma/client';
import { getPrisma } from '../../lib/prisma.js';
import { NotFoundError, ConflictError, ValidationError } from '../../lib/errors.js';
import { builtInDeviceTemplates, setCustomDeviceTemplates, type DeviceVendorTemplate } from '../devices/devices.service.js';

export const MASTERDATA_TYPES = ['camera_status', 'incident_reason', 'incident_root_cause', 'incident_resolution', 'camera_type', 'device_brand', 'device_channel_count', 'device_type', 'camera_brand'] as const;
export type MasterdataType = (typeof MASTERDATA_TYPES)[number];

export async function listMasterdata(params: {
  type: MasterdataType;
  page?: number;
  limit?: number;
  isActive?: boolean;
}) {
  const prisma = getPrisma();
  const page = params.page ?? 1;
  const limit = Math.min(params.limit ?? 50, 200);
  const where: any = { type: params.type };
  if (params.isActive !== undefined) where.isActive = params.isActive;

  const [data, total] = await Promise.all([
    prisma.masterdata.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.masterdata.count({ where }),
  ]);

  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getMasterdataById(id: string) {
  const prisma = getPrisma();
  return prisma.masterdata.findUnique({ where: { id } });
}

export interface CreateMasterdataInput {
  type: MasterdataType;
  code: string;
  nameTh?: string;
  nameEn?: string;
  nameCn?: string;
  nameMm?: string;
  nameJp?: string;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
  isDefault?: boolean;
  config?: Record<string, unknown> | null;
}

export async function createMasterdata(input: CreateMasterdataInput) {
  const prisma = getPrisma();
  if (input.type === 'device_brand') validateBrand(input.code, input.config);
  if (input.type === 'device_channel_count') validateChannelCount(input.code);

  const existing = await prisma.masterdata.findUnique({
    where: {
      type_code: {
        type: input.type,
        code: input.code
      }
    }
  });
  if (existing) {
    throw new ConflictError(`Masterdata item with code '${input.code}' already exists for type '${input.type}'`);
  }

  const isDefault = input.isDefault ?? false;
  if (isDefault) {
    await prisma.masterdata.updateMany({
      where: { type: input.type },
      data: { isDefault: false },
    });
  }

  return prisma.masterdata.create({
    data: {
      type: input.type,
      code: input.code,
      nameTh: input.nameTh,
      nameEn: input.nameEn,
      nameCn: input.nameCn,
      nameMm: input.nameMm,
      nameJp: input.nameJp,
      description: input.description,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
      isDefault,
      ...(input.config ? { config: input.config as object } : {}),
    },
  }).then(afterChange);
}

export interface UpdateMasterdataInput {
  code?: string;
  nameTh?: string;
  nameEn?: string;
  nameCn?: string;
  nameMm?: string;
  nameJp?: string;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
  isDefault?: boolean;
  config?: Record<string, unknown> | null;
}

export async function updateMasterdata(id: string, input: UpdateMasterdataInput) {
  const prisma = getPrisma();

  const existing = await prisma.masterdata.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError('Masterdata', id);
  }

  if (existing.type === 'device_brand') {
    validateBrand(input.code ?? existing.code, input.config !== undefined ? input.config : (existing.config as Record<string, unknown> | null));
  }
  if (existing.type === 'device_channel_count' && input.code !== undefined) validateChannelCount(input.code);

  if (input.code !== undefined && input.code !== existing.code) {
    const uses = await countUses(existing.type, existing.code);
    if (uses > 0) {
      throw new ConflictError(`This value is used by ${uses} records, so its code cannot change`, { code: 'MASTERDATA_IN_USE', uses });
    }
    const conflict = await prisma.masterdata.findUnique({
      where: {
        type_code: {
          type: existing.type,
          code: input.code
        }
      }
    });
    if (conflict) {
      throw new ConflictError(`Masterdata item with code '${input.code}' already exists for type '${existing.type}'`);
    }
  }

  const data: any = {};
  if (input.code !== undefined) data.code = input.code;
  if (input.nameTh !== undefined) data.nameTh = input.nameTh;
  if (input.nameEn !== undefined) data.nameEn = input.nameEn;
  if (input.nameCn !== undefined) data.nameCn = input.nameCn;
  if (input.nameMm !== undefined) data.nameMm = input.nameMm;
  if (input.nameJp !== undefined) data.nameJp = input.nameJp;
  if (input.description !== undefined) data.description = input.description;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.config !== undefined) data.config = input.config ?? Prisma.DbNull;
  if (input.isDefault !== undefined) {
    data.isDefault = input.isDefault;
    if (input.isDefault === true) {
      await prisma.masterdata.updateMany({
        where: { type: existing.type },
        data: { isDefault: false },
      });
    }
  }
  return prisma.masterdata.update({ where: { id }, data }).then(afterChange);
}

export async function deleteMasterdata(id: string) {
  const prisma = getPrisma();
  const existing = await prisma.masterdata.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Masterdata', id);
  const uses = await countUses(existing.type, existing.code);
  if (uses > 0) {
    throw new ConflictError(`This value is used by ${uses} records. Switch it off instead, or change those records first`, { code: 'MASTERDATA_IN_USE', uses });
  }
  return prisma.masterdata.delete({ where: { id } }).then(afterChange);
}


/** Lists a person chooses from on other pages. Readable by anyone who can see cameras. */
export const OPTION_TYPES = ['camera_type', 'camera_brand', 'device_type', 'device_brand', 'device_channel_count'] as const;

export async function listMasterdataOptions(type: (typeof OPTION_TYPES)[number]) {
  return getPrisma().masterdata.findMany({
    where: { type, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    select: { code: true, nameTh: true, nameEn: true, nameCn: true, nameMm: true, nameJp: true, isDefault: true, config: true },
  });
}

const STREAM_PATTERN = /^\/[A-Za-z0-9._~\-/?=&{}%:]*$/;

function validateBrand(code: string, config: Record<string, unknown> | null | undefined) {
  const builtIn = builtInDeviceTemplates().some((t) => t.brand.toLowerCase() === code.toLowerCase());
  const main = config?.mainStreamPattern;
  const sub = config?.subStreamPattern;
  if (builtIn && !main && !sub) return;
  if (typeof main !== 'string' || typeof sub !== 'string') {
    throw new ValidationError('A new brand needs its main and sub stream paths, or the system cannot reach its cameras', { code: 'BRAND_PATTERN_REQUIRED' });
  }
  for (const pattern of [main, sub]) {
    if (!STREAM_PATTERN.test(pattern)) {
      throw new ValidationError('A stream path starts with / and holds no spaces or quotes, e.g. /Streaming/Channels/{channel}01', { code: 'BRAND_PATTERN_INVALID' });
    }
  }
}

function validateChannelCount(code: string) {
  const n = Number(code);
  if (!Number.isInteger(n) || n < 1 || n > 256) {
    throw new ValidationError('The code of a channel count is the number itself, from 1 to 256', { code: 'CHANNEL_COUNT_INVALID' });
  }
}

/** How many records use this value. A value in use cannot be deleted or recoded, only switched off. */
async function countUses(type: string, code: string): Promise<number> {
  const prisma = getPrisma();
  if (type === 'camera_type') return prisma.camera.count({ where: { cameraType: code, deletedAt: null } });
  if (type === 'camera_brand') return prisma.camera.count({ where: { cameraBrand: { equals: code, mode: 'insensitive' }, deletedAt: null } });
  if (type === 'device_type') return prisma.device.count({ where: { deviceType: code } });
  if (type === 'device_brand') return prisma.device.count({ where: { brand: { equals: code, mode: 'insensitive' } } });
  return 0;
}

export async function refreshBrandTemplates() {
  const rows = await getPrisma().masterdata.findMany({ where: { type: 'device_brand' } });
  const templates: DeviceVendorTemplate[] = rows.flatMap((r) => {
    const c = (r.config ?? {}) as Record<string, any>;
    if (!c.mainStreamPattern || !c.subStreamPattern) return [];
    return [{
      brand: r.code,
      label: r.nameEn || r.code,
      defaultRtspPort: Number(c.defaultRtspPort) || 554,
      defaultHttpPort: Number(c.defaultHttpPort) || 80,
      mainStreamPattern: String(c.mainStreamPattern),
      subStreamPattern: String(c.subStreamPattern),
      commonChannels: [1, 4, 8, 16, 32],
      description: r.description ?? '',
    }];
  });
  setCustomDeviceTemplates(templates);
}

async function afterChange<T extends { type: string }>(item: T): Promise<T> {
  if (item.type === 'device_brand') await refreshBrandTemplates();
  return item;
}

const names = (th: string, en: string, cn: string, mm: string, jp: string) => ({ nameTh: th, nameEn: en, nameCn: cn, nameMm: mm, nameJp: jp });

const CAMERA_TYPE_DEFAULTS: Array<[string, ReturnType<typeof names>]> = [
  ['dome', names('โดม', 'Dome', '半球', 'Dome', 'ドーム')],
  ['bullet', names('กระบอก', 'Bullet', '枪机', 'Bullet', 'バレット')],
  ['turret', names('เทอร์เรต', 'Turret', '海螺', 'Turret', 'タレット')],
  ['ptz', names('PTZ (หมุนได้)', 'PTZ', '云台', 'PTZ', 'PTZ')],
  ['fisheye', names('ฟิชอาย 360°', 'Fisheye 360°', '鱼眼 360°', 'Fisheye 360°', '魚眼 360°')],
  ['box', names('กล่อง', 'Box', '枪式', 'Box', 'ボックス')],
];

// A device brand's name can describe its recorders, which says nothing about its cameras.
const cameraBrandNames = (b: { nameTh: string | null; nameEn: string | null; nameCn: string | null; nameMm: string | null; nameJp: string | null }) => {
  const clean = (name: string | null) => name?.replace(/\s*\((?:DVR|XVR)\/NVR\)|\s*\(NetSurveillance\)/, '') ?? null;
  return { nameTh: clean(b.nameTh), nameEn: clean(b.nameEn), nameCn: clean(b.nameCn), nameMm: clean(b.nameMm), nameJp: clean(b.nameJp) };
};

const DEVICE_TYPE_DEFAULTS: Array<[string, ReturnType<typeof names>]> = [
  ['dvr', names('DVR (เครื่องบันทึกแบบสาย Coaxial/BNC)', 'DVR (Digital Video Recorder - Coaxial/BNC)', 'DVR（数字录像机 - 同轴/BNC）', 'DVR (Digital Video Recorder - Coaxial/BNC)', 'DVR（デジタルビデオレコーダー - 同軸/BNC）')],
  ['nvr', names('NVR (เครื่องบันทึกแบบเครือข่าย IP/PoE)', 'NVR (Network Video Recorder - IP/PoE)', 'NVR（网络录像机 - IP/PoE）', 'NVR (Network Video Recorder - IP/PoE)', 'NVR（ネットワークビデオレコーダー - IP/PoE）')],
  ['ip_camera', names('กล้อง IP แบบเดี่ยว', 'Stand-alone IP Camera', '独立 IP 摄像机', 'သီးသန့် IP ကင်မရာ', '単体 IP カメラ')],
  ['other', names('อื่นๆ / ไฮบริด', 'Other / Hybrid', '其他 / 混合', 'အခြား / Hybrid', 'その他 / ハイブリッド')],
];

/** A list starts filled once. After that it belongs to the people using it: nothing here puts a deleted row back. */
export async function ensureMasterdataDefaults() {
  const prisma = getPrisma();
  const empty = async (type: string) => (await prisma.masterdata.count({ where: { type } })) === 0;

  if (await empty('camera_type')) {
    await prisma.masterdata.createMany({
      data: CAMERA_TYPE_DEFAULTS.map(([code, n], i) => ({ type: 'camera_type', code, ...n, sortOrder: (i + 1) * 10 })),
    });
  }
  if (await empty('device_brand')) {
    await prisma.masterdata.createMany({
      data: builtInDeviceTemplates().map((t, i) => ({
        type: 'device_brand',
        code: t.brand,
        ...names(t.label, t.label, t.label, t.label, t.label),
        description: t.description,
        sortOrder: (i + 1) * 10,
        isDefault: t.brand === 'Hikvision',
      })),
    });
  }
  if (await empty('device_channel_count')) {
    await prisma.masterdata.createMany({
      data: [1, 4, 8, 16, 32, 64].map((n, i) => ({
        type: 'device_channel_count',
        code: String(n),
        ...names(`${n} ช่อง`, n === 1 ? '1 channel' : `${n} channels`, `${n} 路`, `ချန်နယ် ${n}`, `${n} チャンネル`),
        sortOrder: (i + 1) * 10,
        isDefault: n === 16,
      })),
    });
  }
  if (await empty('device_type')) {
    await prisma.masterdata.createMany({
      data: DEVICE_TYPE_DEFAULTS.map(([code, n], i) => ({ type: 'device_type', code, ...n, sortOrder: (i + 1) * 10, isDefault: code === 'dvr' })),
    });
  }
  if (await empty('camera_brand')) {
    // Starts from the brands people could already pick, plus anything cameras already hold.
    const brands = await prisma.masterdata.findMany({ where: { type: 'device_brand' }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
    const held = await prisma.camera.findMany({ where: { cameraBrand: { not: null } }, distinct: ['cameraBrand'], select: { cameraBrand: true } });
    const known = new Set(brands.map((b) => b.code.toLowerCase()));
    const extra = held.map((c) => c.cameraBrand as string).filter((code) => !known.has(code.toLowerCase()));
    await prisma.masterdata.createMany({
      data: [
        ...brands.map((b, i) => ({ type: 'camera_brand', code: b.code, ...cameraBrandNames(b), sortOrder: (i + 1) * 10 })),
        ...extra.map((code, i) => ({ type: 'camera_brand', code, ...names(code, code, code, code, code), sortOrder: (brands.length + i + 1) * 10 })),
      ],
    });
  }
  await refreshBrandTemplates();
}
