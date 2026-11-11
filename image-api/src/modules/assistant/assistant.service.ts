import os from 'node:os';
import fs from 'node:fs';
import type { FastifyRequest } from 'fastify';
import { getPrisma } from '../../lib/prisma.js';
import { allowedAlertSources, allowedCameraIds, cameraWhere } from '../access/camera-scope.js';
import { getUserPermissions } from '../../middleware/rbac.js';
import { getAllConfigs } from '../system-config/system-config.service.js';
import { diskProblems } from '../devices/device-health.service.js';
import { getCameraComparisonReport } from '../cameras/camera-analytics.service.js';
import { getBackupStatus } from '../backup/backup.service.js';
import { MediaMtxService } from '../media/mediamtx.service.js';
import { detectIntent, findCamera, findPage, normalize, periodOf, type Intent } from './assistant-intent.js';
import { findHowTo } from './assistant-howto.js';

/**
 * The in-app assistant. Every figure comes from this system's own data, read with the asker's rights and camera
 * scope; nothing is sent anywhere. Problems come with what to do about them.
 */
export interface Item { label: string; value?: string; tone?: 'bad' | 'warn' | 'ok'; link?: string; hint?: string }
export type Action = { kind: 'navigate'; label: string; path: string } | { kind: 'live'; label: string; cameraId: string; cameraName: string };
export interface Answer { intent: Intent; title: string; text?: string; items?: Item[]; steps?: string[]; actions?: Action[]; suggestions: string[] }

type Lang = 'th' | 'en';
const MAX_ITEMS = 15;

const REASON: Record<string, { th: string; en: string; fixTh: string; fixEn: string }> = {
  no_signal: { th: 'ไม่มีสัญญาณภาพ', en: 'No signal', fixTh: 'ตรวจสาย/ไฟ/กล้องที่หน้างาน ถ้าช่องนี้ไม่มีกล้องให้ปิดช่อง', fixEn: 'Check cable, power and camera on site; switch the channel off if it has no camera' },
  recorder_offline: { th: 'เครื่องบันทึกไม่ตอบ', en: 'Recorder not answering', fixTh: 'ตรวจไฟและสาย LAN ของ DVR/NVR', fixEn: 'Check the recorder\'s power and LAN' },
  recorder_lost_camera: { th: 'เครื่องบันทึกติดต่อกล้องไม่ได้', en: 'Recorder lost the camera', fixTh: 'ตรวจ PoE/สาย และรหัสผ่านกล้องในหน้าเว็บ NVR', fixEn: 'Check PoE/cable and the camera password on the NVR' },
  unreachable: { th: 'ติดต่อเครือข่ายไม่ได้', en: 'Unreachable', fixTh: 'ตรวจเครือข่ายและ IP ของกล้อง', fixEn: 'Check the network and the camera IP' },
  stream_dropped: { th: 'สตรีมขาด', en: 'Stream dropped', fixTh: 'มักกลับมาเอง ถ้าบ่อยให้ดูสายและบิตเรต', fixEn: 'Usually returns; if frequent check cable and bitrate' },
  status_set: { th: 'ตั้งสถานะไม่ทำงาน', en: 'Set to inactive', fixTh: 'มีคนตั้งสถานะไว้ เปลี่ยนในหน้ากล้อง', fixEn: 'Someone set it; change it on the Cameras page' },
  unknown: { th: 'ยังไม่ทราบสาเหตุ', en: 'Unknown', fixTh: 'เปิดดูสดหรือดูหน้าเว็บเครื่องบันทึก', fixEn: 'Open it live or the recorder\'s web page' },
};
const ALERT_KIND: Record<string, { th: string; en: string }> = {
  camera_offline: { th: 'กล้องออฟไลน์', en: 'Camera offline' }, disk_space: { th: 'พื้นที่ดิสก์', en: 'Disk space' },
  storage_warning: { th: 'พื้นที่จัดเก็บใกล้เต็ม', en: 'Storage warning' }, retention_violation: { th: 'การเก็บไฟล์ผิดนโยบาย', en: 'Retention' },
  hdd_problem: { th: 'HDD มีปัญหา', en: 'HDD problem' }, recording_stopped: { th: 'เครื่องหยุดบันทึก', en: 'Recording stopped' },
  clock_drift: { th: 'เวลาเครื่องบันทึกเพี้ยน', en: 'Recorder clock off' }, incident_escalation: { th: 'Incident ถูกยกระดับ', en: 'Incident escalation' },
  auth_anomaly: { th: 'Login ผิดปกติ', en: 'Suspicious sign-in' },
};
const DISK: Record<string, { th: string; en: string }> = {
  no_disk: { th: 'ไม่พบ HDD', en: 'No HDD' }, disk_fault: { th: 'HDD ผิดปกติ', en: 'HDD fault' },
  disk_smart: { th: 'SMART ไม่ผ่าน', en: 'SMART failing' }, disk_hot: { th: 'HDD ร้อน', en: 'HDD hot' },
};

