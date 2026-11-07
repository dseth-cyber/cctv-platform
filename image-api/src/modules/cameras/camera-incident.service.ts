import { getPrisma } from '../../lib/prisma.js';
import { redactRtspUrl } from '../../lib/rtsp-credentials.js';

const numberOf = (documentNumber: string | null | undefined) => Number(documentNumber?.split('-')[2] ?? 0) || 0;

/**
 * The next number in a series. The counter only goes up, so a deleted record's number is never used again.
 * It starts from the highest number already known, including ones only the audit log still remembers.
 */
export async function nextDocumentNumber(key: string, highestKnown: () => Promise<number>): Promise<number> {
  const prisma = getPrisma();
  const increment = async () => (await prisma.documentCounter.update({ where: { key }, data: { value: { increment: 1 } } })).value;
  try {
    return await increment();
  } catch (err: any) {
    if (err?.code !== 'P2025') throw err;
  }
  try {
    return (await prisma.documentCounter.create({ data: { key, value: (await highestKnown()) + 1 } })).value;
  } catch (err: any) {
    // Someone else started the series in that moment.
    if (err?.code !== 'P2002') throw err;
    return increment();
  }
}

async function generateIncidentNumber(): Promise<string> {
  const prisma = getPrisma();
  const prefix = `INC-${new Date().getFullYear()}-`;
  const next = await nextDocumentNumber(prefix.slice(0, -1), async () => {
    const latest = await prisma.cameraIncident.findFirst({
      where: { incidentNumber: { startsWith: prefix } },
      orderBy: { incidentNumber: 'desc' },
      select: { incidentNumber: true },
    });
    const logged = await prisma.auditLog.findMany({ where: { description: { contains: prefix } }, select: { description: true } });
    const pattern = new RegExp(`${prefix}(\\d+)`);
    const fromLog = logged.map((row) => Number(row.description?.match(pattern)?.[1] ?? 0));
    return Math.max(numberOf(latest?.incidentNumber), ...fromLog);
  });
  return `${prefix}${String(next).padStart(6, '0')}`;
}

export async function createIncident(data: {
  cameraId: string;
  eventId?: bigint;
  fromStatus: string;
  toStatus: string;
  reason: string;
  rootCause?: string;
  description?: string;
  problemDesc?: string;
  estimatedFinish?: string;
  priority?: string;
  impact?: string;
  assignedTo?: string;
  attachments?: any[];
  openedBy: string;
  observers?: any[];
  detectionSource?: string;
  rootCauseConfidence?: string;
}) {
  const prisma = getPrisma();
  const incidentNumber = await generateIncidentNumber();

  return prisma.cameraIncident.create({
    data: {
      incidentNumber,
      cameraId: data.cameraId,
      eventId: data.eventId ?? null,
      fromStatus: data.fromStatus,
      toStatus: data.toStatus,
      reason: data.reason,
      rootCause: data.rootCause,
      description: data.description,
      problemDesc: data.problemDesc,
      estimatedFinish: data.estimatedFinish ? new Date(data.estimatedFinish) : null,
      priority: data.priority ?? 'medium',
      impact: data.impact ?? 'none',
      assignedTo: data.assignedTo,
      workflowStage: data.assignedTo ? 'assigned' : 'unassigned',
      attachments: data.attachments ?? [],
      observers: data.observers ?? [],
      openedBy: data.openedBy,
      status: 'open',
      detectionSource: data.detectionSource,
      rootCauseConfidence: data.rootCauseConfidence,
    },
  });
}

const VALID_WORKFLOW_STAGES = ['unassigned', 'assigned', 'in_progress', 'waiting_parts', 'waiting_vendor'];

