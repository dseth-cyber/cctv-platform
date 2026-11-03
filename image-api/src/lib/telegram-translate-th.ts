// Telegram is a single shared chat with no per-viewer language preference (unlike the
// in-app alert bell, which re-translates the same stored-English alert per viewer via
// web-app/src/utils/textUtils.ts translateAlertTitle/Message) — so there's one fixed
// target language for it, chosen here as Thai to match the operating team. Anything not
// recognized falls through untranslated. Extend pattern-by-pattern the same way textUtils.ts
// does on the frontend if more alert types need this.

import { getPrisma } from './prisma.js';

const STATUS_TH: Record<string, string> = {
  offline: 'ออฟไลน์', online: 'ออนไลน์', maintenance: 'ซ่อมบำรุง', error: 'ข้อผิดพลาด',
  active: 'ทำงาน', inactive: 'ไม่ทำงาน', deleted: 'ถูกลบ', created: 'ถูกเพิ่ม',
};
// Matches the values the incident form actually submits (ImageServiceCameras.tsx) —
// priority: low/medium/high/critical, impact: none/partial/full.
const PRIORITY_TH: Record<string, string> = { low: 'ต่ำ', medium: 'ปานกลาง', high: 'สูง', critical: 'วิกฤต' };
const IMPACT_TH: Record<string, string> = { none: 'ไม่มี', partial: 'บางส่วน', full: 'ทั้งสายการผลิต' };
// reason/rootCause/resolution are masterdata-backed codes (incident_reason /
// incident_root_cause / incident_resolution) — admin-editable, so resolved via a live
// DB lookup rather than a hardcoded dictionary (keeps this in sync automatically).
async function masterdataLabelTh(type: string, code: string): Promise<string> {
  const prisma = getPrisma();
  const row = await prisma.masterdata.findUnique({ where: { type_code: { type, code } } }).catch(() => null);
  return row?.nameTh || code;
}

// Translates formatDuration()'s output ("1h 2m" / "16m 12s" / "42s") to Thai units.
// Note: the unit letter is glued directly to its digit (no boundary between them for
// \b, since digits and letters are both word characters), so match on the digit group.
function translateDuration(value: string): string {
  return value
    .replace(/(\d+)h/g, '$1 ชั่วโมง')
    .replace(/(\d+)m/g, '$1 นาที')
    .replace(/(\d+)s/g, '$1 วินาที');
}

// camera-health-monitor.ts's auto-detected offline/online alerts embed a raw ISO
// timestamp (UTC, e.g. "2026-08-10T09:08:58.886Z") or the literal "never" — neither is
// readable at a glance for the Thai operating team, so render it in Bangkok local time.
function formatThaiDateTime(value: string): string {
  if (value.toLowerCase() === 'never') return 'ไม่เคย';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(d) + ' น.';
}

function translateTitle(title: string): string {
  const m = title.match(/^Camera (offline|online|maintenance|error|deleted|created):\s*(.+)$/i);
  if (!m) return title;
  const status = m[1].toLowerCase();
  return `กล้อง${STATUS_TH[status] ?? status}: ${m[2]}`;
}