interface Ctx { request: FastifyRequest; lang: Lang; perms: string[]; allowed: string[] | null; text: string }
const L = (c: Ctx, th: string, en: string) => (c.lang === 'th' ? th : en);
const can = (c: Ctx, perm: string) => c.perms.includes('*') || c.perms.includes(perm);
const fmtMin = (c: Ctx, m: number | null | undefined) => (m === null || m === undefined ? '—' : m >= 60 ? L(c, `${(m / 60).toFixed(1)} ชม.`, `${(m / 60).toFixed(1)} h`) : L(c, `${Math.round(m)} นาที`, `${Math.round(m)} min`));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n * 100) / 100}%`);

async function scopedCameras(c: Ctx) {
  const scope = await cameraWhere(c.request);
  return getPrisma().camera.findMany({
    where: { deletedAt: null, enabled: true, ...(scope ? { AND: [scope] } : {}) },
    select: { id: true, name: true, channelNumber: true, operationalStatus: true, operationalReason: true, deviceId: true, device: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
}

async function visibleDevices(c: Ctx) {
  const prisma = getPrisma();
  let where: any = {};
  if (c.allowed !== null) {
    const ids = (await prisma.camera.findMany({ where: { id: { in: c.allowed } }, select: { deviceId: true } })).map((x) => x.deviceId).filter(Boolean);
    where = { id: { in: ids as string[] } };
  }
  return prisma.device.findMany({ where, select: { id: true, name: true, ipAddress: true, healthInfo: true, healthCheckedAt: true }, orderBy: { name: 'asc' } });
}

function deviceProblems(c: Ctx, d: { healthInfo: any }, clockLimit: number): Array<{ text: string; fix: string; tone: 'bad' | 'warn' }> {
  const h = d.healthInfo;
  if (!h) return [];
  const out: Array<{ text: string; fix: string; tone: 'bad' | 'warn' }> = [];
  if (h.loginLockedUntil && new Date(h.loginLockedUntil).getTime() > Date.now()) out.push({ text: L(c, 'บัญชีถูกล็อก (รหัสผิดหลายครั้ง)', 'Account locked (wrong passwords)'), fix: L(c, 'รอพ้นเวลาล็อก ระบบลองใหม่เอง', 'Wait for the lock to end; it retries by itself'), tone: 'bad' });
  else if (h.loginFailed) out.push({ text: L(c, 'รหัสผ่านผิด', 'Wrong password'), fix: L(c, 'แก้รหัสในหน้าอุปกรณ์ แล้วกดตรวจตอนนี้', 'Fix the password on Devices, then Check now'), tone: 'bad' });
  else if (h.reachable === false) out.push({ text: L(c, 'ติดต่อเครื่องไม่ได้', 'Unreachable'), fix: L(c, 'ตรวจไฟและสาย LAN', 'Check power and LAN'), tone: 'bad' });
  for (const p of diskProblems(h.disks ?? [])) out.push({ text: DISK[p]?.[c.lang] ?? p, fix: L(c, 'ตรวจ/เปลี่ยน HDD ที่ตัวเครื่อง', 'Check or replace the HDD'), tone: 'bad' });
  const noneAtAll = h.reachable && h.oldestRecording === null && (h.notRecording ?? []).length > 0;
  if (noneAtAll) out.push({ text: L(c, 'ไม่พบไฟล์บันทึกเลย', 'No recordings at all'), fix: L(c, 'ตรวจตารางบันทึกและ HDD ที่ตัวเครื่อง', 'Check schedule and HDD on the recorder'), tone: 'bad' });
  else if ((h.notRecording ?? []).length > 0) out.push({ text: L(c, `ไม่บันทึก ช่อง ${(h.notRecording as any[]).map((x) => x.channel).join(', ')}`, `Not recording on channel ${(h.notRecording as any[]).map((x) => x.channel).join(', ')}`), fix: L(c, 'ตรวจตารางบันทึก/quota ของช่อง', 'Check the channel\'s schedule/quota'), tone: 'bad' });
  if (clockLimit > 0 && typeof h.clockDriftSeconds === 'number' && Math.abs(h.clockDriftSeconds) > clockLimit) out.push({ text: L(c, `เวลาเพี้ยน ${Math.round(h.clockDriftSeconds)} วินาที`, `Clock off by ${Math.round(h.clockDriftSeconds)} s`), fix: L(c, 'ตั้ง NTP ในแผงสุขภาพเครื่อง', 'Set NTP in the health panel'), tone: 'warn' });
  return out;
}

const nav = (c: Ctx, path: string, th: string, en: string, perm = 'cameras:read'): Action[] => (can(c, perm) ? [{ kind: 'navigate', label: L(c, th, en), path }] : []);

const SUGGEST = {
  th: ['สรุปสถานะวันนี้', 'กล้องไหนออฟไลน์', 'เครื่องบันทึกมีปัญหาไหม', 'กล้องที่หลุดบ่อย 7 วัน', 'ความพร้อมใช้งาน 30 วัน', 'Incident ที่ยังเปิด', 'เก็บย้อนหลังได้กี่วัน', 'ภาพสดไม่ขึ้นทุกกล้องแก้ยังไง'],
  en: ['Today\'s status', 'Which cameras are offline', 'Any recorder problems', 'Cameras dropping most, 7 days', 'Availability, 30 days', 'Open incidents', 'How many days do recorders keep', 'No live picture anywhere: what to do'],
};
const sugg = (c: Ctx, pick: number[]) => pick.map((i) => SUGGEST[c.lang][i]);

export async function answer(request: FastifyRequest, text: string, lang: Lang): Promise<Answer> {
  const user = (request as any).user;
  const c: Ctx = { request, lang, perms: await getUserPermissions(user?.id), allowed: await allowedCameraIds(request), text };
  let intent = detectIntent(text);
  if (intent === 'howto' && findHowTo(text).length === 0) intent = findPage(text) ? 'navigate' : 'help';
  const prisma = getPrisma();
  const configs = await getAllConfigs();
  const clockLimit = Number(configs.device_clock_drift_alert_seconds?.value ?? 0);

  switch (intent) {
    case 'summary': {
      const cams = await scopedCameras(c);
      const devices = await visibleDevices(c);
      const camIds = cams.map((x) => x.id);
      const offline = cams.filter((x) => x.operationalStatus === 'offline').length;
      const reached = devices.filter((d) => (d.healthInfo as any)?.reachable === true).length;
      const withProblems = devices.filter((d) => deviceProblems(c, d, clockLimit).length > 0).length;
      const [openInc, pendingInc, openWo] = await Promise.all([
        prisma.cameraIncident.count({ where: { status: 'open', cameraId: { in: camIds } } }),
        prisma.cameraIncident.count({ where: { status: 'pending', cameraId: { in: camIds } } }),
        prisma.workOrder.count({ where: { status: { in: ['open', 'in_progress'] }, incident: { cameraId: { in: camIds } } } }),
      ]);
      const sources = await allowedAlertSources(request);
      const openAlerts = can(c, 'alerts:read') ? await prisma.alert.count({ where: { deletedAt: null, resolvedAt: null, ...(sources ? { source: { in: sources } } : {}) } }) : null;
      return {
        intent, title: L(c, 'สรุปสถานะตอนนี้', 'Status now'),
        items: [
          { label: L(c, 'กล้องออนไลน์', 'Cameras online'), value: `${cams.length - offline} / ${cams.length}`, tone: offline ? 'warn' : 'ok', link: '/cctv/cameras' },
          { label: L(c, 'กล้องออฟไลน์', 'Cameras offline'), value: String(offline), tone: offline ? 'bad' : 'ok' },
          { label: L(c, 'เครื่องบันทึกติดต่อได้', 'Recorders reached'), value: `${reached} / ${devices.length}`, tone: reached < devices.length ? 'warn' : 'ok', link: '/cctv/devices' },
          { label: L(c, 'เครื่องบันทึกที่มีปัญหา', 'Recorders with problems'), value: String(withProblems), tone: withProblems ? 'bad' : 'ok' },
          { label: L(c, 'Incident ที่เปิด / รอตรวจรับ', 'Incidents open / awaiting check'), value: `${openInc} / ${pendingInc}`, tone: openInc ? 'warn' : 'ok', link: '/cctv/incidents' },
          { label: L(c, 'ใบงานค้าง', 'Open work orders'), value: String(openWo), link: '/cctv/work-orders' },
          ...(openAlerts !== null ? [{ label: L(c, 'แจ้งเตือนที่ยังไม่ปิด', 'Unresolved alerts'), value: String(openAlerts), tone: openAlerts ? 'warn' as const : 'ok' as const, link: '/cctv/alerts' }] : []),
        ],
        suggestions: sugg(c, [1, 2, 3, 5]),
      };
    }
    case 'offline_cameras': {
      const cams = (await scopedCameras(c)).filter((x) => x.operationalStatus === 'offline');
      return {
        intent, title: cams.length ? L(c, `กล้องออฟไลน์ ${cams.length} ตัว`, `${cams.length} cameras offline`) : L(c, 'ไม่มีกล้องออฟไลน์', 'No camera offline'),
        items: cams.slice(0, MAX_ITEMS).map((x) => {
          const r = REASON[x.operationalReason ?? 'unknown'] ?? REASON.unknown;
          return { label: x.name, value: r[lang], tone: 'bad' as const, hint: lang === 'th' ? r.fixTh : r.fixEn, link: `/cctv/cameras/${x.id}` };
        }),
        text: cams.length > MAX_ITEMS ? L(c, `และอีก ${cams.length - MAX_ITEMS} ตัว`, `and ${cams.length - MAX_ITEMS} more`) : undefined,
        actions: nav(c, '/cctv/cameras', 'เปิดหน้าจัดการกล้อง', 'Open Cameras'),
        suggestions: [L(c, 'กล้องออฟไลน์แก้ยังไง', 'Camera offline: how to fix'), ...sugg(c, [3, 2])],
      };
    }
    case 'recorder_problems':
    case 'not_recording':
    case 'clock': {
      const devices = await visibleDevices(c);
      const rows = devices.flatMap((d) => deviceProblems(c, d, clockLimit)
        .filter((p) => intent === 'recorder_problems' || (intent === 'clock' ? /เวลา|Clock/.test(p.text) : /บันทึก|record/i.test(p.text)))
        .map((p) => ({ label: d.name, value: p.text, tone: p.tone, hint: p.fix, link: '/cctv/devices' })));
      const title = intent === 'clock' ? L(c, 'เวลาเครื่องบันทึก', 'Recorder clocks') : intent === 'not_recording' ? L(c, 'การบันทึกของเครื่อง', 'Recording') : L(c, 'ปัญหาเครื่องบันทึก', 'Recorder problems');
      return {
        intent, title,
        text: rows.length === 0 ? L(c, `ไม่พบปัญหาในเครื่องบันทึก ${devices.length} เครื่องที่คุณดูได้ (ตามรอบตรวจล่าสุด)`, `No problem on the ${devices.length} recorders you can see (last reading round)`) : undefined,
        items: rows.slice(0, MAX_ITEMS),
        actions: nav(c, '/cctv/devices', 'เปิดหน้าอุปกรณ์', 'Open Devices'),
        suggestions: intent === 'clock' ? [L(c, 'ตั้ง NTP ยังไง', 'How to set NTP')] : [L(c, 'HDD มีปัญหาแก้ยังไง', 'HDD problem: what to do'), ...sugg(c, [6])],
      };
    }
    case 'incidents': {
      const camIds = (await scopedCameras(c)).map((x) => x.id);
      const rows = await prisma.cameraIncident.findMany({ where: { status: { in: ['open', 'pending'] }, cameraId: { in: camIds } }, orderBy: { openedAt: 'desc' }, take: MAX_ITEMS, include: { camera: { select: { name: true } } } });
      const total = await prisma.cameraIncident.count({ where: { status: { in: ['open', 'pending'] }, cameraId: { in: camIds } } });
      return {
        intent, title: total ? L(c, `Incident ที่ยังไม่ปิด ${total} รายการ`, `${total} incidents not closed`) : L(c, 'ไม่มี Incident ค้าง', 'No incident open'),
        items: rows.map((r) => ({ label: `${r.incidentNumber} · ${r.camera?.name ?? ''}`, value: r.status === 'pending' ? L(c, 'รอตรวจรับ', 'awaiting check') : L(c, `เปิด ${fmtMin(c, (Date.now() - r.openedAt.getTime()) / 60000)}`, `open ${fmtMin(c, (Date.now() - r.openedAt.getTime()) / 60000)}`), tone: r.status === 'pending' ? 'warn' as const : 'bad' as const, link: `/cctv/incidents?incident=${encodeURIComponent(r.incidentNumber)}` })),
        actions: nav(c, '/cctv/incidents', 'เปิดศูนย์ Incident', 'Open Incident center'),
        suggestions: [L(c, 'สถิติ Incident 30 วัน', 'Incident stats, 30 days'), L(c, 'ปิด Incident ยังไง', 'How to close an incident')],
      };
    }
    case 'work_orders': {
      const camIds = (await scopedCameras(c)).map((x) => x.id);
      const rows = await prisma.workOrder.findMany({ where: { status: { in: ['open', 'in_progress'] }, incident: { cameraId: { in: camIds } } }, orderBy: { createdAt: 'asc' }, take: MAX_ITEMS, include: { incident: { select: { incidentNumber: true, camera: { select: { name: true } } } } } });
      const now = Date.now();
      return {
        intent, title: rows.length ? L(c, `ใบงานค้าง ${rows.length} ใบ`, `${rows.length} open work orders`) : L(c, 'ไม่มีใบงานค้าง', 'No open work order'),
        items: rows.map((w) => {
          const overdue = w.scheduledAt && w.scheduledAt.getTime() < now;
          return { label: `${w.number} · ${w.incident?.camera?.name ?? ''}`, value: [w.vendorCompany, overdue ? L(c, 'เลยนัดแล้ว', 'past appointment') : w.status === 'in_progress' ? L(c, 'กำลังทำ', 'in progress') : L(c, 'รอดำเนินการ', 'open')].filter(Boolean).join(' · '), tone: overdue ? 'bad' as const : 'warn' as const, link: '/cctv/work-orders' };
        }),
        actions: nav(c, '/cctv/work-orders', 'เปิดหน้าใบงาน', 'Open Work orders'),
        suggestions: sugg(c, [5, 0]),
      };
    }
    case 'availability':
    case 'flapping': {
      const period = periodOf(text);
      const report = await getCameraComparisonReport(period.key, await cameraWhere(request));
      const known = report.filter((r) => typeof r.availability === 'number');
      const avg = known.length ? known.reduce((s, r) => s + (r.availability as number), 0) / known.length : null;
      const label = L(c, `${period.days} วัน`, `${period.days} days`);
      if (intent === 'flapping') {
        const top = report.filter((r) => (r.offlineCount ?? 0) > 0).sort((a, b) => (b.offlineCount ?? 0) - (a.offlineCount ?? 0)).slice(0, 10);
        return {
          intent, title: L(c, `กล้องที่หลุดบ่อย (${label})`, `Cameras dropping most (${label})`),
          text: top.length ? undefined : L(c, 'ไม่มีกล้องหลุดในช่วงนี้', 'No drops in this period'),
          items: top.map((r) => ({ label: r.cameraName, value: L(c, `${r.offlineCount} ครั้ง · MTTR ${fmtMin(c, r.mttr)}`, `${r.offlineCount} times · MTTR ${fmtMin(c, r.mttr)}`), tone: (r.offlineCount ?? 0) >= 10 ? 'bad' as const : 'warn' as const, hint: L(c, 'หลุดบ่อย: ตรวจสาย/ไฟ/คอนเน็กเตอร์ และบิตเรต', 'Frequent drops: check cable, power, connectors and bitrate'), link: `/cctv/camera-analytics?camera=${r.cameraId}` })),
          actions: nav(c, '/cctv/camera-analytics', 'เปิดวิเคราะห์กล้อง', 'Open Camera analytics'),
          suggestions: [L(c, 'ความพร้อมใช้งาน 30 วัน', 'Availability, 30 days'), L(c, 'กล้องที่หลุดบ่อย 30 วัน', 'Dropping most, 30 days')],
        };
      }
      const worst = [...known].sort((a, b) => (a.availability as number) - (b.availability as number)).slice(0, 5);
      const belowSla = known.filter((r) => r.slaMet === false).length;
      return {
        intent, title: L(c, `ความพร้อมใช้งานกล้อง (${label})`, `Camera availability (${label})`),
        items: [
          { label: L(c, 'เฉลี่ยทุกกล้อง', 'Average'), value: pct(avg), tone: avg !== null && avg < 99 ? 'warn' : 'ok' },
          { label: L(c, 'ต่ำกว่าเป้า SLA', 'Below SLA target'), value: `${belowSla} / ${known.length}`, tone: belowSla ? 'warn' : 'ok' },
          ...worst.map((r) => ({ label: L(c, `แย่สุด: ${r.cameraName}`, `Worst: ${r.cameraName}`), value: `${pct(r.availability as number)} · ${L(c, 'หลุด', 'drops')} ${r.offlineCount ?? 0}`, tone: 'bad' as const, link: `/cctv/camera-analytics?camera=${r.cameraId}` })),
        ],
        actions: nav(c, '/cctv/camera-analytics', 'เปิดวิเคราะห์กล้อง', 'Open Camera analytics'),
        suggestions: [L(c, 'กล้องที่หลุดบ่อย 7 วัน', 'Dropping most, 7 days'), L(c, 'ความพร้อมใช้งาน 7 วัน', 'Availability, 7 days')],
      };
    }
    case 'incident_stats': {
      const period = periodOf(text);
      const since = new Date(Date.now() - period.days * 86_400_000);
      const camIds = (await scopedCameras(c)).map((x) => x.id);
      const [opened, closed, stillOpen] = await Promise.all([
        prisma.cameraIncident.findMany({ where: { openedAt: { gte: since }, cameraId: { in: camIds } }, select: { reason: true } }),
        prisma.cameraIncident.findMany({ where: { closedAt: { gte: since }, cameraId: { in: camIds } }, select: { openedAt: true, closedAt: true } }),
        prisma.cameraIncident.count({ where: { status: { in: ['open', 'pending'] }, cameraId: { in: camIds } } }),
      ]);
      const mttr = closed.length ? closed.reduce((s, r) => s + (r.closedAt!.getTime() - r.openedAt.getTime()), 0) / closed.length / 60000 : null;
      const byReason = new Map<string, number>();
      for (const r of opened) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
      const reasons = await prisma.masterdata.findMany({ where: { type: 'incident_reason' }, select: { code: true, nameTh: true, nameEn: true } });
      const name = (code: string) => { const m = reasons.find((x) => x.code === code); return (lang === 'th' ? m?.nameTh : m?.nameEn) || code; };
      return {
        intent, title: L(c, `สถิติ Incident (${period.days} วัน)`, `Incident stats (${period.days} days)`),
        items: [
          { label: L(c, 'เปิดใหม่', 'Opened'), value: String(opened.length) },
          { label: L(c, 'ปิดแล้ว', 'Closed'), value: String(closed.length) },
          { label: L(c, 'เวลาซ่อมเฉลี่ย (MTTR)', 'Average time to repair (MTTR)'), value: fmtMin(c, mttr) },
          { label: L(c, 'ยังไม่ปิดตอนนี้', 'Still open now'), value: String(stillOpen), tone: stillOpen ? 'warn' : 'ok', link: '/cctv/incidents' },
          ...[...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ label: L(c, `สาเหตุ: ${name(k)}`, `Reason: ${name(k)}`), value: String(v) })),
        ],
        actions: nav(c, '/cctv/incidents', 'เปิดศูนย์ Incident', 'Open Incident center'),
        suggestions: [L(c, 'Incident ที่ยังเปิด', 'Open incidents'), L(c, 'สถิติ Incident 30 วัน', 'Incident stats, 30 days')],
      };
    }
    case 'retention': {
      const devices = await visibleDevices(c);
      const rows = devices.map((d) => ({ d, days: (d.healthInfo as any)?.retentionDays as number | null | undefined, oldest: (d.healthInfo as any)?.oldestRecording as string | null | undefined }))
        .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));
      return {
        intent, title: L(c, 'เก็บภาพย้อนหลังได้กี่วัน (ต่อเครื่อง)', 'Days of footage kept (per recorder)'),
        items: rows.map(({ d, days, oldest }) => ({ label: d.name, value: days === null || days === undefined ? L(c, 'ยังไม่ทราบ', 'not known') : L(c, `${days} วัน (เก่าสุด ${oldest?.slice(0, 10)})`, `${days} days (oldest ${oldest?.slice(0, 10)})`), tone: days !== null && days !== undefined && days < 14 ? 'warn' as const : 'ok' as const, link: '/cctv/devices' })),
        text: L(c, 'นับจากไฟล์เก่าสุดที่เครื่องยังเก็บอยู่ (อ่านทุกรอบตรวจสุขภาพ) ถ้าน้อยกว่าที่ต้องการ: ปิดบันทึกสตรีมรองซ้ำ หรือเพิ่ม HDD', 'Counted from the oldest file the recorder still holds. If too short: stop the duplicate sub-stream recording or add HDD.'),
        suggestions: [L(c, 'บันทึกสตรีมรองคู่แก้ยังไง', 'Sub stream also recorded: what to do'), ...sugg(c, [2])],
      };
    }
    case 'alert_stats': {
      const period = periodOf(text.includes('วันนี้') || /today/i.test(text) ? text : `${text} วันนี้`);
      const since = new Date(Date.now() - period.days * 86_400_000);
      const sources = await allowedAlertSources(request);
      const where = { deletedAt: null, createdAt: { gte: since }, ...(sources ? { source: { in: sources } } : {}) };
      const groups = await prisma.alert.groupBy({ by: ['alertType'], where, _count: { _all: true } });
      const unresolved = await prisma.alert.count({ where: { deletedAt: null, resolvedAt: null, ...(sources ? { source: { in: sources } } : {}) } });
      return {
        intent, title: L(c, `แจ้งเตือน (${period.days === 1 ? 'วันนี้' : `${period.days} วัน`})`, `Alerts (${period.days === 1 ? 'today' : `${period.days} days`})`),
        items: [
          { label: L(c, 'ยังไม่ปิดตอนนี้', 'Unresolved now'), value: String(unresolved), tone: unresolved ? 'warn' : 'ok', link: '/cctv/alerts' },
          ...groups.sort((a, b) => b._count._all - a._count._all).map((g) => ({ label: ALERT_KIND[g.alertType]?.[lang] ?? g.alertType, value: String(g._count._all) })),
        ],
        actions: nav(c, '/cctv/alerts', 'เปิดหน้าแจ้งเตือน', 'Open Alerts', 'alerts:read'),
        suggestions: [L(c, 'แจ้งเตือน 7 วัน', 'Alerts, 7 days'), ...sugg(c, [0])],
      };
    }
    case 'server': {
      if (!can(c, 'settings:read')) return { intent, title: L(c, 'ข้อมูล Server', 'Server'), text: L(c, 'ต้องมีสิทธิ์ดูการตั้งค่าระบบ', 'Needs the settings right'), suggestions: sugg(c, [0]) };
      const mem = 1 - os.freemem() / os.totalmem();
      let disk: number | null = null;
      try { const s = fs.statfsSync('/'); disk = 1 - s.bavail / s.blocks; } catch { /* skip */ }
      const backup = await getBackupStatus().catch(() => null);
      const sessions = await MediaMtxService.countWebrtcSessions();
      return {
        intent, title: L(c, 'สถานะ Server', 'Server status'),
        items: [
          { label: 'RAM', value: `${Math.round(mem * 100)}%`, tone: mem > 0.9 ? 'bad' : mem > 0.8 ? 'warn' : 'ok' },
          { label: L(c, 'ดิสก์', 'Disk'), value: disk === null ? '—' : `${Math.round(disk * 100)}%`, tone: disk !== null && disk > 0.9 ? 'bad' : 'ok' },
          { label: L(c, 'โหลด CPU (1/5/15 นาที)', 'CPU load (1/5/15 min)'), value: os.loadavg().map((v) => v.toFixed(2)).join(' / ') + ` · ${os.cpus().length} cores` },
          { label: L(c, 'ภาพสดที่เปิดอยู่ (MediaMTX)', 'Live sessions (MediaMTX)'), value: sessions === null ? L(c, 'MediaMTX ไม่ตอบ', 'MediaMTX not answering') : String(sessions), tone: sessions === null ? 'bad' : 'ok', hint: sessions === null ? L(c, 'ลอง docker restart cctv-mediamtx', 'Try docker restart cctv-mediamtx') : undefined },
          { label: L(c, 'สำรองฐานข้อมูลล่าสุด', 'Last database backup'), value: backup?.database ? `${backup.database.status} · ${backup.database.startedAt.slice(0, 16).replace('T', ' ')}` : '—', tone: backup?.database?.status === 'completed' ? 'ok' : 'warn', link: '/cctv/backup' },
        ],
        actions: nav(c, '/cctv/health', 'เปิดหน้าสถานะระบบ', 'Open System health', 'settings:read'),
        suggestions: [L(c, 'ใครกำลังดูภาพสด', 'Who is watching live'), ...sugg(c, [0])],
      };
    }
    case 'live_now': {
      const sessions = await MediaMtxService.countWebrtcSessions();
      const paths = (await MediaMtxService.getLivePaths()).filter((p: any) => p?.ready);
      return {
        intent, title: L(c, 'ภาพสดตอนนี้', 'Live right now'),
        items: [
          { label: L(c, 'การเชื่อมต่อภาพสด (ผู้ชม)', 'Live connections (viewers)'), value: sessions === null ? '—' : String(sessions), tone: sessions === null ? 'bad' : 'ok' },
          { label: L(c, 'สตรีมที่ดึงจากเครื่องบันทึก', 'Streams pulled from recorders'), value: String(paths.length) },
        ],
        text: L(c, 'ระบบดึงภาพจากเครื่องบันทึกเฉพาะตอนมีคนดู ไม่มีคนดู = 0 ถือว่าปกติ', 'Streams are pulled only while someone watches; 0 with nobody watching is normal.'),
        suggestions: sugg(c, [0]),
      };
    }
    case 'open_live': {
      if (!can(c, 'live:view')) return { intent, title: L(c, 'ดูภาพสด', 'Watch live'), text: L(c, 'คุณยังไม่มีสิทธิ์ดูภาพสด ให้ admin เพิ่มสิทธิ์', 'You do not have the live right; ask an admin'), suggestions: sugg(c, [0]) };
      const cams = await scopedCameras(c);
      const cam = findCamera(text, cams.map((x) => ({ id: x.id, name: x.name, channelNumber: x.channelNumber, deviceName: x.device?.name ?? null })));
      if (!cam) {
        return {
          intent, title: L(c, 'จะเปิดกล้องไหน?', 'Which camera?'),
          text: L(c, 'พิมพ์ชื่อเครื่องบันทึกกับช่อง เช่น "ดูสด MD ช่อง 4" หรือชื่อกล้องเต็ม', 'Type the recorder and channel, e.g. "live MD ch 4", or the full camera name'),
          suggestions: cams.slice(0, 4).map((x) => L(c, `ดูสด ${x.name}`, `live ${x.name}`)),
          actions: nav(c, '/cctv/live-grid', 'เปิดห้องภาพสด', 'Open Live wall', 'live:view'),
        };
      }
      return { intent, title: cam.name, actions: [{ kind: 'live', label: L(c, 'เปิดดูสด', 'Watch live'), cameraId: cam.id, cameraName: cam.name }, ...nav(c, `/cctv/live-grid?focus=${cam.id}`, 'ดูเต็มในห้องภาพสด', 'Full view on the live wall', 'live:view')], suggestions: sugg(c, [1]) };
    }
    case 'navigate': {
      const page = findPage(text);
      if (!page || !can(c, page.perm)) return { intent, title: L(c, 'ไปหน้าไหน?', 'Which page?'), text: L(c, 'ไม่พบหน้านั้น หรือคุณไม่มีสิทธิ์เปิด', 'Page not found or not allowed'), suggestions: sugg(c, [0]) };
      return { intent, title: L(c, page.th, page.en), actions: [{ kind: 'navigate', label: L(c, `ไปหน้า${page.th}`, `Go to ${page.en}`), path: page.path }], suggestions: sugg(c, [0]) };
    }
    case 'howto': {
      const [best, ...others] = findHowTo(text);
      const body = best[lang];
      return {
        intent, title: body.title, steps: body.steps,
        actions: best.link && can(c, best.perm ?? 'cameras:read') ? [{ kind: 'navigate', label: L(c, 'เปิดหน้าที่เกี่ยวข้อง', 'Open the related page'), path: best.link }] : [],
        suggestions: others.map((o) => o[lang].title),
      };
    }
    default:
      return {
        intent: 'help', title: L(c, 'ผมช่วยอะไรได้บ้าง', 'What I can help with'),
        steps: [
          L(c, 'สถานะ: "สรุปสถานะวันนี้", "กล้องไหนออฟไลน์", "เครื่องบันทึกมีปัญหาไหม", "เวลาเครื่องบันทึก", "Incident ที่ยังเปิด", "ใบงานค้าง"', 'Status: "today\'s status", "which cameras are offline", "recorder problems", "recorder clocks", "open incidents", "open work orders"'),
          L(c, 'สถิติ: "ความพร้อมใช้งาน 30 วัน", "กล้องที่หลุดบ่อย 7 วัน", "สถิติ Incident เดือนนี้", "เก็บย้อนหลังได้กี่วัน", "แจ้งเตือนวันนี้", "สถานะ Server"', 'Stats: "availability 30 days", "dropping most 7 days", "incident stats this month", "days of footage", "alerts today", "server status"'),
          L(c, 'สั่งงาน: "ดูสด MD ช่อง 4", "ไปหน้ารายงาน"', 'Do: "live MD ch 4", "go to reports"'),
          L(c, 'วิธีใช้/แก้ปัญหา: "ภาพสดไม่ขึ้นทุกกล้องแก้ยังไง", "ตั้ง NTP ยังไง", "HD ขึ้นช้าทำไม", "เพิ่มเครื่องบันทึกยังไง"', 'How-to/fixes: "no live picture anywhere", "how to set NTP", "why is HD slow", "how to add a recorder"'),
          L(c, 'ตอบจากข้อมูลจริงของระบบ ตามสิทธิ์ของคุณ ไม่ส่งข้อมูลออกนอกเครื่อง', 'Answers come from this system\'s data, within your rights; nothing leaves the server.'),
        ],
        suggestions: sugg(c, [0, 1, 3, 7]),
      };
  }
}

export { normalize };
