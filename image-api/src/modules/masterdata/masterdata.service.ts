import { getPrisma } from '../../lib/prisma.js';
import { NotFoundError, ConflictError } from '../../lib/errors.js';

export const MASTERDATA_TYPES = ['camera_status', 'incident_reason', 'incident_root_cause', 'incident_resolution'] as const;
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
}

export async function createMasterdata(input: CreateMasterdataInput) {
  const prisma = getPrisma();

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
    },
  });
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
}

export async function updateMasterdata(id: string, input: UpdateMasterdataInput) {
  const prisma = getPrisma();

  const existing = await prisma.masterdata.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError('Masterdata', id);
  }

  if (input.code !== undefined && input.code !== existing.code) {
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
  if (input.isDefault !== undefined) {
    data.isDefault = input.isDefault;
    if (input.isDefault === true) {
      await prisma.masterdata.updateMany({
        where: { type: existing.type },
        data: { isDefault: false },
      });
    }
  }
  return prisma.masterdata.update({ where: { id }, data });
}

export async function deleteMasterdata(id: string) {
  const prisma = getPrisma();
  return prisma.masterdata.delete({ where: { id } });
}