export async function updateIncidentWorkflow(id: string, data: {
  assignedTo?: string | null;
  workflowStage?: string;
  acknowledge?: boolean;
  acknowledgedBy?: string;
}) {
  const prisma = getPrisma();
  const incident = await prisma.cameraIncident.findUnique({ where: { id } });
  if (!incident) throw new Error('Incident not found');

  const updateData: Record<string, any> = {};
  if (data.assignedTo !== undefined) {
    updateData.assignedTo = data.assignedTo || null;
  }
  if (data.workflowStage !== undefined) {
    if (!VALID_WORKFLOW_STAGES.includes(data.workflowStage)) throw new Error('Invalid workflow stage');
    updateData.workflowStage = data.workflowStage;
  } else if (data.assignedTo !== undefined) {
    // No explicit stage given — infer it from the assignment change.
    updateData.workflowStage = data.assignedTo ? (incident.workflowStage === 'unassigned' ? 'assigned' : incident.workflowStage) : 'unassigned';
  }
  // Acknowledge is distinct from assignment — it only means "someone has seen this",
  // not "someone owns fixing it". Only set once; re-acknowledging is a no-op.
  if (data.acknowledge && !incident.acknowledgedAt) {
    updateData.acknowledgedAt = new Date();
    updateData.acknowledgedBy = data.acknowledgedBy ?? null;
  }

  return prisma.cameraIncident.update({ where: { id }, data: updateData });
}

export async function resolveIncident(id: string, data: {
  resolution?: string;
  rootCause?: string;
  correctiveAction?: string;
  preventiveAction?: string;
  resolutionDesc?: string;
  closedBy: string;
  autoResolved?: boolean;
}) {
  const prisma = getPrisma();
  const incident = await prisma.cameraIncident.findUnique({ where: { id } });
  if (!incident) throw new Error('Incident not found');

  return prisma.cameraIncident.update({
    where: { id },
    data: {
      resolution: data.resolution,
      rootCause: data.rootCause || incident.rootCause,
      correctiveAction: data.correctiveAction,
      preventiveAction: data.preventiveAction,
      resolutionDesc: data.resolutionDesc,
      closedBy: data.closedBy,
      closedAt: new Date(),
      actualFinish: new Date(),
      status: 'resolved',
      autoResolved: data.autoResolved ?? false,
    },
  });
}

/**
 * The camera dropped again soon after its incident closed itself: carry on with that incident instead of
 * opening another. One closed by a person stays closed, since someone decided it was finished.
 */
export async function reopenRecentIncident(cameraId: string, withinMinutes: number) {
  if (withinMinutes <= 0) return null;
  const prisma = getPrisma();
  const recent = await prisma.cameraIncident.findFirst({
    where: { cameraId, status: 'resolved', autoResolved: true, closedAt: { gte: new Date(Date.now() - withinMinutes * 60_000) } },
    orderBy: { closedAt: 'desc' },
  });
  if (!recent) return null;
  return prisma.cameraIncident.update({
    where: { id: recent.id },
    data: {
      status: 'open',
      closedAt: null,
      closedBy: null,
      actualFinish: null,
      resolution: null,
      autoResolved: false,
      reopenCount: { increment: 1 },
      lastReopenedAt: new Date(),
    },
  });
}

export class VerificationError extends Error {
  constructor(public code: string, public statusCode: number, message: string) {
    super(message);
    this.name = 'VerificationError';
  }
}

interface VerificationEntry {
  at: string;
  by: string;
  action: 'submitted' | 'approved' | 'approved_own' | 'rejected';
  note?: string;
}

const logOf = (incident: { verificationLog?: unknown }) => (Array.isArray(incident.verificationLog) ? (incident.verificationLog as unknown as VerificationEntry[]) : []);

/**
 * The person doing the work says it is finished. It waits there for someone else to check, and counts as finished
 * from now for the repair time, so a slow check is not held against whoever did the work.
 */
export async function submitForVerification(id: string, data: {
  resolution?: string;
  rootCause?: string;
  correctiveAction?: string;
  preventiveAction?: string;
  resolutionDesc?: string;
  submittedBy: string;
}) {
  const prisma = getPrisma();
  const incident = await prisma.cameraIncident.findUnique({ where: { id } });
  if (!incident) throw new VerificationError('NOT_FOUND', 404, 'Incident not found');
  if (incident.status !== 'open') throw new VerificationError('NOT_OPEN', 409, 'This incident is not open');
  const now = new Date();
  return prisma.cameraIncident.update({
    where: { id },
    data: {
      resolution: data.resolution,
      rootCause: data.rootCause || incident.rootCause,
      correctiveAction: data.correctiveAction,
      preventiveAction: data.preventiveAction,
      resolutionDesc: data.resolutionDesc,
      closedBy: data.submittedBy,
      closedAt: now,
      actualFinish: now,
      status: 'pending',
      autoResolved: false,
      verificationNote: null,
      verificationLog: [...logOf(incident), { at: now.toISOString(), by: data.submittedBy, action: 'submitted' }] as never,
    },
  });
}

