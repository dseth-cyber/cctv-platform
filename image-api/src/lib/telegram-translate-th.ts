// Telegram is a single shared chat with no per-viewer language preference (unlike the
// in-app alert bell, which re-translates the same stored-English alert per viewer via
// web-app/src/utils/textUtils.ts translateAlertTitle/Message) — so there's one fixed
// target language for it, chosen here as Thai to match the operating team. This only
// covers the camera status-change/created/deleted shape (see cameras.controller.ts) and
// sync-worker-error alerts (see image-sync-worker) for now; anything else falls through
// untranslated. Extend pattern-by-pattern the same way textUtils.ts does on the frontend
// if more alert types need this.

import { getPrisma } from './prisma.js';

const STATUS_TH: Record<string, string> = {
  offline: 'ออฟไลน์', online: 'ออนไลน์', maintenance: 'ซ่อมบำรุง', error: 'ข้อผิดพลาด',
  active: 'ทำงาน', inactive: 'ไม่ทำงาน', deleted: 'ถูกลบ', created: 'ถูกเพิ่ม',
};
// Matches the values the incident form actually submits (ImageServiceCameras.tsx) —
// priority: low/medium/high/critical, impact: none/partial/full.
const PRIORITY_TH: Record<string, string> = { low: 'ต่ำ', medium: 'ปานกลาง', high: 'สูง', critical: 'วิกฤต' };
const IMPACT_TH: Record<string, string> = { none: 'ไม่มี', partial: 'บางส่วน', full: 'ทั้งสายการผลิต' };
// Matches the Prisma FileType enum (schema.prisma).
const FILE_TYPE_TH: Record<string, string> = {
  raw: 'ต้นฉบับ', processed: 'ประมวลผลแล้ว', thumbnail: 'รูปขนาดเล็ก',
  metadata_json: 'ข้อมูล Metadata (JSON)', ai: 'ผลวิเคราะห์ AI', ocr: 'ผลอ่านข้อความ (OCR)',
};
function translateFileTypes(csv: string): string {
  return csv.split(',').map((t) => FILE_TYPE_TH[t.trim()] ?? t.trim()).join(', ');
}
// Mirrors web-app/src/utils/textUtils.ts's translateTechnicalDetail — same classification
// codes/order/keys as the camera "Test Connection" feature (smb.service.ts), kept in sync
// by hand.
const SMB_ERROR_TH: Record<string, string> = {
  auth_failed: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
  share_not_found: 'ไม่พบ Share Path ที่ระบุ กรุณาตรวจสอบเส้นทาง',
  path_not_found: 'ไม่พบโฟลเดอร์หรือไฟล์ที่ระบุ',
  unreachable: 'ไม่สามารถเชื่อมต่อกับอุปกรณ์ได้ กรุณาตรวจสอบเครือข่ายหรือที่อยู่ IP',
  scan_overflow: 'สแกนอ่านไฟล์ล้มเหลวเนื่องจากจำนวนไฟล์ในโฟลเดอร์เกินขีดจำกัดหน่วยความจำ',
};

// Classifies raw SMB/NT_STATUS technical error text into a stable code (or null if
// unrecognized) — order matters, first match wins, same as textUtils.ts.
function classifySmbError(detail: string): string | null {
  const s = detail.toLowerCase();
  if (s.includes('nt_status_logon_failure') || s.includes('nt_status_wrong_password') || s.includes('nt_status_access_denied')) return 'auth_failed';
  if (s.includes('nt_status_bad_network_name')) return 'share_not_found';
  if (s.includes('nt_status_object_name_not_found') || s.includes('nt_status_object_path_not_found')) return 'path_not_found';
  if (s.includes('nt_status_host_unreachable') || s.includes('nt_status_io_timeout') || s.includes('connection timed out') || s.includes('timeout') || s.includes('connection refused')) return 'unreachable';
  if (s.includes('maximum call stack size exceeded') || s.includes('scan failed') || s.includes('stack overflow')) return 'scan_overflow';
  return null;
}

// Prepends a Thai explanation for known SMB failures while keeping the original text
// visible for troubleshooting; unrecognized text is returned unchanged.
function translateTechnicalDetailTh(detail: string): string {
  const code = classifySmbError(detail);
  return code ? `${SMB_ERROR_TH[code]} (${detail})` : detail;
}

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

  const autoOnline = message.match(/^Camera "(.+?)" is back online(?:\. Downtime: (.+))?$/i);
  if (autoOnline) {
    const [, name, downtime] = autoOnline;
    return `กล้อง "${name}" กลับมาออนไลน์แล้ว${downtime ? ` ระยะเวลาที่ดาวน์: ${translateDuration(downtime)}` : ''}`;
  }

  return message;
}

