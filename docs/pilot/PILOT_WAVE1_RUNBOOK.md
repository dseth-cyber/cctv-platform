# CCTV Platform — Pilot Wave 1 On-Site Runbook (10 Physical Cameras)

- **เป้าหมาย (Objective):** คู่มือปฏิบัติการภาคสนามแบบ Step-by-Step สำหรับวิศวกรและผู้ดูแลระบบในการติดตั้ง ทดสอบสตรีม และตรวจรับกล้องวงจรปิดจริง 10 ตัวแรก (Pilot Wave 1) เข้าสู่ระบบ CCTV Platform
- **ขอบเขตอุปกรณ์ (Scope):** กล้อง IP Camera 10 ตัว (Gate 1-2, Perimeter Fence North/East/South/West, Server Room Door, Loading Dock A/B, Emergency Exit Corridor)
- **สภาพแวดล้อมที่รองรับ:** Local Isolated Network (VLAN วงปิด) เชื่อมต่อกับ Media Server ผ่าน RTSP (TCP Port 554) และ HTTP/ONVIF (TCP Port 80/8080)
- **เอกสารอ้างอิง:** `docs/audit/AUDIT_REPORT.md`, `docs/audit/REMEDIATION_REPORT.md`

---

## 1. Camera Golden Configuration (ค่ามาตรฐานที่ต้องตั้งบนกล้องทุกตัว)

ก่อนนำกล้องแต่ละตัวแอดเข้าสู่ระบบ CCTV Platform ต้องล็อกอินเข้า Web Management ของกล้องแต่ละตัวเพื่อกำหนดค่าตามเกณฑ์มาตรฐานความเข้ากันได้ของระบบ (Golden Baseline):

### 1.1 วิดีโอสตรีมหลัก (Main Stream — High Quality Recording & Fullscreen Live)
- **Video Encoding:** `H.264` (Main/High Profile) หรือ `H.265 / HEVC`
- **Resolution:** `1920x1080` (1080p Full HD) หรือตามความละเอียดฮาร์ดแวร์จริง
- **Frame Rate (FPS):** `15 - 25 FPS` (แนะนำ `20 FPS` เพื่อความลื่นไหลและประหยัด Bandwidth)
- **Bitrate Control:** `CBR` (Constant Bitrate) เพื่อคำนวณพื้นที่จัดเก็บบันทึกล่วงหน้าได้แม่นยำ
- **Bitrate Target:** `2048 - 4096 kbps` (สำหรับ 1080p)
- **Keyframe Interval (I-Frame Period / GOP):** **1x ถึง 2x ของ FPS** (เช่น FPS = 20 ให้ตั้ง I-Frame = `20` หรือ `40`)
  > *เหตุผลเชิงเทคนิค:* MediaMTX lowLatency HLS กำหนด `hlsSegmentDuration: 2s` และ `hlsSegmentCount: 7` การตั้ง GOP สั้น (1-2s) ช่วยให้การสลับภาพ WebRTC เร็วทันที และสร้าง HLS Segment ได้ตรงขอบ I-Frame ป้องกันภาพกระตุก

### 1.2 วิดีโอสตรีมย่อย (Sub-stream — 4-Grid Monitoring & Mobile WebRTC)
- **Video Encoding:** **บังคับ H.264 เท่านั้น** (Baseline หรือ Main Profile) **ห้ามตั้งเป็น H.265 / HEVC เด็ดขาด**
  > *เหตุผลเชิงเทคนิค:* WebRTC บนเบราว์เซอร์ Chrome/Edge/Firefox บนอุปกรณ์ทั่วไปและมือถือไม่รองรับ Hardware HEVC Decoding เสมอไป การบังคับ Sub-stream เป็น H.264 จะรับประกันว่าการเปิดดูพร้อมกัน 4 ช่อง (4-Grid) หรือ 9 ช่อง จะเปิดติด 100% โดยไม่มีปัญหาจอเขียวหรือกิน CPU สูง
- **Resolution:** `640x360` หรือ `720p (1280x720)`
- **Frame Rate (FPS):** `15 FPS`
- **Bitrate Target:** `512 - 1024 kbps`
- **Keyframe Interval (GOP):** `15 - 30` (1-2 วินาที)

### 1.3 สัญญาณเสียง (Audio Stream)
- **Audio Codec:** แนะนำให้เลือก `AAC` หรือ `Opus`
- **หากกล้องรองรับเฉพาะ G.711 (PCMA / PCMU):** สตรีมภาพจะทำงานได้ปกติ แต่เสียงบน WebRTC จะต้องผ่านโมดูล Remux ของ MediaMTX

### 1.4 การตั้งเวลาและการซิงก์เครือข่าย (NTP Time Synchronization)
- **Timezone:** เลือก `GMT+07:00` หรือ `Asia/Bangkok`
- **NTP Server:** ชี้ไปยัง IP ของ Server กลาง หรือ `pool.ntp.org` (หากอนุญาตให้ออกภายนอก)
- **Sync Interval:** ทุก 60 นาที (ห้ามเวลาของกล้องคลาดเคลื่อนเกิน 1 วินาที เพื่อให้ Timestamp วิดีโอสอดคล้องกับ Security Watermark และ Incident Timeline)

