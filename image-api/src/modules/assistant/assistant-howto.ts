import { normalize } from './assistant-intent.js';

/**
 * How to use the system and how to fix what goes wrong, written from how this system really works (and from what
 * went wrong on the Dev machine). Each topic is found by its words; the best match answers, the next ones are offered.
 */
export interface HowTo { id: string; words: string[]; th: { title: string; steps: string[] }; en: { title: string; steps: string[] }; link?: string; perm?: string }

export const HOWTO: HowTo[] = [
  // ---------- fixing problems
  {
    id: 'camera_offline', words: ['กล้องออฟไลน์', 'กล้องดับ', 'ไม่มีภาพ', 'ไม่มีสัญญาณ', 'no video', 'camera offline', 'กล้องหลุด'],
    th: { title: 'กล้องออฟไลน์ / ไม่มีภาพ: แก้อย่างไร', steps: [
      'ดูสาเหตุในหน้าจัดการกล้อง (คอลัมน์สถานะ) หรือถามผมว่า "กล้องไหนออฟไลน์"',
      '"ไม่มีสัญญาณภาพ" (NO VIDEO): เครื่องบันทึกไม่ได้รับภาพจากกล้อง ตรวจสายสัญญาณ/สายไฟ/ตัวกล้องที่หน้างาน ถ้าช่องนั้นไม่มีกล้องจริง ให้ปิดช่องในหน้าอุปกรณ์',
      '"เครื่องบันทึกไม่ตอบ": ทั้งเครื่องติดต่อไม่ได้ ตรวจไฟ/สาย LAN ของ DVR/NVR แล้วเปิดหน้าเว็บของเครื่อง (กด IP ในหน้าอุปกรณ์)',
      '"เครื่องบันทึกติดต่อกล้องไม่ได้" (กล้อง IP บน NVR): ตรวจ PoE/สาย และรหัสผ่านกล้องในหน้าเว็บ NVR',
      '"สตรีมขาด": ภาพเคยมาแล้วหยุด มักกลับมาเอง ถ้าเป็นบ่อยให้ดูสายและบิตเรตของช่องนั้น',
      'ระบบเปิด Incident ให้เองถ้าดับนานเกินกำหนด และปิดเองเมื่อกลับมา',
    ] },
    en: { title: 'Camera offline / no picture: what to do', steps: [
      'See the reason on the Cameras page or ask me "which cameras are offline".',
      '"No signal" (NO VIDEO): the recorder gets no picture. Check the cable, power and camera on site; if the channel has no camera, switch it off on the Devices page.',
      '"Recorder not answering": the whole recorder is unreachable. Check its power and LAN, then open its web page (click the IP on the Devices page).',
      '"Recorder lost the camera" (IP camera on an NVR): check PoE/cable and the camera password on the NVR web page.',
      '"Stream dropped": it came and stopped; it usually returns. If it happens often, check the cable and that channel\'s bitrate.',
      'An incident opens by itself if it stays down past the set time and closes when it is back.',
    ] },
    link: '/cctv/cameras',
  },
  {
    id: 'all_live_down', words: ['ภาพสดดับทุก', 'ดูสดไม่ได้ทุก', 'ภาพสดไม่ขึ้น', 'ภาพดำทั้งหมด', 'live not working', 'all live down', 'ภาพสดไม่มา'],
    th: { title: 'ภาพสดไม่ขึ้นทุกกล้องพร้อมกัน', steps: [
      'ถ้าทุกกล้องดับพร้อมกัน ปัญหามักอยู่ที่ Server ไม่ใช่กล้อง',
      'เคยเกิดหลัง Docker Desktop รีสตาร์ทตัวเอง: การเชื่อมต่อภาพสด (WebRTC/UDP) เข้า MediaMTX ไม่ได้ แก้ด้วย `docker restart cctv-mediamtx`',
      'ดู log: `docker logs --since 10m cctv-mediamtx` ถ้าเห็น "deadline exceeded while waiting connection" คืออาการนี้',
      'เช็คว่าเปิดเว็บจากเครื่องในวง LAN ที่กำหนด (Dev: 192.168.30.77:8090)',
      'ถ้าหน่วยความจำเครื่องเหลือน้อย Docker อาจรีสตาร์ทเอง (ดูหน้าสถานะระบบ)',
    ] },
    en: { title: 'No live picture on any camera', steps: [
      'When every camera is out at once, the problem is the server, not the cameras.',
      'Seen after Docker Desktop restarted itself: live video (WebRTC/UDP) no longer reaches MediaMTX. Fix: `docker restart cctv-mediamtx`.',
      'Check `docker logs --since 10m cctv-mediamtx`; "deadline exceeded while waiting connection" is this.',
      'Open the web from a machine on the right LAN (Dev: 192.168.30.77:8090).',
      'Low memory on the server can make Docker restart (see System health).',
    ] },
    link: '/cctv/health', perm: 'settings:read',
  },
  {
    id: 'hd_slow', words: ['hd ช้า', 'hd ขึ้นช้า', 'ขึ้นช้า', 'hd ไม่ขึ้น', 'ภาพ hd', 'ไม่เป็น hd', 'hd', 'sd', 'ภาพไม่ชัด', 'ภาพช้า', 'h.265+', 'smart codec', 'hd slow'],
    th: { title: 'ภาพ HD ขึ้นช้า / ไม่เป็น HD', steps: [
      'ตาราง 3x3 และ 4x4 ใช้ SD เพื่อลดภาระ (ตั้งได้ที่ ตั้งค่าระบบ → ภาพสด HD อัตโนมัติ) กดป้าย SD บนช่องเพื่อดู HD ได้ทีละช่อง หรือดับเบิลคลิกดูเต็มจอ',
      'ถ้าเปิดเต็มจอแล้ว HD ขึ้นช้า 20–30 วินาที: เครื่องบันทึกเปิด H.265+ (Smart Codec) บนสตรีมหลัก ระบบจะแสดง SD ไปก่อน',
      'แก้ที่ตัวเครื่องบันทึก: ปิด H.265+ ของสตรีมหลัก (แลกกับพื้นที่เก็บย้อนหลังลดลงราว 8–12 วัน) แผงสุขภาพเครื่องบอกว่าช่องไหนเปิดอยู่',
      'ถ้าไม่มีสิทธิ์ "ดูภาพสด HD" จะเห็นแค่ SD เสมอ ให้ admin เพิ่มสิทธิ์',
    ] },
    en: { title: 'HD slow or not showing', steps: [
      '3x3 and 4x4 walls use SD to spare the recorders (System config → Automatic live HD). Click a tile\'s SD badge for HD, or double-click for full view.',
      'If full view takes 20-30 s for HD, the recorder has H.265+ (Smart Codec) on the main stream; SD shows meanwhile.',
      'Fix on the recorder: turn H.265+ off on the main stream (costs some 8-12 days of retention). The recorder health panel lists the channels.',
      'Without the "Watch live in HD" right you only get SD; ask an admin.',
    ] },
  },
  {
    id: 'recorder_locked', words: ['ล็อก', 'locked', 'รหัสผ่านผิด', 'wrong password', 'login failed', 'บัญชีถูกล็อก', 'ทดสอบไม่ผ่าน'],
    th: { title: 'เครื่องบันทึก: รหัสผ่านผิด / บัญชีถูกล็อก', steps: [
      'Hikvision ล็อกบัญชีราว 30 นาทีหลังใส่รหัสผิดหลายครั้ง ระหว่างล็อกแม้รหัสถูกก็เข้าไม่ได้',
      'ระบบหยุดลองเองเมื่อรหัสผิด เพื่อไม่ให้เครื่องล็อกซ้ำ และลองใหม่เองหลังเวลาปลดล็อก',
      'แก้รหัสในหน้าอุปกรณ์ → แก้ไข แล้วกด "ตรวจตอนนี้" ในแผงสุขภาพ (หลังพ้นเวลาล็อก)',
      'อย่ากดทดสอบซ้ำถี่ๆ ระหว่างถูกล็อก',
    ] },
    en: { title: 'Recorder: wrong password / account locked', steps: [
      'Hikvision locks the account for about 30 minutes after several wrong passwords; even the right one is refused meanwhile.',
      'The system stops trying on a wrong password and tries again by itself after the unlock time.',
      'Fix the password (Devices → edit), then press "Check now" in the health panel once the lock is over.',
      'Do not test again and again while it is locked.',
    ] },
    link: '/cctv/devices',
  },
  {
    id: 'clock_ntp', words: ['เวลาเพี้ยน', 'เวลาไม่ตรง', 'ntp', 'นาฬิกา', 'clock', 'time off', 'ตั้งเวลา'],
    th: { title: 'เวลาเครื่องบันทึกไม่ตรง / ตั้ง NTP', steps: [
      'ภาพย้อนหลังและคลิปใช้เวลาของเครื่องบันทึก เวลาเพี้ยนทำให้หาเหตุการณ์ผิดเวลา',
      'หน้าอุปกรณ์ → แผงสุขภาพเครื่อง → "ให้ดึงเวลาจาก Server (NTP)" หรือปุ่ม "ตั้ง NTP หลายเครื่อง"',
      'ระบบเปลี่ยนเฉพาะแหล่งเวลา และบันทึกค่าเดิมใน Audit Log ควรทำนอกเวลางาน (ภาพช่วงที่เวลาเปลี่ยนจะซ้ำหรือขาด)',
      'ถ้าตั้ง NTP แล้วยังเพี้ยน: เครื่องอาจติดต่อ NTP Server ไม่ได้ (คนละ LAN หรือ UDP 123 ถูกปิด)',
      'เกณฑ์เตือนตั้งได้ที่ ตั้งค่าระบบ → เตือนเมื่อเวลา DVR/NVR ต่างจาก Server เกิน',
    ] },
    en: { title: 'Recorder clock off / set NTP', steps: [
      'Playback and clips carry the recorder\'s time; a wrong clock puts events at the wrong time.',
      'Devices → recorder health → "Take time from the server (NTP)", or "Set NTP on several".',
      'Only the clock source changes and the old setting goes to the audit log. Do it outside working hours.',
      'Still off after NTP: the recorder may not reach the NTP server (other LAN, UDP 123 blocked).',
      'The warning threshold is in System config.',
    ] },
    link: '/cctv/devices',
  },
  {
    id: 'hdd', words: ['hdd', 'ฮาร์ดดิสก์', 'ดิสก์เสีย', 'disk fault', 'smart', 'ไม่บันทึก', 'หยุดบันทึก', 'not recording', 'ไม่มีไฟล์'],
    th: { title: 'HDD มีปัญหา / เครื่องไม่บันทึก', steps: [
      'แผงสุขภาพเครื่องบอกสถานะ HDD, ช่องที่ไม่บันทึกใน 30 นาที และ "ไม่พบไฟล์บันทึกเลย"',
      'HDD เสีย/SMART ไม่ผ่าน: เปลี่ยนดิสก์ (ภาพเก่าในดิสก์นั้นอาจหาย)',
      'ไม่บันทึกบางช่อง: ที่ตัวเครื่องตรวจ ตารางบันทึก, ความจุ (quota) ต่อช่อง และสถานะการบันทึกของช่อง',
      'ไม่พบไฟล์บันทึกเลย: เครื่องไม่เคยบันทึก ตรวจตารางบันทึกและ HDD ที่ตัวเครื่อง',
      'แจ้งเตือนเข้า Telegram ให้เองเมื่อพบ (กฎ Recording Stopped / HDD Problem)',
    ] },
    en: { title: 'HDD problem / not recording', steps: [
      'The recorder health panel shows HDD state, channels with no recording in 30 minutes, and "no recordings at all".',
      'Failed HDD / SMART: replace the disk (footage on it may be lost).',
      'Some channels not recording: on the recorder check the schedule, per-channel quota and recording state.',
      'No recordings at all: it never recorded; check schedule and HDD on the recorder.',
      'Telegram is told by itself (Recording Stopped / HDD Problem rules).',
    ] },
    link: '/cctv/devices',
  },
  {
    id: 'sub_recording', words: ['สตรีมรอง', 'บันทึกคู่', 'บันทึกซ้ำ', 'sub stream', 'พื้นที่เต็มเร็ว', 'เก็บได้น้อย', 'retention'],
    th: { title: 'เครื่องบันทึกสตรีมรองคู่ / เก็บย้อนหลังได้น้อย', steps: [
      'บางเครื่องบันทึกสตรีมรองด้วย ภาพเดียวกัน 2 ชุดบน HDD ระบบนี้ไม่ใช้ชุดสตรีมรอง',
      'ปิดที่ตัวเครื่อง: ความจุ → ตารางบันทึก → ขั้นสูง → ชนิดสตรีม เลือก "สตรีมหลัก" (บางรุ่น เช่น MD ปิดไม่ได้)',
      'ถ้าปิดไม่ได้ กด "รับทราบ (ปิดไม่ได้)" ในแผงสุขภาพ หมายเหตุจะเป็นสีเทา',
      'H.265+ ช่วยประหยัดพื้นที่ แต่ทำให้ HD/ย้อนหลังเริ่มช้า',
    ] },
    en: { title: 'Recorder also records the sub stream / short retention', steps: [
      'Some recorders record the sub stream too: two copies on the same HDD. This system does not use it.',
      'Turn off on the recorder: Storage → Schedule → Advanced → Stream type = main (some models such as MD cannot).',
      'If it cannot be turned off, press "Acknowledge (cannot turn off)" in the health panel.',
      'H.265+ saves space but makes HD and playback start late.',
    ] },
  },
  {
    id: 'playback_black', words: ['ย้อนหลังดำ', 'เล่นย้อนหลังไม่ขึ้น', 'playback black', 'เล่นไม่ได้', 'ย้อนหลังไม่มา', 'ตัดคลิปนาน', 'คลิปช้า'],
    th: { title: 'เล่นย้อนหลัง/ตัดคลิป: ภาพดำ ช้า หรือไม่ขึ้น', steps: [
      'ย้อนหลังเล่นจาก HDD ของ DVR/NVR โดยตรง กดเล่นแล้วภาพอาจดำได้ถึง ~20 วินาทีถ้าเครื่องส่ง keyframe ห่าง (H.265+) ยึดเวลาบนภาพเป็นหลัก',
      'ตัดคลิปจากเครื่องบันทึกใช้เวลาเท่าความยาวคลิป (สูงสุดตามที่ตั้ง) ขอคลิปเผื่อหน้า-หลัง 30 วินาที',
      'เครื่องหนึ่งเล่น/คัดลอกพร้อมกันได้จำกัด (ตั้งค่าระบบ → เล่นย้อนหลัง) เกินแล้วต้องรอ',
      'ต้องมีสิทธิ์ "ดูย้อนหลัง" และ "ตัดคลิป/ดาวน์โหลด"',
    ] },
    en: { title: 'Playback / clips: black, slow or not starting', steps: [
      'Playback comes straight from the DVR/NVR HDD; with far-apart keyframes (H.265+) it can be black up to ~20 s. Trust the time on the picture.',
      'A clip from a recorder takes as long as it lasts; ask for 30 s extra either side.',
      'A recorder plays/copies only a few at once (System config → playback); beyond that you wait.',
      'Needs the "Play back" and "Cut and download clips" rights.',
    ] },
    link: '/cctv/playback', perm: 'playback:view',
  },
  {
    id: 'telegram', words: ['telegram', 'เทเลแกรม', 'ไม่แจ้งเตือน', 'แจ้งเตือนไม่เข้า', 'ไม่ส่ง'],
    th: { title: 'Telegram ไม่ส่งแจ้งเตือน', steps: [
      'ตั้งค่า → Telegram Bot: ใส่ Token ของ Bot และ ID กลุ่มแชท แล้วกด "ทดสอบการเชื่อมต่อ"',
      'ตั้งค่า → กฎการแจ้งเตือน: กฎของเรื่องนั้นต้อง "ใช้งาน" และมีช่องทาง telegram',
      'แต่ละกฎมีระยะพัก (เช่น 60 นาที) เรื่องเดิมจะไม่ส่งซ้ำในช่วงนั้น',
      'Server ต้องออกอินเทอร์เน็ตไปที่ api.telegram.org ได้',
    ] },
    en: { title: 'Telegram not sending', steps: [
      'Settings → Telegram Bot: bot token and group chat ID, then "Test connection".',
      'Settings → alert rules: the rule must be on and have the telegram channel.',
      'Each rule has a cooldown; the same thing is not sent again within it.',
      'The server must reach api.telegram.org.',
    ] },
    link: '/cctv/telegram-bot', perm: 'settings:read',
  },
  {
    id: 'login_locked', words: ['เข้าระบบไม่ได้', 'login ไม่ได้', 'ล็อกอินไม่ได้', 'ลืมรหัส', 'forgot password', 'cannot sign in', 'บัญชีผู้ใช้ถูกล็อก'],
    th: { title: 'เข้าระบบไม่ได้ / ถูกล็อก', steps: [
      'ใส่รหัสผิดเกินจำนวนที่ตั้ง บัญชีจะถูกล็อกชั่วคราว (ตั้งค่าระบบ → จำนวนครั้งล็อกอินผิด/ระยะเวลาล็อก)',
      'รอให้พ้นเวลาล็อก หรือให้ admin ตั้งรหัสผ่านใหม่ในหน้าผู้ใช้',
      'ผู้ใช้ที่ถูกลบหรือปิดใช้งานจะเข้าระบบไม่ได้',
    ] },
    en: { title: 'Cannot sign in / locked', steps: [
      'Too many wrong passwords lock the account for a while (System config → failed sign-ins / lock time).',
      'Wait for the lock to end, or ask an admin to set a new password on the Users page.',
      'Deleted or switched-off users cannot sign in.',
    ] },
  },
  {
    id: 'disk_full', words: ['ดิสก์เต็ม', 'พื้นที่เต็ม', 'disk full', 'ดิสก์ server', 'พื้นที่ใกล้เต็ม'],
    th: { title: 'ดิสก์ Server ใกล้เต็ม', steps: [
      'ภาพหลักเก็บใน HDD ของ DVR/NVR เอง ดิสก์ Server เก็บฐานข้อมูล คลิปหลักฐาน และไฟล์ที่ Server บันทึกเอง',
      'ถ้ากล้องตั้ง "บันทึกลง Server" ไฟล์เก่าเกินนโยบายจะถูกย้ายไปที่พักแล้วลบ ดิสก์เกิน 92% ลบเก่าสุดจนต่ำกว่า 85%',
      'ลบคลิปหลักฐานที่ไม่ต้องการในหน้าย้อนหลัง (คลิปไม่มีวันหมดอายุเอง)',
      'เกณฑ์เตือนตั้งได้ที่ ตั้งค่าระบบ → เกณฑ์แจ้งเตือนวิกฤต/ระดับเตือน',
    ] },
    en: { title: 'Server disk nearly full', steps: [
      'Footage stays on the recorders\' HDDs; the server disk holds the database, evidence clips and what the server records itself.',
      'For cameras the server records, old files go to quarantine then are deleted; past 92% the oldest go until under 85%.',
      'Delete evidence clips you no longer need on the Playback page (clips never expire by themselves).',
      'Thresholds are in System config.',
    ] },
  },
  // ---------- how to use
  {
    id: 'add_device', words: ['เพิ่มอุปกรณ์', 'เพิ่มเครื่องบันทึก', 'เพิ่ม dvr', 'เพิ่ม nvr', 'add device', 'add recorder', 'เพิ่มกล้อง'],
    th: { title: 'เพิ่มเครื่องบันทึกและกล้อง', steps: [
      'หน้าอุปกรณ์ → "เพิ่มอุปกรณ์": ใส่ชื่อ IP ยี่ห้อ ผู้ใช้ รหัสผ่าน แล้วกด "ทดสอบและอ่านข้อมูล" (Hikvision อ่านรุ่น/Serial ให้เอง)',
      'เลือกจำนวนช่องและช่องที่ใช้ ระบบสร้างกล้องให้ทุกช่องที่เลือก',
      'เพิ่มทีละหลายเครื่องได้ด้วย "นำเข้าหลายรายการ (CSV)"',
      'แนะนำให้ตั้ง NTP และตรวจแผงสุขภาพหลังเพิ่ม',
    ] },
    en: { title: 'Add a recorder and its cameras', steps: [
      'Devices → "Add device": name, IP, brand, user, password, then "Test and read details" (Hikvision fills model/serial).',
      'Choose the channel count and channels in use; a camera is made for each.',
      'Many at once with "Import (CSV)".',
      'Set NTP and check the health panel afterwards.',
    ] },
    link: '/cctv/devices',
  },
  {
    id: 'live_wall', words: ['ห้องภาพสด', 'ลาดตระเวน', 'patrol', 'ลากวาง', 'drag', 'เต็มจอ', 'layout', 'ชุดมุมมอง', 'live wall'],
    th: { title: 'ใช้ห้องภาพสด', steps: [
      'เลือก Layout 1x1–4x4 ช่องเกินโควตาของคุณจะกดไม่ได้',
      'ลากกล้องจากแผง "เลือกกล้อง" ลงช่อง หรือลากที่จับ "ลาก" เพื่อสลับช่อง',
      'ดับเบิลคลิกช่องเพื่อดูเต็มจอเป็น HD ใช้ลูกศร ←/→ หรือปุ่มถัดไปเปลี่ยนกล้อง',
      '"วนลาดตระเวน" เปลี่ยนหน้ากล้องตามเวลาที่ตั้ง',
      '"ชุดมุมมอง" บันทึกหน้าจอไว้เรียกใช้ และแชร์ให้ทีมได้ถ้ามีสิทธิ์',
      'สลับไปแท็บอื่นเกิน 20 วินาที ภาพสดหยุดเพื่อลดภาระ กลับมาแล้วเล่นต่อเอง',
    ] },
    en: { title: 'Using the live wall', steps: [
      'Pick a layout 1x1-4x4; layouts above your quota are off.',
      'Drag a camera from "Pick camera" onto a tile, or drag a tile\'s handle to swap.',
      'Double-click a tile for full view in HD; ←/→ or next steps cameras.',
      'Patrol pages the cameras on a timer.',
      'Views save the wall to call back and can be shared with the team if you have the right.',
      'A tab hidden over 20 s stops live video; it resumes when you come back.',
    ] },
    link: '/cctv/live-grid', perm: 'live:view',
  },
  {
    id: 'rights', words: ['สิทธิ์', 'บทบาท', 'ให้ดูเฉพาะ', 'จำกัดกล้อง', 'permission', 'role', 'โควตา', 'quota', 'ผู้ใช้ใหม่'],
    th: { title: 'สิทธิ์ผู้ใช้และกล้องที่มองเห็น', steps: [
      'หน้าผู้ใช้ → บทบาทและสิทธิ์: ติ๊กสิทธิ์ เช่น ดูภาพสด / ดูภาพสด HD / ดูย้อนหลัง / ตัดคลิป',
      '"กล้องที่มองเห็น" เลือกตามสถานที่ โซน อุปกรณ์ หรือกลุ่มกล้อง (กลุ่มกล้องเลือกได้ทีละตัว)',
      'สิทธิ์ของผู้ใช้กับบทบาทรวมกัน คนที่บทบาทเห็นทั้งเครื่องจะจำกัดให้น้อยลงจากหน้าผู้ใช้ไม่ได้',
      '"โควตาภาพสดพร้อมกัน" ตั้งที่บทบาท และกำหนดรายคนทับได้',
    ] },
    en: { title: 'User rights and which cameras they see', steps: [
      'Users → roles: tick rights such as watch live / live HD / playback / clips.',
      '"Cameras visible" by site, zone, device or camera group (a group can hold single cameras).',
      'A person\'s and their role\'s scopes add up; a role that sees a whole recorder cannot be narrowed per person.',
      'Live quota on the role, overridable per person.',
    ] },
    link: '/cctv/users', perm: 'users:read',
  },
  {
    id: 'sensitive', words: ['อ่อนไหว', 'pdpa', 'sensitive', 'ใครดูกล้อง', 'บันทึกการดู'],
    th: { title: 'กล้องอ่อนไหว (บันทึกว่าใครดู)', steps: [
      'แก้ไขกล้อง → ติ๊ก "กล้องอ่อนไหว" หรือแก้ไขหลายกล้องพร้อมกัน',
      'ทุกการดูสด ภาพนิ่ง ย้อนหลัง ตัดคลิป ดาวน์โหลด บันทึกใน Audit Log (การกระทำ "เปิดดูกล้องอ่อนไหว")',
      'คนเดิม กล้องเดิม บันทึกไม่เกิน 1 ครั้งต่อ 10 นาที',
    ] },
    en: { title: 'Sensitive cameras (who looked)', steps: [
      'Edit camera → tick "Sensitive camera", or in bulk edit.',
      'Every live, still, playback, clip cut and download goes to the audit log ("Sensitive camera viewed").',
      'One entry per person and camera per 10 minutes.',
    ] },
    link: '/cctv/cameras',
  },
  {
    id: 'incident_flow', words: ['ปิด incident', 'ตรวจรับ', 'ส่งปิด', 'ใบงาน', 'work order', 'close incident', 'incident ทำยังไง'],
    th: { title: 'ขั้นตอน Incident และใบงาน', steps: [
      'Incident เปิดเองเมื่อกล้องดับเกินเวลาที่ตั้ง หรือสร้างเอง',
      'สร้างใบงานจาก Incident เพื่อส่งช่างภายนอก (ค่าใช้จ่ายเห็นเฉพาะผู้มีสิทธิ์)',
      'ซ่อมเสร็จ: "ส่งปิด" แล้วผู้มีสิทธิ์ตรวจรับ "อนุมัติ" หรือ "ส่งกลับ" (คนส่งอนุมัติงานตัวเองไม่ได้ เว้นแต่ให้เหตุผล)',
      'Incident ที่ระบบเปิดเองจะปิดเองเมื่อกล้องกลับมา',
    ] },
    en: { title: 'Incidents and work orders', steps: [
      'An incident opens by itself when a camera is down past the set time, or by hand.',
      'Make a work order from it for outside technicians (costs visible with the right only).',
      'Done: "Send to close", then someone with the right approves or sends back.',
      'Auto incidents close when the camera is back.',
    ] },
    link: '/cctv/incidents',
  },
  {
    id: 'refresh', words: ['รีเฟรช', 'ภาพนิ่ง', 'ภาพรวมห้องภาพสด', 'refresh', 'still image', 'ภาพเก่า'],
    th: { title: 'ภาพนิ่งในหน้าภาพรวม / รอบรีเฟรช', steps: [
      'หน้าภาพรวมแสดงทุกกล้องเป็นภาพนิ่ง ดึงเฉพาะกล้องที่มีคนดู',
      'รอบรีเฟรชตั้งได้ที่ กล้อง > กลุ่ม > DVR/NVR > ค่าระบบ (ระดับเจาะจงกว่าชนะ)',
      'ภาพเก่ากว่ากำหนดจะจางและมีป้ายเตือน ไม่ใช่เหตุการณ์ตอนนี้',
    ] },
    en: { title: 'Still images on the overview / refresh', steps: [
      'The overview shows every camera as a still, fetched only while someone looks.',
      'Refresh can be set per camera > group > DVR/NVR > system (most specific wins).',
      'Stills older than the limit fade with a warning.',
    ] },
  },
  {
    id: 'camera_info', words: ['ยี่ห้อกล้อง', 'รุ่นกล้อง', 'ความละเอียด', 'สเปก', 'csv', 'นำเข้า', 'resolution', 'spec'],
    th: { title: 'ข้อมูลกล้อง: สเปก ยี่ห้อ รุ่น', steps: [
      'ความละเอียด/codec อ่านจากเครื่องบันทึก Hikvision ทุกรอบตรวจสุขภาพ ดูที่ "ดูสเปก" ในหน้าวิเคราะห์',
      'กล้อง IP บน NVR เติมยี่ห้อ/รุ่นให้เอง กล้องอนาล็อกต้องกรอกเอง',
      'หน้ากล้อง → "อัปเดตข้อมูลกล้อง (CSV)": ดาวน์โหลดแบบฟอร์ม กรอก ประเภท/ยี่ห้อ/รุ่น แล้วอัปโหลด ตรวจก่อนยืนยัน',
    ] },
    en: { title: 'Camera info: spec, brand, model', steps: [
      'Resolution/codec are read from Hikvision recorders each health round; see "View spec" on analytics.',
      'IP cameras on an NVR get brand/model filled; analog ones are typed in.',
      'Cameras → "Update camera info (CSV)": download, fill type/brand/model, upload, check, confirm.',
    ] },
    link: '/cctv/cameras',
  },
  {
    id: 'device_web', words: ['เข้าหน้าเว็บเครื่อง', 'เว็บ dvr', 'หน้าเว็บกล้อง', 'login เข้าเครื่อง', 'device web', 'กด ip'],
    th: { title: 'เปิดหน้าเว็บของเครื่องบันทึก', steps: [
      'กด IP (มีขีดเส้นใต้และ ↗) ในหน้าอุปกรณ์ กล้อง รายงาน Incident หรือแผนที่ เปิดหน้า Login ของเครื่องในแท็บใหม่',
      'เครื่องที่เปิดต้องอยู่ในวง LAN เดียวกับเครื่องบันทึก',
    ] },
    en: { title: 'Open a recorder\'s web page', steps: [
      'Click the IP (underlined, ↗) on Devices, Cameras, Reports, Incidents or Map; the recorder\'s sign-in page opens in a new tab.',
      'Your computer must be on the recorder\'s LAN.',
    ] },
  },
];

/** Topics for a question, best first (by how many of their words it holds, longer words counting more). */
export function findHowTo(text: string, max = 3): HowTo[] {
  const t = normalize(text);
  return HOWTO
    .map((h) => ({ h, score: h.words.reduce((s, w) => s + (t.includes(w) ? w.length : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.h);
}