/**
 * Someone else checks the work. Nobody approves their own work, except an administrator who says why, for a site
 * with one person on it. Sending work back closes nothing, so anyone with the right to check can do that.
 */
export async function verifyIncident(id: string, input: { decision: 'approve' | 'reject'; note?: string; user: { username: string; role?: string } }) {
  const prisma = getPrisma();
  const incident = await prisma.cameraIncident.findUnique({ where: { id } });
  if (!incident) throw new VerificationError('NOT_FOUND', 404, 'Incident not found');
  if (incident.status !== 'pending') throw new VerificationError('NOT_PENDING', 409, 'This incident is not waiting to be checked');
  const note = input.note?.trim() || undefined;
  const now = new Date();
  const by = input.user.username;

  if (input.decision === 'reject') {
    if (!note) throw new VerificationError('REASON_REQUIRED', 400, 'Say why the work is being sent back');
    return prisma.cameraIncident.update({
      where: { id },
      data: {
        status: 'open',
        closedAt: null,
        closedBy: null,
        actualFinish: null,
        workflowStage: 'in_progress',
        verificationNote: note,
        verificationLog: [...logOf(incident), { at: now.toISOString(), by, action: 'rejected', note }] as never,
      },
    });
  }

  const own = incident.closedBy === by;
  if (own && input.user.role !== 'admin') throw new VerificationError('SELF_VERIFY', 403, 'Someone else has to check this work');
  if (own && !note) throw new VerificationError('REASON_REQUIRED', 400, 'Say why you are approving your own work');
  return prisma.cameraIncident.update({
    where: { id },
    data: {
      status: 'resolved',
      verifiedBy: by,
      verifiedAt: now,
      verificationNote: note ?? null,
      verificationLog: [...logOf(incident), { at: now.toISOString(), by, action: own ? 'approved_own' : 'approved', ...(note ? { note } : {}) }] as never,
    },
  });
}