async function translateDetailLine(part: string): Promise<string> {
  let m: RegExpMatchArray | null;
  if ((m = part.match(/^Downtime:\s*(.+)$/))) return `ระยะเวลาที่ดาวน์: ${translateDuration(m[1])}`;
  if ((m = part.match(/^Incident\s+(\S+)\s+resolved\.?$/))) return `Incident ${m[1]} ปิดงานแล้ว`;
  if ((m = part.match(/^Incident\s+(\S+)\.?$/))) return `Incident: ${m[1]}`;
  if ((m = part.match(/^Reason:\s*(.+)$/))) return `เหตุผล: ${await masterdataLabelTh('incident_reason', m[1])}`;
  if ((m = part.match(/^Priority:\s*(.+)$/))) return `ความสำคัญ: ${PRIORITY_TH[m[1].toLowerCase()] ?? m[1]}`;
  if ((m = part.match(/^Impact:\s*(.+)$/))) return `ผลกระทบ: ${IMPACT_TH[m[1].toLowerCase()] ?? m[1]}`;
  if ((m = part.match(/^Details:\s*(.+)$/))) return `รายละเอียด: ${m[1]}`;
  if ((m = part.match(/^Resolution:\s*(.+)$/))) return `วิธีแก้ไข: ${await masterdataLabelTh('incident_resolution', m[1])}`;
  if ((m = part.match(/^RootCause:\s*(.+)$/))) return `สาเหตุหลัก: ${await masterdataLabelTh('incident_root_cause', m[1])}`;
  if ((m = part.match(/^CorrectiveAction:\s*(.+)$/))) return `การแก้ไข: ${m[1]}`;
  if ((m = part.match(/^PreventiveAction:\s*(.+)$/))) return `การแก้ไขเชิงป้องกัน: ${m[1]}`;
  if ((m = part.match(/^Notes:\s*(.+)$/))) return `บันทึกเพิ่มเติม: ${m[1]}`;
  if ((m = part.match(/^Link:\s*(\S+)$/))) return `ดูรายละเอียด/รูปแนบ: ${m[1]}`;
  return part; // unrecognized — keep rather than silently drop information
}

async function translateMessage(message: string): Promise<string> {
  const statusChange = message.match(/^Camera "(.+?)" status changed to (\w+) by ([^.]+)\.?\s*([\s\S]*)$/);
  if (statusChange) {
    const [, cameraName, newStatus, changedBy, restRaw] = statusChange;
    const statusTh = STATUS_TH[newStatus.toLowerCase()] ?? newStatus;
    const lines = [`กล้อง "${cameraName}" เปลี่ยนสถานะเป็น${statusTh} โดย ${changedBy}`];

    const rest = restRaw.trim();
    if (rest) {
      const parts = rest.split('. ').map((s) => s.trim().replace(/\.$/, '')).filter(Boolean);
      for (const part of parts) lines.push(await translateDetailLine(part));
    }

    return lines.join('\n');
  }

  const deleted = message.match(/^Camera "(.+?)" was deleted by ([^.]+)(?:\. IP: (\S+))?$/);
  if (deleted) return `กล้อง "${deleted[1]}" ถูกลบโดย ${deleted[2]}${deleted[3] ? ` (IP: ${deleted[3]})` : ''}`;

  const created = message.match(/^Camera "(.+?)" was created by ([^.]+)(?:\. IP: (\S+))?$/);
  if (created) return `กล้อง "${created[1]}" ถูกเพิ่มโดย ${created[2]}${created[3] ? ` (IP: ${created[3]})` : ''}`;

  // camera-health-monitor.ts's own auto-detected offline/online alerts — a completely
  // different message shape from the manual status-change one above (no incident/reason
  // context, since these fire from the poll-based watchdog, not the resolve/incident form).
  const autoOffline = message.match(/^Camera "(.+?)" is offline\. Status: (\w+)\. Last poll: (.+)$/i);
  if (autoOffline) {
    const [, name, status, lastPoll] = autoOffline;
    const statusTh = STATUS_TH[status.toLowerCase()] ?? status;
    return `กล้อง "${name}" ออฟไลน์ สถานะ: ${statusTh} เช็คล่าสุด: ${formatThaiDateTime(lastPoll)}`;
  }

  const streamDropped = message.match(/^Camera "(.+?)" stream disconnected instantly \(< 3s detection\)\. Stream: (.+?)\.?$/i);
  if (streamDropped) return `กล้อง "${streamDropped[1]}" สตรีมขาดทันที (ตรวจพบภายใน 3 วินาที) สตรีม: ${streamDropped[2]}`;

  const autoOnline = message.match(/^Camera "(.+?)" is back online(?: via real-time webhook)?(?:\. Downtime: (.+))?$/i);
  if (autoOnline) {
    const [, name, downtime] = autoOnline;
    return `กล้อง "${name}" กลับมาออนไลน์แล้ว${downtime ? ` ระยะเวลาที่ดาวน์: ${translateDuration(downtime)}` : ''}`;
  }

  return message;
}

