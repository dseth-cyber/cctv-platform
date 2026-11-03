import { getPrisma } from '../../lib/prisma.js';
import { getCameraDowntimeReport } from '../cameras/camera-analytics.service.js';
import { getCameraById } from '../cameras/cameras.service.js';
import { escapeHtml } from './telegram-api.js';

function num(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function duration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0 นาที';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${num(h)} ชม. ${m} นาที`;
  return `${m} นาที`;
}

/**
 * Mirrors formatRetentionWindow() in ExecutiveDefectView.tsx — including its choice to
 * drop the leftover days once the span reaches a year, so "2 ปี 3 เดือน" doesn't turn
 * into a false-precision "2 ปี 3 เดือน 14 วัน" on an estimate.
 */
function retentionWindow(days: number | null | undefined): string {
  if (days == null || !isFinite(days) || days <= 0) return '—';
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  const rest = Math.round(days % 365 % 30);
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ปี`);
  if (months > 0) parts.push(`${months} เดือน`);
  if (rest > 0 && years === 0) parts.push(`${rest} วัน`);
  return parts.length ? parts.join(' ') : `${Math.round(days)} วัน`;
}

function thaiTime(d: Date): string {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d) + ' น.';
}

const STATUS_TH: Record<string, string> = {
  active: 'ทำงาน', inactive: 'ไม่ทำงาน', error: 'ข้อผิดพลาด', maintenance: 'ซ่อมบำรุง',
};
const OPERATIONAL_TH: Record<string, string> = {
  online: '🟢 ออนไลน์', offline: '🔴 ออฟไลน์', recovering: '🟡 กำลังกลับมา', unknown: '⚪ ไม่ทราบ',
};
/**
 * Incident reasons are stored as codes ("rtsp_unreachable"). The web report resolves them
 * through i18n; the bot has no per-viewer language, so it reads the same masterdata rows
 * the Telegram alert translator uses — which also means an admin editing the label in
 * Masterdata changes it here too, with no code change.
 */
async function incidentReasonTh(code: string | null | undefined): Promise<string> {
  if (!code || code === '—') return '—';
  const prisma = getPrisma();
  const row = await prisma.masterdata
    .findUnique({ where: { type_code: { type: 'incident_reason', code } } })
    .catch(() => null);
  return row?.nameTh || row?.nameEn || code;
}

const GRADE_TH: Record<string, string> = {
  excellent: 'ดีเยี่ยม', good: 'ดี', warning: 'ต้องเฝ้าระวัง', critical: 'วิกฤต',
};

/** Case-insensitive exact match first, then a unique partial — so "tp27" and "tp2" both work. */
export async function findCameraByName(text: string) {
  const prisma = getPrisma();
  const term = text.trim();
  if (!term) return null;

  const cameras = await prisma.camera.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });
  const exact = cameras.find((c) => c.name.toLowerCase() === term.toLowerCase());
  if (exact) return exact;

  const partial = cameras.filter((c) => c.name.toLowerCase().includes(term.toLowerCase()));
  // Exactly one match is an answer; several is a question, and the caller renders the choices.
  return partial.length === 1 ? partial[0] : null;
}

export async function listCameraNames(): Promise<string[]> {
  const prisma = getPrisma();
  const cameras = await prisma.camera.findMany({
    where: { deletedAt: null }, select: { name: true }, orderBy: { name: 'asc' },
  });
  return cameras.map((c) => c.name);
}

export async function buildCameraReport(cameraId: string): Promise<string> {
  const prisma = getPrisma();
  const cam = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { id: true, name: true, status: true, operationalStatus: true, ipAddress: true, lastPolledAt: true },
  });
  if (!cam) return '❌ ไม่พบกล้องนี้ในระบบ';

  const [report, detail] = await Promise.all([
    getCameraDowntimeReport(cameraId, '7'),
    // Same source as the Camera Reports table — age, incident history, technician and peak-problem hour.
    getCameraById(cameraId),
  ]);

  const lines = [
    `📊 <b>สรุป ${escapeHtml(cam.name)}</b>`,
    '',
    `สถานะ: ${OPERATIONAL_TH[cam.operationalStatus] ?? cam.operationalStatus} · ${STATUS_TH[cam.status] ?? cam.status}`,
    `IP: <code>${escapeHtml(cam.ipAddress ?? '-')}</code>`,
    '',
    `🩺 <b>ความพร้อมใช้งาน (7 วัน)</b>`,
    `Health Score: ${report.healthScore}/100 (${GRADE_TH[report.healthGrade] ?? report.healthGrade})`,
    `Availability: ${report.availability}% (เป้าหมาย ${report.slaTarget}%) ${report.slaMet ? '✅' : '⚠️'}`,
    `Downtime: ${duration(report.downtime.seconds)} · ออฟไลน์ ${num(report.offlineCount)} ครั้ง`,
    `MTBF: ${report.mtbf ? duration(report.mtbf) : '-'} · MTTR: ${report.mttr ? duration(report.mttr) : '-'}`,
  ];

  // Lifetime history, not the 7-day window above — "has this camera always been trouble,
  // and who has been fixing it" is a different question from "how is it doing this week".
  const incidentCount = Number(detail?.incidentCount ?? 0);
  lines.push(
    '',
    '🛠 <b>ประวัติกล้อง (ตลอดอายุการใช้งาน)</b>',
    `อายุกล้อง: ${retentionWindow(Number(detail?.cameraAgeDays ?? 0))}`,
    `จำนวนที่พบปัญหา: ${num(incidentCount)} ครั้ง`,
  );
  if (incidentCount > 0) {
    lines.push(
      `สาเหตุหลัก: ${escapeHtml(await incidentReasonTh(detail?.topReason as string))}`,
      `ช่วงที่พบบ่อย: ${escapeHtml(String(detail?.peakHour ?? '—'))}`,
      `ช่างที่ดูแลหลัก: ${escapeHtml(String(detail?.topTechnician ?? '—'))}`,
    );
  }
  if (cam.lastPolledAt) {
    lines.push(`ตรวจสอบล่าสุด: ${thaiTime(cam.lastPolledAt)}`);
  }

  return lines.join('\n');
}

export async function buildCctvSiteReport(): Promise<string> {
  const prisma = getPrisma();
  const sites = await prisma.site.findMany({
    include: {
      cameras: {
        where: { enabled: true },
        select: { operationalStatus: true },
      },
      _count: { select: { devices: true } },
    },
    orderBy: { name: 'asc' },
  });

  if (sites.length === 0) {
    return '🏢 <b>รายงานไซต์ (Sites):</b> ยังไม่มีไซต์ในระบบ';
  }

  const lines = ['🏢 <b>สถานะกล้องแยกตามไซต์ (Physical Sites)</b>', ''];
  for (const s of sites) {
    const total = s.cameras.length;
    const online = s.cameras.filter((c) => c.operationalStatus === 'online').length;
    const offline = total - online;
    const pct = total > 0 ? Math.round((online / total) * 100) : 100;
    lines.push(
      `• <b>${escapeHtml(s.name)}</b> (<code>${escapeHtml(s.code ?? '-')}</code>):`,
      `  - สุขภาพ: <b>${pct}%</b> (🟢 ${online} / 🔴 ${offline}) จาก ${total} ช่อง`,
      `  - อุปกรณ์: ${s._count.devices} เครื่อง`,
      '',
    );
  }
  return lines.join('\n');
}

export async function buildOverallReport(): Promise<string> {
  const prisma = getPrisma();
  const [devices, cameras, openIncidents] = await Promise.all([
    prisma.device.findMany({ select: { id: true, status: true, totalChannels: true, enabled: true } }),
    prisma.camera.findMany({ where: { enabled: true }, select: { id: true, operationalStatus: true, status: true, rtspUrlSub: true } }),
    prisma.cameraIncident.count({ where: { status: 'open' } }),
  ]);

  const totalDevices = devices.length;
  const activeDevices = devices.filter((d) => d.status === 'active' && d.enabled).length;
  const totalChannels = devices.reduce((sum, d) => sum + (d.totalChannels || 1), 0);

  const totalCameras = cameras.length;
  const onlineCameras = cameras.filter((c) => c.operationalStatus === 'online').length;
  const stalledCameras = cameras.filter((c) => c.operationalStatus === 'unknown').length;
  const offlineCameras = cameras.filter((c) => c.operationalStatus === 'offline').length;
  const maintCameras = cameras.filter((c) => c.status === 'maintenance').length;
  const healthPercent = totalCameras > 0 ? Math.round((onlineCameras / totalCameras) * 100) : 100;

  const estBandwidthMbps = (onlineCameras * 2.5 + cameras.filter((c) => Boolean(c.rtspUrlSub)).length * 0.5).toFixed(1);

  return [
    '📊 <b>สรุปภาพรวมระบบ CCTV Surveillance</b>',
    '',
    `🎥 ช่องสัญญาณทั้งหมด: <b>${num(totalCameras)}</b> ช่อง (รองรับ ${num(totalChannels)} ช่อง)`,
    `🖥 อุปกรณ์ DVR/NVR: <b>${num(activeDevices)}/${num(totalDevices)}</b> เครื่องออนไลน์`,
    `🟢 สตรีมปกติ: <b>${num(onlineCameras)}</b> ช่อง (${healthPercent}% สุขภาพ)`,
    stalledCameras > 0 ? `🟡 ภาพค้าง (Stalled): <b>${num(stalledCameras)}</b> ช่อง` : null,
    offlineCameras > 0 ? `🔴 ออฟไลน์: <b>${num(offlineCameras)}</b> ช่อง` : null,
    maintCameras > 0 ? `🛠 ซ่อมบำรุง: <b>${num(maintCameras)}</b> ช่อง` : null,
    '',
    `⚡ ปริมาณข้อมูลเครือข่ายโดยประมาณ: <b>${estBandwidthMbps} Mbps</b>`,
    `🚨 เหตุการณ์ที่เปิดอยู่ (Open Incidents): <b>${num(openIncidents)}</b> เรื่อง`,
    '',
    '<i>ระบบ CCTV Dev เฝ้าระวังอัตโนมัติตลอด 24 ชม.</i>',
  ].filter(Boolean).join('\n');
}