---

## 2. Pre-Flight Hardware Verification (ขั้นตอนทดสอบก่อนขึ้นระบบจริง)

ทีมวิศวกรภาคสนามต้องใช้สคริปต์ตรวจสอบฮาร์ดแวร์ `scripts/pilot-verify-cameras.mjs` ก่อนทำการ Add กล้องเข้าระบบ CCTV

### 2.1 เตรียมไฟล์คอนฟิกกล้องหน้างาน
คัดลอกไฟล์ตัวอย่าง `scripts/pilot-cameras.example.json` ไปเป็น `scripts/pilot-cameras.json` แล้วกรอก IP, Username, Password ของกล้องจริง:
```bash
cp scripts/pilot-cameras.example.json scripts/pilot-cameras.json
```

### 2.2 ตรวจสอบ Syntax และทดสอบระบบจำลอง (Dry-Run Check)
```bash
node scripts/pilot-verify-cameras.mjs --dry-run
```
*เกณฑ์การผ่าน:* คำสั่งต้องรันผ่านและได้ Exit Code 0 พร้อมพิมพ์ตารางสรุปสถานะ

### 2.3 รันตรวจสอบกล้องจริง 10 ตัวผ่านเครือข่ายหน้างาน
```bash
node scripts/pilot-verify-cameras.mjs --config scripts/pilot-cameras.json --timeout 3000
```
สคริปต์จะทำการ:
1. เช็ก TCP Handshake ไปยังพอร์ต 554 (RTSP) และ 80/8080 (HTTP/ONVIF) ภายใน 3 วินาที
2. สั่ง `ffprobe` ดึงข้อมูล Codec, Resolution, FPS, Audio ของทั้ง Main Stream และ Sub-stream
3. บันทึกผลลัพธ์ลงในไฟล์ `pilot-wave1-verification-report.json`

**เกณฑ์การยอมรับ (Acceptance Criteria):**
- ทุกกล้องต้องขึ้นสถานะ `PASS` หรือ `WARN`
- ห้ามมีกล้องใดขึ้นสถานะ `FAIL` (หากขึ้น `FAIL` ให้ตรวจสอบสายแลน, PoE Switch, IP ซ้ำ, หรือรหัสผ่านกล้อง)
- กล้องที่มี `WARN` ต้องเป็นประเด็น Audio G.711 เท่านั้น (ห้าม Sub-stream เป็น HEVC)

---

## 3. Live Acceptance Test (UAT Checklist หน้างานจริง)

หลังจากกล้องทั้ง 10 ตัวผูกเข้าสู่ระบบ MediaMTX และระบบแสดงผลใน Web App ให้ดำเนินการทดสอบ Acceptance Test ตามรายการดังนี้:

### UAT-01: ถอดสายแลนแล้วระบบแจ้งสถานะกล้อง (เกณฑ์อนุมัติ 2026-11-07)
1. เปิด Live Grid และเลือกกล้องเป้าหมาย สถานะต้องเป็น `ONLINE`
2. ถอดสายแลนของกล้อง แล้วจับเวลา:
   - **มีคนดู:** เป็น `OFFLINE` ภายใน **15 วินาที** ระบบตรวจพอร์ตกล้องทันทีเมื่อสตรีมปิด
   - **ไม่มีคนดู:** เป็น `OFFLINE` ภายใน **3 นาที** จากรอบตรวจทุกนาที
   - **แจ้งเตือนและ Incident:** เกิดตามเวลาของระดับการแจ้งเตือนของกล้อง โดยยอมให้ช้ากว่าที่ตั้งได้ประมาณ 1 นาทีจากรอบตรวจ
3. เสียบสายกลับ สถานะต้องผ่าน `RECOVERING` และเป็น `ONLINE` ภายใน **3 นาที** หลังกล้องตอบ และแจ้งเตือนต้องปิดเอง
4. ถอดสายซ้ำอีกครั้งภายใน 15 นาที ต้องเกิดแจ้งเตือน critical ใหม่ (ครั้งที่ 3 ใน 15 นาทีจะถูกบันทึกเป็น flapping โดยไม่แจ้งใหม่)

**ผู้ใช้อนุมัติเมื่อ 2026-11-07 หลังเพิ่มระดับการแจ้งเตือน:** เกณฑ์แจ้งเตือนเดิม 15 วินาทีและ 3 นาทีถูกแทนด้วยเวลาตามระดับ ค่าเริ่มต้น "ปกติ" แจ้งเตือนที่ 5 นาที และ "สำคัญ" แจ้งเตือนภายในประมาณ 2 นาที ข้อ 4 ต้องใช้การหลุดที่นานเกินเวลาแจ้งเตือนของระดับนั้น

**ทำไมไม่ใช้ 3 วินาที:** กล้องที่ไม่มีคนดูไม่มีสตรีมให้จับการหลุด และการลดเวลารอสัญญาณของ MediaMTX เสี่ยงตัดภาพเมื่อเครือข่ายสะดุด

