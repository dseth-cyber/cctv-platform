/**
 * Works out what a question is about, from words, without a language model: the answers come from the system's own
 * data, so a number is never made up and nothing leaves the machine. Thai and English, loose spelling.
 */
export type Intent =
  | 'summary' | 'offline_cameras' | 'recorder_problems' | 'not_recording' | 'clock'
  | 'incidents' | 'work_orders' | 'open_live' | 'navigate' | 'howto' | 'help'
  // statistics people ask for regularly (users, technicians, IT)
  | 'availability' | 'flapping' | 'incident_stats' | 'retention' | 'alert_stats' | 'server' | 'live_now';

export const normalize = (s: string) => s.toLowerCase().replace(/[\s​]+/g, ' ').replace(/[?？!！。、,，]/g, ' ').trim();

const has = (t: string, words: string[]) => words.some((w) => t.includes(w));

const W = {
  howto: ['ยังไง', 'อย่างไร', 'วิธี', 'ทำไง', 'ทำไม', 'how', 'why', 'สอน', 'ตั้งค่า'],
  live: ['ดูสด', 'ภาพสด', 'เปิดดู', 'เปิดกล้อง', 'live', 'watch'],
  navigate: ['ไปหน้า', 'เปิดหน้า', 'ไปที่หน้า', 'หน้า', 'go to', 'open page', 'page'],
  offline: ['ออฟไลน์', 'ออฟไลน', 'offline', 'ดับ', 'หลุด', 'ไม่มีภาพ', 'ไม่มีสัญญาณ', 'no video', 'down'],
  recorder: ['เครื่องบันทึก', 'dvr', 'nvr', 'hdd', 'ฮาร์ดดิสก์', 'ดิสก์', 'disk', 'recorder', 'ล็อก', 'รหัสผ่านผิด'],
  notRecording: ['ไม่บันทึก', 'หยุดบันทึก', 'ไม่ได้บันทึก', 'not recording', 'recording stopped'],
  clock: ['เวลา', 'นาฬิกา', 'ntp', 'clock', 'time'],
  incident: ['incident', 'อินซิเดนท์', 'อินซิเดนต์', 'เหตุ', 'ปัญหาที่เปิด'],
  workOrder: ['ใบงาน', 'work order', 'ช่าง', 'งานซ่อม'],
  availability: ['ความพร้อม', 'availability', 'uptime', 'sla', 'เปอร์เซ็นต์', '%', 'แย่ที่สุด', 'worst'],
  flapping: ['หลุดบ่อย', 'ดับบ่อย', 'บ่อยที่สุด', 'flap', 'unstable', 'ไม่เสถียร', 'top'],
  incidentStats: ['สถิติ incident', 'mttr', 'เวลาซ่อม', 'ซ่อมนาน', 'สาเหตุบ่อย', 'incident stats', 'กี่ครั้ง'],
  retention: ['เก็บได้กี่วัน', 'ย้อนหลังได้กี่วัน', 'เก็บกี่วัน', 'retention', 'กี่วัน', 'เก็บย้อนหลัง'],
  alertStats: ['แจ้งเตือนวันนี้', 'แจ้งเตือนกี่', 'alerts today', 'สถิติแจ้งเตือน', 'แจ้งเตือนล่าสุด'],
  server: ['server', 'เซิร์ฟเวอร์', 'ram', 'cpu', 'แรม', 'สำรองข้อมูล', 'backup', 'ดิสก์ server'],
  liveNow: ['ใครดู', 'กำลังดู', 'คนดู', 'viewers', 'watching now', 'สตรีมตอนนี้'],
  summary: ['สรุป', 'ภาพรวม', 'สถานะ', 'วันนี้', 'summary', 'status', 'overview', 'เป็นยังไงบ้าง', 'ปกติไหม'],
};