// Recording storage alerts (retention-sweeper.service.ts / segment-indexer.ts): fixed titles,
// numbers pulled out of the message.
function translateRecordingAlertTh(title: string, message: string): { title: string; message: string } | null {
  let m: RegExpMatchArray | null;
  switch (title) {
    case 'Recording Storage Monitor Error':
      m = message.match(/^Cannot read disk usage for recordings directory (.+?): ([\s\S]+)$/);
      return { title: 'อ่านพื้นที่ดิสก์บันทึกไม่ได้', message: m ? `อ่านการใช้พื้นที่ของโฟลเดอร์ ${m[1]} ไม่ได้: ${m[2]}` : message };
    case 'Recording Storage High-Watermark Warning':
      m = message.match(/^Recording disk usage reached ([\d.]+)% \(Threshold: ([\d.]+)%\)/);
      return { title: 'ดิสก์บันทึกใกล้เต็ม', message: m ? `ดิสก์บันทึกใช้ไป ${m[1]}% (เกณฑ์เตือน ${m[2]}%) ใกล้ถึงระดับวิกฤต` : message };
    case 'Recording Storage Critical — Cleanup Disabled':
      m = message.match(/^Recording disk usage is critical at ([\d.]+)% \(Threshold: ([\d.]+)%\)/);
      return { title: 'ดิสก์บันทึกวิกฤต — ปิดการล้างอัตโนมัติอยู่', message: m ? `ดิสก์บันทึกใช้ไป ${m[1]}% (เกณฑ์วิกฤต ${m[2]}%) การล้างไฟล์อัตโนมัติถูกปิดอยู่ ต้องคืนพื้นที่เอง` : message };
    case 'Emergency FIFO Eviction Triggered':
      m = message.match(/^Recording disk usage is critical at ([\d.]+)% \(Threshold: ([\d.]+)%\)\. Deleting the oldest .+ until usage < ([\d.]+)%/);
      return { title: 'ดิสก์บันทึกวิกฤต — เริ่มลบไฟล์เก่าสุด', message: m ? `ดิสก์บันทึกใช้ไป ${m[1]}% (เกณฑ์วิกฤต ${m[2]}%) กำลังลบไฟล์เก่าสุดที่ไม่ติด Legal Hold (เริ่มจาก quarantine) จนต่ำกว่า ${m[3]}%` : message };
    case 'Emergency Eviction Did Not Free Space':
      m = message.match(/^Deleted (\d+) recordings but usage is still ([\d.]+)%\. Something other than recordings is filling (.+?), or/);
      return { title: 'ลบไฟล์แล้วพื้นที่ไม่ลดลง', message: m ? `ลบไฟล์บันทึกไป ${m[1]} ไฟล์ แต่ดิสก์ยังใช้อยู่ ${m[2]}% อาจมีไฟล์อื่นใน ${m[3]} หรือไฟล์ที่เหลือติด Legal Hold` : message };
    case 'Recording files missing from disk':
      m = message.match(/^(\d+) indexed recording segment\(s\) are no longer on disk \((\d+) under Legal Hold\)/);
      return { title: 'ไฟล์บันทึกหายจากดิสก์', message: m ? `ไฟล์บันทึก ${m[1]} ไฟล์ไม่อยู่บนดิสก์แล้ว (ติด Legal Hold ${m[2]} ไฟล์) ถูกลบนอกกระบวนการ retention` : message };
    default:
      return null;
  }
}

const STORAGE_LEVEL_TH: Record<string, string> = { warning: 'ใกล้เต็ม', critical: 'วิกฤต', emergency: 'ฉุกเฉิน' };