### UAT-02: ทดสอบ FFmpeg Clip Export Concurrency Queue (`ENH-02`)
1. เปิดหน้าต่างเบราว์เซอร์ 2 หน้าต่าง หรือให้เจ้าหน้าที่ 2 ท่านเข้าสู่หน้า `CctvPlayback`
2. กดคำสั่ง **Export Video Clip** ในช่วงเวลาเดียวกันพร้อมกัน **3 งาน (3 Concurrent Requests)**
3. สังเกตสถานะในระบบและการตอบสนองของเซิร์ฟเวอร์:
   - **พฤติกรรมที่คาดหวัง:**
     - 2 งานแรกจะขึ้นสถานะ `PROCESSING` ทันที
     - งานที่ 3 จะเข้าสู่สถานะ `QUEUED` และรออยู่ในคิว
     - การประมวลผลวิดีโอทำงานด้วย Stream Copy (`-c copy -movflags +faststart`) CPU ของเซิร์ฟเวอร์ไม่พุ่งสูง
     - เมื่องานใดงานหนึ่งเสร็จสิ้น งานที่รออยู่ในสถานะ `QUEUED` จะเปลี่ยนสถานะเป็น `PROCESSING` อัตโนมัติ
   - **ผลลัพธ์:** ไฟล์คลิปที่ได้มีค่า `SHA-256 Checksum` ตรงกับเนื้อไฟล์ สามารถเปิดเล่นได้ปกติ และระบบบันทึก Audit Log ครบถ้วน

### UAT-03: ตรวจสอบ Dynamic Security Watermark Overlay (`ENH-04`)
> ผู้ใช้อนุมัติเมื่อ 2026-11-07: ลายน้ำปิดเป็นค่าเริ่มต้น เปิดได้ที่หน้าตั้งค่า (`watermark_enabled`) ทดสอบข้อนี้เฉพาะเมื่อเปิดใช้
1. เข้าสู่หน้าจอ `LiveGrid` และคลิกดูสดกล้องตัวใดก็ได้ผ่าน `WhepPlayer`
2. ตรวจสอบองค์ประกอบของลายน้ำบนจอภาพ:
   - **ข้อมูลที่ต้องปรากฏ:** `[ชื่อผู้ใช้ / บทบาท] • [Session ID หรือ IP] • [วัน-เวลา Asia/Bangkok ปัจจุบัน]`
   - **การอัปเดต:** ตัวเลขเวลาต้องเดินแบบเรียลไทม์ (Tick ทุก 1 วินาที)
   - **ความโปร่งแสง:** สวยงาม ไม่บดบังรายละเอียดภาพสำคัญ (Opacity ~18%) และคลิกทะลุได้ (`pointer-events: none`)
   - **การป้องกันการครอป:** ลายน้ำมีการขยับปรับตำแหน่งอย่างนุ่มนวลทุกๆ 30 วินาที
3. กดปุ่ม **Fullscreen (เต็มหน้าจอ)**:
   - ลายน้ำต้องยังคงปรากฏลอยอยู่เหนือเลเยอร์วิดีโอตลอดเวลา ไม่หลุดหายไป

### UAT-04: ตรวจสอบความถูกต้องของไทม์ไลน์และ Timezone (`AUDIT-MED-01`)
1. สร้าง Incident ทดสอบในหน้า `IncidentCenter`
2. คลิกปุ่ม **Jump to Playback**
3. ตรวจสอบว่าหน้า `CctvPlayback` เลื่อน Marker ไปยังวินาทีของเวลาเกิดเหตุตรงกันพอดีในโซนเวลา `Asia/Bangkok (UTC+7)` โดยไม่มีการคลาดเคลื่อน 7 ชั่วโมง

---

## 4. บันทึกผลการตรวจรับและลงนามอนุมัติ (Sign-off)

| หัวข้อการทดสอบ | เกณฑ์การผ่าน | ผลการทดสอบ (Pass / Fail) | ผู้ทดสอบ | วันที่ |
|---|---|:---:|---|---|
| **Pre-Flight Hardware Probe** | กล้อง 10 ตัว PASS/WARN ไม่มี FAIL | | | |
| **ถอดสายแลน** | มีคนดูแจ้งใน 15 วินาที, ไม่มีคนดูแจ้งใน 3 นาที, กลับ online ใน 3 นาที | | | |
| **Export Concurrency Queue** | 2 รันพร้อมกัน, 1 รอในคิว, CPU ปกติ | | | |
| **Security Watermark** | ลายน้ำขยับทุก 30s, แสดงข้อมูลครบ, Fullscreen ติด | | | |
| **Timezone Playback Sync** | เวลาในเหตุการณ์ตรงกับคลิปใน UTC+7 | | | |

*เมื่อผ่านการทดสอบครบทุกข้อ ให้ผู้รับผิดชอบเข้าหน้า `Release Center` เพื่อทำการลงนาม Digital Sign-off สำหรับ Wave 1.*