const STORAGE_LEVEL_TH: Record<string, string> = { warning: 'ใกล้เต็ม', critical: 'วิกฤต', emergency: 'ฉุกเฉิน' };

/**
 * Translates every alert title/message shape actually emitted by createAlert() calls in
 * image-api — see cameras.controller.ts (camera status/create/delete), image-sync-worker
 * (sync errors), camera-health-monitor.ts (incident escalation),
 * provider-metric-collector.ts (storage warning/critical/emergency/cleanup),
 * images.service.ts (trash emptied, bulk delete, bulk delete files), and
 * auth.service.ts (suspicious login activity / account lockout). Anything unrecognized
 * (including a message that no longer matches its title's expected shape, e.g. after an
 * upstream template change) falls back to the raw text rather than dropping information.
 */
export async function translateCameraAlertToThai(title: string, message: string): Promise<{ title: string; message: string }> {
  const syncWorker = title.match(/^Sync worker error:\s*(.+)$/i);
  if (syncWorker) {
    return {
      title: `ข้อผิดพลาด Sync Worker: ${translateTechnicalDetailTh(syncWorker[1])}`,
      message: translateTechnicalDetailTh(message),
    };
  }

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

  // camera-health-monitor.ts's image-flow watchdog — "reachable but silent", which is a
  // different failure from camera_offline and reads very differently in Thai: the point to
  // get across is that the network is fine and the camera itself has stopped producing.
  const noNewImages = title.match(/^No new images:\s*(.+)$/i);
  if (noNewImages) {
    const m = message.match(/^Camera "(.+?)" is still reachable but has produced no new images for (.+?) \(last image: (\S+)\)(?: during an active production run for (.+?))?\. Only defective parts/i);
    return {
      title: `ไม่มีรูปใหม่: ${noNewImages[1]}`,
      message: m
        ? `กล้อง "${m[1]}" ยังเชื่อมต่อได้ปกติ แต่ไม่มีรูปใหม่เข้ามาเลยเป็นเวลา ${translateDuration(m[2])} (รูปล่าสุด: ${formatThaiDateTime(m[3])})${m[4] ? `\nอยู่ระหว่างรอบผลิตของ ${m[4]}` : ''}\nระบบถ่ายเฉพาะชิ้นงานที่เสีย จึงเป็นได้ทั้ง "ไม่มีของเสียเลย" หรือ "ระบบถ่ายภาพหยุดทำงาน" — การเชื่อมต่อไม่มีปัญหา`
        : message,
    };
  }

  const stillNoNewImages = title.match(/^Still no new images:\s*(.+)$/i);
  if (stillNoNewImages) {
    const m = message.match(/^Camera "(.+?)" has now produced no new images for (.+?) \(last image: (\S+)\)(?: during an active production run for (.+?))?\. It is still reachable/i);
    return {
      title: `ยังไม่มีรูปใหม่: ${stillNoNewImages[1]}`,
      message: m
        ? `กล้อง "${m[1]}" ไม่มีรูปใหม่เข้ามาเลยเป็นเวลา ${translateDuration(m[2])} แล้ว (รูปล่าสุด: ${formatThaiDateTime(m[3])})${m[4] ? `\nอยู่ระหว่างรอบผลิตของ ${m[4]}` : ''}\nยังเชื่อมต่อได้อยู่ จึงไม่ใช่ปัญหาเครือข่าย`
        : message,
    };
  }

  const imagesResumed = title.match(/^Camera producing images again:\s*(.+)$/i);
  if (imagesResumed) {
    const m = message.match(/^Camera "(.+?)" is producing images again after (.+?) with no new images\.?$/i);
    return {
      title: `กล้องส่งรูปอีกครั้ง: ${imagesResumed[1]}`,
      message: m ? `กล้อง "${m[1]}" กลับมาส่งรูปใหม่แล้ว หลังจากไม่มีรูปเข้ามานาน ${translateDuration(m[2])}` : message,
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

  const storageCleanup = title.match(/^Storage cleanup:\s*(.+)$/i);
  if (storageCleanup) {
    const m = message.match(/^Auto-cleanup freed ([\d.]+ ?GB) \((\d+) files?\) for (.+?)\.?$/i);
    return {
      title: `ทำความสะอาดพื้นที่จัดเก็บ: ${storageCleanup[1]}`,
      message: m ? `ทำความสะอาดอัตโนมัติปลดปล่อยพื้นที่ ${m[1]} (${m[2]} ไฟล์) สำหรับ ${m[3]}` : message,
    };
  }

  const trashEmptied = title.match(/^Trash emptied:\s*(\d+)\s*images$/i);
  if (trashEmptied) {
    const m = message.match(/^(.+?) permanently deleted (\d+)\/(\d+) images from trash \((\d+) files?, (\d+) failed and kept for retry\)$/i);
    return {
      title: `ล้างถังขยะสำเร็จ: ${trashEmptied[1]} ภาพ`,
      message: m ? `${m[1]} ลบภาพถาวรจากถังขยะ ${m[2]}/${m[3]} ภาพ (${m[4]} ไฟล์, ผิดพลาด ${m[5]} ไฟล์ ซึ่งจะเก็บไว้ลองใหม่ภายหลัง)` : message,
    };
  }

  // Both message shapes are built from a fixed template (see images.service.ts
  // bulkDeleteFilesByAge/bulkDeleteByAge) with exactly two day/"all" variants and an
  // optional trailing failed-count clause — deterministic enough to fully regex-parse.
  const bulkDeleteFiles = title.match(/^Bulk delete files:\s*(\d+)\s*files$/i);
  if (bulkDeleteFiles) {
    const th = `ลบไฟล์จำนวนมาก: ${bulkDeleteFiles[1]} ไฟล์`;
    const aged = message.match(/^(.+?) deleted (\d+) files \(types: ([^)]*)\) older than (\d+) days\. Filter: cameras=(\S+), age=(\S+)(?: \((\d+) failed, kept for retry\))?$/i);
    if (aged) {
      const [, user, count, types, days, cameras, age, errors] = aged;
      return { title: th, message: `${user} ลบไฟล์ถาวร ${count} ไฟล์ (ประเภท: ${translateFileTypes(types)}) ที่เก่ากว่า ${days} วัน (กล้อง=${cameras}, อายุ=${age})${errors ? ` — ล้มเหลว ${errors} รายการ จะลองใหม่ภายหลัง` : ''}` };
    }
    const all = message.match(/^(.+?) deleted all (\d+) files \(types: ([^)]*)\)\. Filter: cameras=(\S+), age=(\S+)(?: \((\d+) failed, kept for retry\))?$/i);
    if (all) {
      const [, user, count, types, cameras, age, errors] = all;
      return { title: th, message: `${user} ลบไฟล์ถาวรทั้งหมด ${count} ไฟล์ (ประเภท: ${translateFileTypes(types)}) (กล้อง=${cameras}, อายุ=${age})${errors ? ` — ล้มเหลว ${errors} รายการ จะลองใหม่ภายหลัง` : ''}` };
    }
    return { title: th, message }; // shape changed upstream and no longer matches — keep raw rather than drop info
  }

  const bulkDelete = title.match(/^Bulk delete:\s*(\d+)\s*images$/i);
  if (bulkDelete) {
    const th = `ลบภาพจำนวนมาก: ${bulkDelete[1]} ภาพ`;
    const aged = message.match(/^(.+?) deleted (\d+) images older than (\d+) days\. Filter: cameras=(\S+), age=(\S+)$/i);
    if (aged) {
      const [, user, count, days, cameras, age] = aged;
      return { title: th, message: `${user} ลบภาพ ${count} ภาพ ที่เก่ากว่า ${days} วัน (กล้อง=${cameras}, อายุ=${age})` };
    }
    const all = message.match(/^(.+?) deleted all (\d+) images\. Filter: cameras=(\S+), age=(\S+)$/i);
    if (all) {
      const [, user, count, cameras, age] = all;
      return { title: th, message: `${user} ลบภาพทั้งหมด ${count} ภาพ (กล้อง=${cameras}, อายุ=${age})` };
    }
    return { title: th, message };
  }

  if (!/^Camera (offline|online|maintenance|error|deleted|created):/i.test(title)) {
    return { title, message };
  }
  return { title: translateTitle(title), message: await translateMessage(message) };
}