/**
 * Translates every alert title/message shape actually emitted by createAlert() calls in
 * image-api — see cameras.controller.ts (camera status/create/delete), camera-health-monitor.ts
 * (incident escalation), provider-metric-collector.ts (storage warning/critical/emergency),
 * retention-sweeper.service.ts / segment-indexer.ts (recording storage), and
 * auth.service.ts (suspicious login activity / account lockout). Anything unrecognized
 * (including a message that no longer matches its title's expected shape, e.g. after an
 * upstream template change) falls back to the raw text rather than dropping information.
 */
export async function translateCameraAlertToThai(title: string, message: string): Promise<{ title: string; message: string }> {
  const authAnomaly = title.match(/^Suspicious login activity:\s*(.+)$/i);
  if (authAnomaly) {
    const m = message.match(/^(\d+) failed login attempts for user "(.+?)"(?: from IP (\S+))? within (\d+) minute\(s\) — account locked for (\d+) minute\(s\)\.?$/i);
    return {
      title: `พฤติกรรม Login ผิดปกติ: ${authAnomaly[1]}`,
      message: m
        ? `พบความพยายาม Login ผิดพลาด ${m[1]} ครั้งสำหรับผู้ใช้ "${m[2]}"${m[3] ? ` จาก IP ${m[3]}` : ''} ภายใน ${m[4]} นาที — ล็อกบัญชีชั่วคราว ${m[5]} นาที`
        : message,
    };
  }

  const incidentUnassigned = title.match(/^Incident still unassigned:\s*(\S+)$/i);
  if (incidentUnassigned) {
    const m = message.match(/^Camera "(.+?)" has been offline for over (\d+) minute\(s\) and incident (\S+) has not been assigned to anyone yet\.?$/i);
    return {
      title: `Incident ยังไม่มอบหมาย: ${incidentUnassigned[1]}`,
      message: m ? `กล้อง "${m[1]}" ออฟไลน์เกิน ${m[2]} นาที และ Incident ${m[3]} ยังไม่มีผู้รับผิดชอบ` : message,
    };
  }

  const incidentCritical = title.match(/^Incident escalated to Critical:\s*(\S+)$/i);
  if (incidentCritical) {
    const m = message.match(/^Camera "(.+?)" has been offline for over (\d+) minute\(s\)\.\s*Incident (\S+) needs attention\.?$/i);
    return {
      title: `Incident ยกระดับเป็นวิกฤต: ${incidentCritical[1]}`,
      message: m ? `กล้อง "${m[1]}" ออฟไลน์เกิน ${m[2]} นาที Incident ${m[3]} ต้องการการดูแลด่วน` : message,
    };
  }

  const storageLevel = title.match(/^Storage (warning|critical|emergency):\s*(.+?)\s*\(([\d.]+)%\)$/i);
  if (storageLevel) {
    const [, level, providerName, pct] = storageLevel;
    const levelTh = STORAGE_LEVEL_TH[level.toLowerCase()] ?? level;
    const m = message.match(/^(.+?) usage ([\d.]+ ?GB) \/ ([\d.]+ ?GB) \(([\d.]+)%\)(?:\s*exceeds \w+ threshold ([\d.]+)%)?$/i);
    return {
      title: `พื้นที่จัดเก็บ${levelTh}: ${providerName} (${pct}%)`,
      message: m
        ? `${m[1]} ใช้ไป ${m[2]} / ${m[3]} (${m[4]}%)${m[5] ? ` เกินเกณฑ์ ${m[5]}%` : ''}`
        : message,
    };
  }

  const recording = translateRecordingAlertTh(title, message);
  if (recording) return recording;

  if (!/^Camera (offline|online|maintenance|error|deleted|created):/i.test(title)) {
    return { title, message };
  }
  return { title: translateTitle(title), message: await translateMessage(message) };
}