export async function getIncidents(params: {
  cameraId?: string;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const prisma = getPrisma();
  const page = params.page ?? 1;
  const limit = params.limit ?? 20;
  const where: any = {};
  if (params.cameraId) where.cameraId = params.cameraId;
  if (params.status) where.status = params.status;

  const [total, data] = await Promise.all([
    prisma.cameraIncident.count({ where }),
    prisma.cameraIncident.findMany({
      where,
      orderBy: { openedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { camera: { select: { name: true } } },
    }),
  ]);

  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getIncident(id: string) {
  const prisma = getPrisma();
  const incident = await prisma.cameraIncident.findUnique({
    where: { id },
    include: {
      camera: {
        select: {
          id: true,
          name: true,
          ipAddress: true,
          rtspUrl: true,
          status: true,
          operationalStatus: true,
          device: { select: { id: true, name: true, ipAddress: true, rtspPort: true } },
        },
      },
      event: true,
    },
  });
  if (incident?.camera) {
    incident.camera.rtspUrl = redactRtspUrl(incident.camera.rtspUrl);
  }
  return incident;
}

export async function getOpenIncidentForCamera(cameraId: string) {
  const prisma = getPrisma();
  return prisma.cameraIncident.findFirst({
    where: { cameraId, status: 'open' },
    orderBy: { openedAt: 'desc' },
  });
}

const INCIDENT_SORT_FIELDS: Record<string, (dir: 'asc' | 'desc') => any> = {
  incidentNumber: (dir) => ({ incidentNumber: dir }),
  cameraName: (dir) => ({ camera: { name: dir } }),
  reason: (dir) => ({ reason: dir }),
  rootCause: (dir) => ({ rootCause: dir }),
  priority: (dir) => ({ priority: dir }),
  status: (dir) => ({ status: dir }),
  openedAt: (dir) => ({ openedAt: dir }),
  openedBy: (dir) => ({ openedBy: dir }),
  assignedTo: (dir) => ({ assignedTo: dir }),
};

// Enhanced list with filters
export async function searchIncidents(params: {
  siteId?: string; zoneId?: string;
  q?: string; cameraId?: string; reason?: string; rootCause?: string;
  status?: string; priority?: string; page?: number; limit?: number;
  sortBy?: string; sortDir?: 'asc' | 'desc';
}) {
  const prisma = getPrisma();
  const page = params.page ?? 1;
  const limit = params.limit ?? 20;
  const where: any = {};
  if (params.siteId || params.zoneId) {
    where.camera = { ...(params.siteId ? { siteId: params.siteId } : {}), ...(params.zoneId ? { zoneId: params.zoneId } : {}) };
  }
  if (params.cameraId) where.cameraId = params.cameraId;
  if (params.reason) where.reason = params.reason;
  if (params.rootCause) where.rootCause = params.rootCause;
  if (params.status) where.status = params.status;
  if (params.priority) where.priority = params.priority;
  if (params.q) {
    where.OR = [
      { incidentNumber: { contains: params.q, mode: 'insensitive' } },
      { problemDesc: { contains: params.q, mode: 'insensitive' } },
      { resolutionDesc: { contains: params.q, mode: 'insensitive' } },
      { description: { contains: params.q, mode: 'insensitive' } },
    ];
  }
  const dir = params.sortDir ?? 'desc';
  const orderBy = params.sortBy && INCIDENT_SORT_FIELDS[params.sortBy]
    ? INCIDENT_SORT_FIELDS[params.sortBy](dir)
    : { openedAt: 'desc' };
  const [total, data] = await Promise.all([
    prisma.cameraIncident.count({ where }),
    prisma.cameraIncident.findMany({
      where, orderBy,
      skip: (page - 1) * limit, take: limit,
      include: { camera: { select: { name: true } } },
    }),
  ]);
  // compute MTTR per incident (closedAt - openedAt); still-open incidents get a live duration instead.
  const mapped = data.map((i: any) => ({
    ...i,
    cameraName: i.camera?.name ?? '',
    mttrMinutes: i.closedAt ? Math.round((new Date(i.closedAt).getTime() - new Date(i.openedAt).getTime()) / 60000) : null,
    openDurationMinutes: i.closedAt ? null : Math.round((Date.now() - new Date(i.openedAt).getTime()) / 60000),
  }));
  return { data: mapped, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

// Knowledge Base aggregations
export async function getIncidentKnowledge(params: { cameraId?: string; days?: number }) {
  const prisma = getPrisma();
  const where: any = {};
  if (params.cameraId) where.cameraId = params.cameraId;
  if (params.days) where.openedAt = { gte: new Date(Date.now() - params.days * 86400000) };

  const incidents: any[] = await prisma.cameraIncident.findMany({ where, include: { camera: { select: { name: true } } } });

  // Top problems (by reason)
  const reasonCount: Record<string, number> = {};
  const rootCauseCount: Record<string, number> = {};
  const resolutionCount: Record<string, number> = {};
  const cameraCount: Record<string, { name: string; count: number }> = {};
  let totalMttr = 0, mttrCount = 0;

  for (const i of incidents) {
    if (i.reason) reasonCount[i.reason] = (reasonCount[i.reason] ?? 0) + 1;
    if (i.rootCause) rootCauseCount[i.rootCause] = (rootCauseCount[i.rootCause] ?? 0) + 1;
    if (i.resolution) resolutionCount[i.resolution] = (resolutionCount[i.resolution] ?? 0) + 1;
    cameraCount[i.cameraId] = { name: (i as any).camera?.name ?? '', count: (cameraCount[i.cameraId]?.count ?? 0) + 1 };
    if (i.closedAt) { totalMttr += (new Date(i.closedAt).getTime() - new Date(i.openedAt).getTime()) / 60000; mttrCount++; }
  }

  const toSorted = (obj: Record<string, number>) =>
    Object.entries(obj).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);

  return {
    total: incidents.length,
    open: incidents.filter(i => i.status === 'open').length,
    resolved: incidents.filter(i => i.status === 'resolved').length,
    avgMttrMinutes: mttrCount > 0 ? Math.round(totalMttr / mttrCount) : null,
    topProblems: toSorted(reasonCount).slice(0, 8),
    topRootCauses: toSorted(rootCauseCount).slice(0, 8),
    topResolutions: toSorted(resolutionCount).slice(0, 8),
    frequentCameras: Object.entries(cameraCount).map(([id, v]) => ({ cameraId: id, name: v.name, count: v.count })).sort((a, b) => b.count - a.count).slice(0, 8),
  };
}

// Related incidents (same reason or rootCause)
export async function getRelatedIncidents(incidentId: string) {
  const prisma = getPrisma();
  const inc = await prisma.cameraIncident.findUnique({ where: { id: incidentId } });
  if (!inc) return [];
  const related = await prisma.cameraIncident.findMany({
    where: {
      id: { not: incidentId },
      OR: [{ reason: inc.reason }, ...(inc.rootCause ? [{ rootCause: inc.rootCause }] : [])],
    },
    orderBy: { openedAt: 'desc' }, take: 10,
    include: { camera: { select: { name: true } } },
  });
  return related.map((i: any) => ({ ...i, cameraName: i.camera?.name ?? '' }));
}

// Resolution suggestions: given a reason/rootCause, what resolutions worked
export async function getResolutionStats(params: { reason?: string; rootCause?: string }) {
  const prisma = getPrisma();
  const where: any = { status: 'resolved' };
  if (params.reason) where.reason = params.reason;
  if (params.rootCause) where.rootCause = params.rootCause;
  const resolved = await prisma.cameraIncident.findMany({ where, select: { resolution: true } });
  const counts: Record<string, number> = {};
  for (const r of resolved) { if (r.resolution) counts[r.resolution] = (counts[r.resolution] ?? 0) + 1; }
  return {
    total: resolved.length,
    resolutions: Object.entries(counts).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
  };
}

// --- P21: Maintenance Work Order ---
/** The next work order number. Exported for moving old work orders across, which can need a fresh one. */
export async function nextWorkOrderNumber(): Promise<string> {
  const prisma = getPrisma();
  const prefix = `WO-${new Date().getFullYear()}-`;
  const next = await nextDocumentNumber(prefix.slice(0, -1), async () => {
    const latest = await prisma.cameraIncident.findFirst({
      where: { workOrderNumber: { startsWith: prefix } },
      orderBy: { workOrderNumber: 'desc' },
      select: { workOrderNumber: true },
    });
    return numberOf(latest?.workOrderNumber);
  });
  return `${prefix}${String(next).padStart(5, '0')}`;
}

export async function createWorkOrder(incidentId: string, username: string) {
  const prisma = getPrisma();
  const inc = await prisma.cameraIncident.findUnique({ where: { id: incidentId } });
  if (!inc) throw new Error('Incident not found');
  if (inc.workOrderNumber) return inc;
  const workOrderNumber = await nextWorkOrderNumber();
  await prisma.workOrder.create({ data: { number: workOrderNumber, incidentId, status: 'open', createdBy: username } });
  return prisma.cameraIncident.update({
    where: { id: incidentId },
    data: { workOrderNumber, workOrderStatus: 'open' },
  });
}

export async function updateWorkOrderStatus(incidentId: string, status: string) {
  const prisma = getPrisma();
  const before = await prisma.workOrder.findUnique({ where: { incidentId }, select: { status: true } });
  await prisma.workOrder.updateMany({
    where: { incidentId },
    data: { status, ...(status === 'completed' && before?.status !== 'completed' ? { completedAt: new Date() } : {}), ...(status !== 'completed' ? { completedAt: null } : {}) },
  });
  return prisma.cameraIncident.update({ where: { id: incidentId }, data: { workOrderStatus: status } });
}

export async function getIncidentOptions() {
  const prisma = getPrisma();
  const [reasons, rootCauses, resolutions] = await Promise.all([
    prisma.masterdata.findMany({ where: { type: 'incident_reason', isActive: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.masterdata.findMany({ where: { type: 'incident_root_cause', isActive: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.masterdata.findMany({ where: { type: 'incident_resolution', isActive: true }, orderBy: { sortOrder: 'asc' } }),
  ]);
  return { reasons, rootCauses, resolutions };
}

/**
 * Executive rollup: which problems stop machines the most. Incidents opened in
 * the last `days`, grouped by reason — count, cumulative downtime, still-open
 * count, and the machines affected — so the biggest recurring cause is obvious.
 */
export async function getTopIncidentCauses(days: number) {
  const prisma = getPrisma();
  const now = Date.now();
  const start = new Date(now - days * 24 * 60 * 60 * 1000);

  const [incidents, cameras, reasons] = await Promise.all([
    prisma.cameraIncident.findMany({
      where: { openedAt: { gte: start } },
      select: { reason: true, cameraId: true, openedAt: true, closedAt: true, status: true },
    }),
    prisma.camera.findMany({ select: { id: true, name: true } }),
    prisma.masterdata.findMany({
      where: { type: 'incident_reason' },
      select: { code: true, nameTh: true, nameEn: true },
    }),
  ]);

  const cameraName = new Map(cameras.map((c) => [c.id, c.name]));
  const reasonLabel = new Map(reasons.map((r) => [r.code, r.nameTh || r.nameEn || r.code]));

  type Agg = { count: number; open: number; downtimeMs: number; machines: Set<string> };
  const byReason = new Map<string, Agg>();
  for (const inc of incidents) {
    const agg = byReason.get(inc.reason) ?? { count: 0, open: 0, downtimeMs: 0, machines: new Set() };
    agg.count++;
    if (inc.status === 'open') agg.open++;
    const end = inc.closedAt ? inc.closedAt.getTime() : now;
    agg.downtimeMs += Math.max(0, end - inc.openedAt.getTime());
    agg.machines.add(cameraName.get(inc.cameraId) ?? inc.cameraId);
    byReason.set(inc.reason, agg);
  }

  const causes = [...byReason.entries()]
    .map(([reason, a]) => ({
      reason,
      label: reasonLabel.get(reason) ?? reason,
      count: a.count,
      open: a.open,
      downtimeHours: Math.round((a.downtimeMs / 3600000) * 10) / 10,
      machines: [...a.machines].sort(),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return { days, totalIncidents: incidents.length, causes };
}

/**
 * Executive trend: incidents per month over the last `months` — count, resolved,
 * average MTTR (closed incidents) and cumulative downtime hours. Shows whether
 * repairs are getting faster and machine-stops rarer.
 */
export async function getIncidentMonthlyTrend(months: number) {
  const prisma = getPrisma();
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

  const incidents = await prisma.cameraIncident.findMany({
    where: { openedAt: { gte: since } },
    select: { openedAt: true, closedAt: true, status: true },
  });

  type Bucket = { count: number; resolved: number; mttrMsSum: number; downtimeMs: number };
  const byMonth = new Map<string, Bucket>();
  // Zero-fill so quiet months show as zero instead of vanishing.
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1) + i, 1);
    byMonth.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      { count: 0, resolved: 0, mttrMsSum: 0, downtimeMs: 0 });
  }
  const nowMs = now.getTime();
  for (const inc of incidents) {
    const key = `${inc.openedAt.getFullYear()}-${String(inc.openedAt.getMonth() + 1).padStart(2, '0')}`;
    const b = byMonth.get(key);
    if (!b) continue;
    b.count++;
    const end = inc.closedAt ? inc.closedAt.getTime() : nowMs;
    b.downtimeMs += Math.max(0, end - inc.openedAt.getTime());
    if (inc.closedAt) {
      b.resolved++;
      b.mttrMsSum += Math.max(0, inc.closedAt.getTime() - inc.openedAt.getTime());
    }
  }

  const trend = [...byMonth.entries()].map(([month, b]) => ({
    month,
    count: b.count,
    resolved: b.resolved,
    avgMttrHours: b.resolved > 0 ? Math.round((b.mttrMsSum / b.resolved / 3600000) * 10) / 10 : 0,
    downtimeHours: Math.round((b.downtimeMs / 3600000) * 10) / 10,
  }));

  return { months, trend };
}