/** Pages a question can send someone to; `perm` is checked before the link is offered. */
export const PAGES: Array<{ path: string; perm: string; words: string[]; th: string; en: string }> = [
  { path: '/cctv/live-grid', perm: 'live:view', words: ['ห้องภาพสด', 'live wall', 'live grid', 'ภาพสด'], th: 'ห้องภาพสด', en: 'Live wall' },
  { path: '/cctv/playback', perm: 'playback:view', words: ['ย้อนหลัง', 'playback', 'เล่นย้อน'], th: 'ย้อนหลัง', en: 'Playback' },
  { path: '/cctv/cameras', perm: 'cameras:read', words: ['จัดการกล้อง', 'หน้ากล้อง', 'รายการกล้อง', 'cameras'], th: 'จัดการกล้อง', en: 'Cameras' },
  { path: '/cctv/devices', perm: 'cameras:read', words: ['อุปกรณ์', 'เครื่องบันทึก', 'devices', 'dvr', 'nvr'], th: 'อุปกรณ์ DVR/NVR', en: 'Devices' },
  { path: '/cctv/incidents', perm: 'cameras:read', words: ['incident', 'อินซิเดนท์', 'อินซิเดนต์'], th: 'ศูนย์ Incident', en: 'Incident center' },
  { path: '/cctv/work-orders', perm: 'cameras:read', words: ['ใบงาน', 'work order'], th: 'ใบงาน', en: 'Work orders' },
  { path: '/cctv/reports', perm: 'cameras:read', words: ['รายงาน', 'report'], th: 'รายงาน', en: 'Reports' },
  { path: '/cctv/alerts', perm: 'alerts:read', words: ['แจ้งเตือน', 'alert'], th: 'การแจ้งเตือน', en: 'Alerts' },
  { path: '/cctv/camera-analytics', perm: 'cameras:read', words: ['วิเคราะห์', 'ความพร้อม', 'analytics', 'availability'], th: 'วิเคราะห์กล้อง', en: 'Camera analytics' },
  { path: '/cctv/map', perm: 'cameras:read', words: ['แผนที่', 'ผังอาคาร', 'map'], th: 'ผังอาคารและแผนที่', en: 'Map' },
  { path: '/cctv/masterdata', perm: 'masterdata:read', words: ['ข้อมูลหลัก', 'master data', 'กลุ่มกล้อง'], th: 'ข้อมูลหลัก', en: 'Master data' },
  { path: '/cctv/system-config', perm: 'system-config:read', words: ['ตั้งค่าระบบ', 'system config'], th: 'ตั้งค่าระบบ', en: 'System config' },
  { path: '/cctv/users', perm: 'users:read', words: ['ผู้ใช้', 'สิทธิ์', 'บทบาท', 'users', 'roles'], th: 'ผู้ใช้', en: 'Users' },
  { path: '/cctv/health', perm: 'settings:read', words: ['สถานะระบบ', 'health'], th: 'สถานะระบบ', en: 'System health' },
  { path: '/cctv/audit-log', perm: 'audit-log:read', words: ['บันทึกการตรวจสอบ', 'audit'], th: 'บันทึกการตรวจสอบ', en: 'Audit log' },
];

export function findPage(text: string) {
  const t = normalize(text);
  // The longest matching word wins, so "ห้องภาพสด" beats "ภาพสด" and "เครื่องบันทึก" a shorter one.
  let best: { page: (typeof PAGES)[number]; len: number } | null = null;
  for (const page of PAGES) for (const w of page.words) if (t.includes(w) && (!best || w.length > best.len)) best = { page, len: w.length };
  return best?.page ?? null;
}

export interface CameraRef { id: string; name: string; channelNumber: number | null; deviceName: string | null }

/**
 * The camera a question names: "MD ช่อง 4", "md ch4", "แผนก HR ห้องบุคคล - Ch 2", or the camera name itself.
 * A recorder name plus a channel number is the usual way people say it.
 */
export function findCamera(text: string, cameras: CameraRef[]): CameraRef | null {
  const t = normalize(text);
  const exact = cameras.filter((c) => t.includes(normalize(c.name))).sort((a, b) => b.name.length - a.name.length)[0];
  if (exact) return exact;
  const ch = t.match(/(?:ช่อง|ch\.?|channel|กล้อง)\s*(\d{1,3})/);
  if (!ch) return null;
  const channel = Number(ch[1]);
  // The longest recorder name in the question, so "MD 2" is not read as "MD".
  const devices = [...new Set(cameras.map((c) => c.deviceName).filter((n): n is string => !!n))]
    .filter((n) => t.includes(normalize(n)))
    .sort((a, b) => b.length - a.length);
  if (devices.length === 0) return null;
  return cameras.find((c) => c.deviceName === devices[0] && c.channelNumber === channel) ?? null;
}

/** The period a statistics question means: "30 วัน", "เดือน" -> 30d; "วันนี้" -> 1d; otherwise a week. */
export function periodOf(text: string): { key: '1d' | '7d' | '30d'; days: number } {
  const t = normalize(text);
  if (/30|เดือน|month/.test(t)) return { key: '30d', days: 30 };
  if (/วันนี้|today|24/.test(t)) return { key: '1d', days: 1 };
  return { key: '7d', days: 7 };
}

export function detectIntent(text: string): Intent {
  const t = normalize(text);
  if (!t) return 'help';
  if (has(t, W.howto)) return 'howto';
  // Statistics before the plain status questions they share words with.
  if (has(t, W.flapping)) return 'flapping';
  if (has(t, W.availability)) return 'availability';
  if (has(t, W.incidentStats)) return 'incident_stats';
  if (has(t, W.retention)) return 'retention';
  if (has(t, W.alertStats)) return 'alert_stats';
  if (has(t, W.liveNow)) return 'live_now';
  if (has(t, W.server)) return 'server';
  if (has(t, W.live)) return 'open_live';
  if (has(t, W.notRecording)) return 'not_recording';
  if (has(t, W.offline)) return 'offline_cameras';
  if (has(t, W.workOrder)) return 'work_orders';
  if (has(t, W.incident)) return 'incidents';
  if (has(t, W.clock)) return 'clock';
  if (has(t, W.recorder) && !/^(ไปหน้า|เปิดหน้า|go to)/.test(t)) return 'recorder_problems';
  if (has(t, W.navigate) && findPage(t)) return 'navigate';
  if (has(t, W.summary)) return 'summary';
  if (findPage(t)) return 'navigate';
  return 'help';
}
