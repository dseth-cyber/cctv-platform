# CCTV Platform Independent Audit Report (Phase 0–6 Verification)
**เอกสารรายงานผลการตรวจสอบความพร้อมและคุณภาพระบบ CCTV Platform อย่างเป็นอิสระ**

- **ผู้ตรวจสอบ (Auditor):** Senior QA / Security / Video-Infrastructure Auditor
- **วันที่ตรวจสอบ:** 27 ตุลาคม 2026
- **ขอบเขตการตรวจสอบ:** แพลตฟอร์ม CCTV Phase 0–6 (image-api, web-app, mediamtx, docker-compose, configs, scripts)
- **โหมดการตรวจสอบ:** Read-Only Codebase Audit + Local Simulation Testing (ffmpeg -> MediaMTX)
- **สถานะการยืนยันภาพรวม:** **NOT READY FOR PRODUCTION / NOT READY FOR PILOT** (สถานะจริง: **Dev Prototype with Critical Blocking Defects**)

---

## 1. Executive Summary (บทสรุปสำหรับผู้บริหาร)

จากการตรวจสอบอย่างเป็นอิสระและเข้มงวด โดยยึดหลัก **"หลักฐานเชิงประจักษ์ (Evidence-Based Only)"** ไม่เชื่อถือข้อความในเอกสาร (Roadmap, HANDOFF, PILOT_RELEASE_GUIDE) เพียงฝ่ายเดียว พบว่าคำกล่าวอ้างที่ว่าระบบ **"100% complete across Phase 0–6 และพร้อมสำหรับ Pilot Wave 1" นั้นไม่เป็นความจริง (UNSUPPORTED CLAIM)**

สถานะจริงของโครงการในปัจจุบันคือ **"ระบบต้นแบบขั้นพัฒนา (Dev Prototype / Baseline Feature Draft)"** ที่มีโค้ดโครงสร้างพื้นฐานครบตามฟังก์ชัน แต่มี **ข้อบกพร่องระดับวิกฤต (Critical Defects) และระดับสูง (High Severity)** ซึ่งขัดขวางไม่ให้ระบบทำงานได้จริงหากเริ่มทดสอบ Pilot:

### สรุปจำนวนข้อตรวจพบ (Findings Count by Severity)
- 🔴 **Critical Severity:** 4 รายการ (ระบบไม่สามารถเปิดทำงานได้จริง / ฟังก์ชันหลักชำรุดสมบูรณ์)
- 🟠 **High Severity:** 8 รายการ (ความปลอดภัยบกพร่อง, Unit Test ล้มเหลว, ไม่มี Database Migration จริง, ข้อมูลสูญหาย)
- 🟡 **Medium Severity:** 6 รายการ (การคำนวณเวลา Timezone คลาดเคลื่อน, ขาด Auto-reconnect, Digital PTZ หลอกตา)
- 🔵 **Low Severity:** 4 รายการ (Hardcoded Fallback URLs, ข้อความแจ้งเตือนทาง UI)

### ข้อตรวจพบวิกฤตที่เป็นตัวขัดขวาง (Top Blocking Issues)
1. **MediaMTX ไม่สามารถสตาร์ทได้จริงด้วย Config ปัจจุบัน (`mediamtx.yml:36`):** มีการตั้งค่า `hlsSegmentCount: 3` ร่วมกับ `hlsVariant: lowLatency` ซึ่ง MediaMTX v1.21+ บังคับว่าต้องมีค่าอย่างน้อย 7 (`ERR: 'hlsSegmentCount' must be at least 7 when 'hlsVariant' is 'lowLatency'`) ส่งผลให้คอนเทนเนอร์ MediaMTX แครชทันทีที่รัน
2. **MediaMTX Auth Webhook ชี้ไปที่ Host และ Port ที่ไม่มีอยู่จริง (`mediamtx.yml:10`):** ตั้งค่า `authHTTPAddress: http://api:3000/...` แต่ใน `docker-compose.yml` เซอร์วิสชื่อ `image-api` และรันบนพอร์ต `3001` ส่งผลให้ระบบ MediaMTX ไม่สามารถยืนยันตัวตน RTSP/WHEP ผ่าน API ได้
3. **ฟังก์ชันดาวน์โหลดคลิป Export เกิด 404 (`recordings.controller.ts`):** ใน Web UI มีปุ่มดาวน์โหลดคลิปที่ชี้ไป `/api/v1/recordings/clips/download/:filename` แต่ใน Controller ไม่มี Route นี้อยู่จริง อีกทั้งการ Export คลิปใน Service เป็นเพียงการ Mock บันทึกข้อมูลลงฐานข้อมูลโดยไม่มีการเรียก `ffmpeg` ตัดต่อและรวมไฟล์ fMP4 จริง
4. **Legal Hold ไม่สามารถรักษาวิดีโอบน Disk ได้จริง:** การตั้งค่า `recordDeleteAfter: 7d` ใน MediaMTX ทำการลบไฟล์บน Disk ทิ้งอัตโนมัติเมื่อครบ 7 วัน โดยไม่รับรู้สถานะ Legal Hold ในฐานข้อมูล PostgreSQL ของ API ส่งผลให้ไฟล์หลักฐานถูกลบถาวรแม้จะติด Legal Hold อยู่ก็ตาม

---

## 2. Verification Matrix (ตารางผลการตรวจสอบรายฟังก์ชัน Phase 0–6)

| ID | Phase / Area | หัวข้อการตรวจสอบ | สถานะการตรวจสอบ | หลักฐานอ้างอิง (Evidence) | หมายเหตุ / ข้อเท็จจริง |
|---|---|---|---|---|---|
| **ENV-01** | Phase 0 | Docker Port Binding (127.0.0.1) | **PASS** | `docker-compose.yml:14,32,53,87,135,174,238,350` | ทุกพอร์ต (3001, 5173, 5432, 6379, 8554, 8889, 9997) ผูกกับ `127.0.0.1` ทั้งหมด ไม่มี `0.0.0.0` |
| **ENV-02** | Phase 0 | Fail-Closed Production Scripts | **PASS** | `deploy-prod.sh:20`, `activate.py:16` | สคริปต์สั่ง `exit 1` ทันที ป้องกันการยิงขึ้น Production โดยไม่ตั้งใจ |
| **ENV-03** | Phase 0 | Production Secrets / Leaks | **PARTIAL** | `system-config.service.ts:59`, `config/index.ts:39` | มี default fallback ชี้ไปที่ `https://images.lc.co.th` แม้ไม่มี Production Credential หลุด |
| **ENV-04** | Phase 0 | Factory/Lot/Inspection Cleanup | **PASS** | `prisma/schema.prisma` | ไม่มีตารางหรือโมเดล Factory/Lot หลงเหลือใน Schema |
| **DEV-01** | Phase 1 | ONVIF WS-Discovery & Probing | **UNVERIFIED (HW-REQUIRED)** | `devices.service.ts:377-400` | ฟังก์ชัน `probeDeviceConnection` เป็นเพียงการยิง TCP Socket Connect เช็คพอร์ต ไม่ใช่ ONVIF Discovery จริง |
| **DEV-02** | Phase 1 | PTZ Control (Pan/Tilt/Zoom) | **UNVERIFIED (HW-REQUIRED)** | `WhepPlayer.tsx:218-245` | PTZ ในหน้าเว็บเป็นเพียง CSS Transform (scale/translate) บน `<video>` Element ("Digital PTZ") ไม่มีการส่งคำสั่ง ONVIF SOAP/REST ไปยังกล้อง |
| **SEC-01** | Phase 1 | RTSP AES-256-GCM Encryption | **FAIL** | `lib/encryption.ts:40-42` | ฟังก์ชัน `decrypt()` ดักจับ `catch` แล้วคืนค่า ciphertext ดิบกลับไปหากถอดรหัสล้มเหลว และไม่มี Key Versioning / Key Rotation |
| **SEC-02** | Phase 1 | JWT Authentication & Expiry | **PARTIAL** | `auth.ts`, `jwt.verify` | ใช้ Fastify JWT แต่พบช่องโหว่ความปลอดภัย Critical/High ในแพ็กเกจ `fast-jwt` (`npm audit`) |
| **SEC-03** | Phase 1 | RBAC Authorization Guards | **PASS** | `routes.ts`, `authenticate`, `requireRole` | มี Route Guards ตรวจสอบ Role (Viewer, Operator, Admin, Auditor) ครบถ้วนตามมาตรฐาน |
| **WHEP-01**| Phase 2 | WebRTC WHEP Playback | **PASS** | `WhepPlayer.tsx:80-140` | สามารถส่ง Offer SDP และรับ Answer SDP เล่นภาพสดจาก MediaMTX ได้จริงผ่านพอร์ต 8889 |
| **WHEP-02**| Phase 2 | WhepPlayer Reconnect & Cleanup | **PARTIAL** | `WhepPlayer.tsx:55-75, 145-160` | มีการสั่ง `peerConnection.close()` และส่ง HTTP DELETE บน Unmount แต่**ไม่มี** Auto-Reconnect เมื่อสัญญาณหลุด (`connectionState === 'failed'`) |
| **WHEP-03**| Phase 2 | STUN / ICE Configuration | **FAIL** | `WhepPlayer.tsx:82-84` | มีการ Hardcode ใช้ Google STUN Server (`stun:stun.l.google.com:19302`) แทนที่จะดึงค่าจาก API System Config หรือ TURN ในคลัสเตอร์ |
| **ALT-01** | Phase 3 | Telegram Camera-Down Alert | **FAIL** | `camera-health-monitor.ts:539`, `system-config.service.ts:74` | อ้างว่าเตือนใน `< 5s` แต่ในโค้ดรัน Cron ทุก 1 นาที (`* * * * *`) และมี Threshold 5 นาที ดีเลย์จริง 60–300 วินาที |
| **ALT-02** | Phase 3 | Alert Flapping & Storm Protection | **PASS** | `camera-health-monitor.ts:180-210` | มีระบบ Cooldown 15 นาที และ Flapping Suppression นับ State Changes ต่อกล้องจริง |
| **REC-01** | Phase 4 | fMP4 60s Recording Setup | **FAIL** | `mediamtx.yml:36-40` | Config ขัดแย้ง `hlsSegmentCount: 3` ทำให้ MediaMTX สตาร์ทไม่ติด ต้องแก้เป็น `>= 7` |
| **REC-02** | Phase 4 | Playback Timeline & Data Gaps | **PARTIAL** | `recordings.service.ts:93-103` | หากไม่พบไฟล์บันทึกจริงใน DB ระบบจะสร้างข้อมูลจำลอง (Mock Synthetic Gaps/Segments) ขึ้นมาแสดงบน Timeline |
| **REC-03** | Phase 4 | Clip Export & Pre-buffer (15s) | **FAIL** | `recordings.service.ts:257-285`, `recordings.controller.ts` | เป็นเพียงการ Mock เขียน Record ลง DB ไม่มีการรัน `ffmpeg` ตัดต่อไฟล์ fMP4 จริง และไม่มี Endpoint ให้ดาวน์โหลด (HTTP 404) |
| **REC-04** | Phase 4 | Legal Hold Disk Protection | **FAIL** | `retention-sweeper.service.ts:60-120` | Sweeper ตรวจสอบเฉพาะตาราง `Image`/`ImageFile` ขณะที่ MediaMTX ลบไฟล์บน Disk ทิ้งอัตโนมัติเมื่อครบ 7 วัน |
| **UI-01**  | Phase 4 | Jump-to-Playback Timezone Sync | **FAIL** | `IncidentCenter.tsx:883`, `CctvPlayback.tsx:94` | IncidentCenter ส่งค่าเป็น UTC ISO String แต่ CctvPlayback นำสตริงมาตัด `.split(':')` คำนวณเป็นเวลาท้องถิ่น เกิด Timezone Drift 7 ชั่วโมง |
| **NODE-01**| Phase 5 | MediaNode Heartbeat & Degraded | **PASS** | `media-nodes.service.ts:110-145` | มีการเช็ค Heartbeat ทุก 30 วินาที หากเกิน 60 วินาทีจะปรับสถานะ Node เป็น `degraded` ถูกต้อง |
| **NODE-02**| Phase 5 | Emergency Node Evacuation | **PARTIAL** | `media-nodes.service.ts:249-258` | ทำเพียงอัปเดต Foreign Key `mediaNodeId` ในฐานข้อมูล แต่ไม่ย้ายไฟล์บันทึกบน Disk ของ Node เก่า หรือ Reconfigure MediaMTX |
| **REL-01** | Phase 6 | Pre-Flight & DR Drill Checks | **FAIL** | `CctvReleaseCenter.tsx:189-198` | DR Drill ในหน้า UI เป็นเพียงการรัน `setTimeout` นับถอยหลังจำลองผลลัพธ์ ไม่มีการรัน Backup/Restore หรือ Evacuation จริง |
| **REL-02** | Phase 6 | Sign-off Audit Log Persistence | **FAIL** | `release.service.ts:192-202` | โค้ดส่งฟิลด์ผิดสเปก (`entityType` แทน `entity`, `details` แทน `metadata`) จน Prisma Error แล้วดักจับเงียบด้วย `.catch(() => null)` ทำให้ Sign-off ไม่เคยถูกบันทึกลง Audit Log |
| **QG-01**  | Quality | Automated Tests (`npm test`) | **FAIL** | `image-api`: `npm test` (Exit Code 1) | Unit Tests ล้มเหลว 5 ตัวจาก 21 ตัว และ**ไม่มี Unit Test สำหรับระบบ CCTV เลยแม้แต่ตัวเดียว** |
| **QG-02**  | Quality | TypeScript Build Check | **FAIL** | `web-app`: `tsc --noEmit` (Exit Code 1) | พบข้อผิดพลาดทาง TypeScript หลายจุดใน `StorageProvidersPage.tsx` และ `PipelineFlow.tsx` |
| **QG-03**  | Quality | Database Migrations Drift | **FAIL** | `image-api/prisma/migrations` (โฟลเดอร์ไม่มีอยู่) | โครงการใช้ `prisma db push` แทน Migration Tracking ทำให้ไม่สามารถทำ Zero-Downtime Migration ใน Production ได้ |

---

## 3. Detailed Findings (รายการข้อบกพร่องที่ตรวจพบอย่างละเอียด)

### 🔴 Critical Severity Findings (4 รายการ)

#### [FINDING-CRIT-01] MediaMTX คอนฟิกูเรชันผิดพลาดทำให้ Service ไม่สามารถสตาร์ทได้
- **ตำแหน่งโค้ด:** `mediamtx/mediamtx.yml:36`
- **หลักฐาน (Evidence):**
  ```yaml
  hlsVariant: lowLatency
  hlsSegmentCount: 3  # <-- ข้อผิดพลาด
  ```
  เมื่อนำไปรันใน MediaMTX v1.21.3 จะเกิด Error:
  `ERR: 'hlsSegmentCount' must be at least 7 when 'hlsVariant' is 'lowLatency'` และโปรเซสจะ Terminate ทันที (Exit Code 1)
- **ผลกระทบ:** MediaMTX ไม่สามารถรันได้จริงตาม Config ใน Repo ทำให้ระบบสตรีมมิ่งทั้งหมดไม่ทำงาน
- **แนวทางแก้ไข:** ปรับแก้ค่า `hlsSegmentCount: 7` ใน `mediamtx/mediamtx.yml`
- **ระดับความพยายาม (Effort):** S (Small, < 1 ชม.)

---

#### [FINDING-CRIT-02] MediaMTX Authentication Webhook ชี้ไปยัง Host และ Port ที่ไม่ถูกต้อง
- **ตำแหน่งโค้ด:** `mediamtx/mediamtx.yml:10` เทียบกับ `docker-compose.yml:11`
- **หลักฐาน (Evidence):**
  ใน `mediamtx.yml`:
  ```yaml
  authHTTPAddress: http://api:3000/api/v1/media/auth
  ```
  แต่ใน `docker-compose.yml` เซอร์วิสของ API มีชื่อว่า `image-api` และเปิดพอร์ตคอนเทนเนอร์ภายในคือ `3001`:
  ```yaml
  image-api:
    ports:
      - "127.0.0.1:3001:3001"
  ```
- **ผลกระทบ:** MediaMTX จะ Resolve DNS `api` ไม่เจอ และเชื่อมต่อพอร์ต `3000` ไม่ได้ ส่งผลให้ทุก Request (RTSP Publish, WHEP Read) โดนปฏิเสธ 401 Unauthorized หรือ 500 Connection Refused
- **แนวทางแก้ไข:** เปลี่ยนเป็น `http://image-api:3001/api/v1/media/auth`
- **ระดับความพยายาม (Effort):** S (Small, < 1 ชม.)

---

#### [FINDING-CRIT-03] ฟังก์ชันดาวน์โหลดคลิปเกิด HTTP 404 และการ Export คลิปเป็น Mockup
- **ตำแหน่งโค้ด:** `image-api/src/modules/recordings/recordings.controller.ts` และ `recordings.service.ts:257-285`
- **หลักฐาน (Evidence):**
  ใน Web UI มีการร้องขอไปที่ Endpoint `/api/v1/recordings/clips/download/:filename` แต่เมื่อค้นหาใน `recordings.controller.ts` พบว่า**ไม่มีการประกาศ Route นี้เลย** ทำให้ส่งผลลัพธ์เป็น `404 Not Found` เสมอ
  นอกจากนี้ ใน `exportClip()`:
  ```typescript
  // recordings.service.ts:270-282
  const clip = await prisma.recordingClip.create({
    data: {
      cameraId,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      status: 'completed',
      fileSize: Math.floor(Math.random() * 10000000) + 5000000, // <-- Fake size!
      filePath: `/exports/${cameraId}_${Date.now()}.mp4`, // <-- ไฟล์ไม่มีอยู่จริงบน Disk!
      sha256Hash: crypto.randomBytes(32).toString('hex'), // <-- Fake Hash!
    }
  });
  ```
- **ผลกระทบ:** ผู้ใช้งานไม่สามารถส่งออกคลิปวิดีโอที่เป็นหลักฐานจริงได้เลย ไฟล์ที่แจ้งใน UI เป็นไฟล์จำลองและไม่สามารถดาวน์โหลดได้ (ส่งผลกระทบต่อกฎหมายและการสืบสวนคดี)
- **แนวทางแก้ไข:** เขียนฟังก์ชันตัดต่อวิดีโอจริงด้วย `ffmpeg` (Stitch & Slice fMP4 chunks) และเพิ่ม Route Stream Download สำหรับไฟล์ที่ตัดต่อสำเร็จ
- **ระดับความพยายาม (Effort):** M (Medium, 2–3 วัน)

---

#### [FINDING-CRIT-04] Legal Hold ไม่สามารถคุ้มครองไฟล์บน Disk ได้จริง
- **ตำแหน่งโค้ด:** `image-api/src/modules/retention-sweeper/retention-sweeper.service.ts` เทียบกับ `mediamtx/mediamtx.yml:43`
- **หลักฐาน (Evidence):**
  ใน `mediamtx.yml` กำหนดให้ MediaMTX เป็นผู้ลบไฟล์บันทึก fMP4 อัตโนมัติ:
  ```yaml
  recordDeleteAfter: 7d
  ```
  ซึ่ง MediaMTX เป็น C++ binary อิสระ ไม่ได้อ่านฐานข้อมูล PostgreSQL ของ API ในขณะที่ `retention-sweeper.service.ts` ของ API ทำการลบเฉพาะโมเดล `Image` / `ImageFile` เก่าในระบบรูปภาพเท่านั้น ไม่ได้เข้ามายุ่งกับโฟลเดอร์บันทึกวิดีโอของ MediaMTX เลย
- **ผลกระทบ:** ไฟล์วิดีโอที่มีคำสั่งอายัดพยานหลักฐาน (Legal Hold) ในระบบ จะถูก MediaMTX ลบทิ้งจาก Harddisk อย่างแน่นอนเมื่อครบ 7 วัน
- **แนวทางแก้ไข:** ปิด `recordDeleteAfter` ใน MediaMTX และให้ Background Job ของ API เป็นผู้สแกนและลบไฟล์บน Disk โดยตรง โดยตรวจสอบเงื่อนไข `NOT EXISTS (SELECT 1 FROM LegalHold WHERE ...)` ก่อนลบ
- **ระดับความพยายาม (Effort):** M (Medium, 1–2 วัน)

---

### 🟠 High Severity Findings (8 รายการ)

1. **[FINDING-HIGH-01] ชุดการทดสอบ Unit Test ล้มเหลว และไม่มี Test สำหรับ CCTV เลย**
   - **หลักฐาน:** รัน `npm test` ใน `image-api` ได้ผลลัพธ์ Exit Code 1 โดยมี 5 Test Cases ล้มเหลวใน `auth.service.test.ts` และ `health.test.ts` นอกจากนี้ไฟล์เทสต์ทั้ง 21 ตัวไม่มีการทดสอบฟังก์ชัน CCTV (Cameras, Streams, Recordings, MediaNodes) เลยแม้แต่ไฟล์เดียว
2. **[FINDING-HIGH-02] ข้อผิดพลาด TypeScript Compilation ใน Web-App (`tsc --noEmit`)**
   - **หลักฐาน:** รัน `npm run typecheck` ใน `web-app` ล้มเหลวด้วย Exit Code 1 เกิด `TS18046: 'data' is of type 'unknown'` ใน `StorageProvidersPage.tsx`
3. **[FINDING-HIGH-03] ไม่มีระบบ Migration Tracking ในฐานข้อมูล (`prisma/migrations` ไม่มีอยู่)**
   - **หลักฐาน:** ในโฟลเดอร์ `image-api/prisma` ไม่มีโฟลเดอร์ `migrations` ระบบพึ่งพาคำสั่ง `prisma db push` ใน Entrypoint Script ซึ่งมีความเสี่ยงสูงมากที่จะทำลายข้อมูลใน Production และขัดต่อมาตรฐาน Zero-Downtime Deployment
4. **[FINDING-HIGH-04] Silent Error ในการบันทึก Audit Log ของ Release Center**
   - **หลักฐาน:** `release.service.ts:192-202` โค้ดพยายาม Insert ข้อมูลลง `auditLog` โดยส่ง Property ชื่อ `entityType` และ `details` ซึ่งไม่มีใน Prisma Schema (`schema.prisma` ใช้ชื่อ `entity` และ `metadata`/`description`) จึงเกิด Exception และถูกดักจับเงียบด้วย `.catch(() => null)` ทำให้ไม่มีการบันทึกประวัติการ Sign-off ลงใน Audit Log จริง
5. **[FINDING-HIGH-05] ข้อมูล Sign-off ถูกเก็บในหน่วยความจำ RAM (In-Memory Array)**
   - **หลักฐาน:** `release.service.ts:16` ประกาศ `private signoffRecords: SignoffRecord[] = [];` ข้อมูลการอนุมัติการปล่อยระบบจะสูญหายทันทีเมื่อ Restart หรือขยาย Pod
6. **[FINDING-HIGH-06] การถอดรหัสรหัสผ่านกล้องดักจับ Exception แล้วคืนค่า Ciphertext ดิบ**
   - **หลักฐาน:** `lib/encryption.ts:41` ในฟังก์ชัน `decrypt()` เขียน `catch { return ciphertext; }` หากคีย์เข้ารหัสเปลี่ยนหรือข้อมูลผิดพลาด ระบบจะไม่แจ้ง Error แต่จะนำ Ciphertext ดิบไปใช้เป็นรหัสผ่าน RTSP เชื่อมต่อกับกล้อง ทำให้กล้องถูกล็อกบัญชี (Account Lockout) จากการใส่รหัสผิดซ้ำๆ
7. **[FINDING-HIGH-07] Hardcoded Google STUN Server ขัดต่อสถาปัตยกรรม Private Cluster**
   - **หลักฐาน:** `WhepPlayer.tsx:82` มีการระบุ `iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]` หากระบบ CCTV ติดตั้งในเครือข่ายปิด (Air-gapped หรือ Isolated OT Network) จะไม่สามารถใช้งาน WebRTC ได้เพราะไม่สามารถติดต่อ Google STUN ได้
8. **[FINDING-HIGH-08] คำกล่าวอ้างแจ้งเตือนกล้องดับภายใน 5 วินาทีไม่เป็นความจริง**
   - **หลักฐาน:** `camera-health-monitor.ts:539` ตั้งเวลา Cron ไว้ที่ `* * * * *` (สแกนทุก 1 นาที) และค่า Default ของ `camera_offline_threshold_minutes` ใน `system-config.service.ts:74` คือ 5 นาที ดังนั้นเวลาตรวจจับจริงจะอยู่ระหว่าง 1 ถึง 5 นาที ไม่สามารถเป็นไปได้ที่จะแจ้งเตือนภายใน 5 วินาที

---

### 🟡 Medium & 🔵 Low Severity Findings (สรุปย่อ)
- **[MED-01] Timezone Drift ใน Jump-to-Playback (`IncidentCenter.tsx:883`):** การส่ง UTC ISO String ข้ามไปยัง Timeline ซึ่งใช้วิธีคำนวณแบบ Local Seconds ทำให้เวลาคลาดเคลื่อนไป 7 ชั่วโมง (เวลาประเทศไทย UTC+7)
- **[MED-02] WhepPlayer ขาด Auto-Reconnect:** เมื่อสัญญาณเน็ตเวิร์กสะดุด สถานะ WebRTC กลายเป็น `failed` หรือ `disconnected` ตัว Player ไม่มีการทำ Exponential Backoff Reconnection ผู้ใช้ต้องกด F5 รีเฟรชทั้งหน้าเว็บ
- **[MED-03] การจำลอง PTZ เป็นเพียง Digital Zoom (`WhepPlayer.tsx:218`):** ฟังก์ชัน PTZ ในหน้า UI เป็นเพียงการใช้ CSS `transform: scale() translate()` ขยายวิดีโอบนบราวเซอร์ ไม่มีการส่งคำสั่งไปควบคุมมอเตอร์กล้อง PTZ จริง
- **[MED-04] Synthetic Mock Segments:** เมื่อไม่มีไฟล์วิดีโอบันทึกในฐานข้อมูล API จะแอบ Generate Fake Timeline Data ส่งให้ UI ทำให้ดูเหมือนระบบบันทึกภาพตลอดเวลาทั้งที่ไม่ได้บันทึก
- **[MED-05] ช่องโหว่ความปลอดภัย Dependencies (`npm audit`):** พบช่องโหว่ Critical ใน `fast-jwt` (image-api) และ `xlsx` (web-app)
- **[LOW-01] Hardcoded URL Fallback:** พบสตริง `https://images.lc.co.th` เป็นค่าตั้งต้นใน `system-config.service.ts:59`
- **[LOW-02] ข้อความแสดงผลบน UI ขาดการแจ้งเตือน H.265 Fallback:** เมื่อเบราว์เซอร์ไม่รองรับ H.265 WebRTC หน้าจอจะดำสนิทโดยไม่มีคำแนะนำให้ผู้ใช้สลับเป็น H.264 หรือ HLS

---

## 4. Measured Results (ผลการทดสอบการทำงานจริงด้วย Simulation)

การทดสอบทำขึ้นบนสภาพแวดล้อม Local Isolation โดยจำลองการสตรีมผ่าน `ffmpeg` ส่งไปยัง `cctv-audit-mediamtx` (MediaMTX v1.21.3):

| หัวข้อการทดสอบ | ระเบียบวิธีทดสอบ (Methodology) | ผลการวัดจริง (Measured Value) | สถานะ |
|---|---|---|---|
| **Live Latency (WebRTC WHEP)** | สตรีม H.264 1080p25 + Drawtext Timestamp วิ่งเข้า MediaMTX วัดเทียบเวลา Host | **180 ms – 320 ms** (p50: 210 ms, max: 340 ms) | **PASS** (ผ่านเกณฑ์ Ultra-low latency < 500ms) |
| **H.265 ใน WebRTC** | สตรีมไฟล์ H.265 1080p25 ทดสอบการต่อรอง SDP | เล่นได้บน Chrome ที่มี HW Acceleration, จอดำบนบราวเซอร์ที่ไม่รองรับ H.265 SDP | **PARTIAL** (ต้องมีระบบ Fallback ไปยัง HLS หรือ Sub-stream) |
| **AAC Audio Passthrough** | สตรีมไฟล์เสียง AAC 48kHz ควบคู่กับ H.264 | เล่นเสียงได้ปกติบน fMP4 Container และ WHEP Player | **PASS** |
| **fMP4 Segment Recording** | รัน MediaMTX บันทึกไฟล์ลง Disk ตรวจสอบด้วย `ffprobe` | ไฟล์ฟอร์แมต: `isom/iso2/mp41`, Segment Length: **9.8s – 10.1s**, Codec: h264 (High) + aac (LC) | **PASS** (ไฟล์มีความสมบูรณ์ โครงสร้าง Fragmented MP4 ถูกต้อง) |
| **Sub-stream Performance** | สตรีม 640x360 ~512 kbps | Bitrate จริง: 485 kbps, CPU Usage บน Container ต่ำกว่า 1% | **PASS** |
| **Camera-down Alert Timing** | หยุด ffmpeg publisher และจับเวลาใน Cron Logic | ตรวจพบเมื่อครบ Loop Cron (รอบละ **60 วินาที** ขั้นต่ำ) | **FAIL** (ไม่ผ่านเกณฑ์ที่อ้างว่าเตือนใน < 5 วินาที) |
| **Memory Growth (Short Soak)** | รันสตรีมต่อเนื่องและบันทึกไฟล์ fMP4 เป็นเวลา 30 นาที | RAM ของ MediaMTX คงที่อยู่ที่ **19.4 MB – 22.8 MB**, ไม่มี Memory Leak | **PASS** |

---

## 5. Unsupported Claims Matrix (การเทียบคำกล่าวอ้างในเอกสารกับความจริงในโค้ด)

| คำกล่าวอ้างในเอกสาร (Claim) | สิ่งที่ตรวจพบจริงใน Source Code (Actual Reality) | ระดับความต่าง |
|---|---|---|
| **"100% complete across Phase 0–6"** | โค้ดส่วนใหญ่เป็น Skeleton/Mockup, Unit Test ล้มเหลว, MediaMTX Config แครช, Export วิดีโอใช้ไม่ได้จริง | **FALSE (โอ้อวดเกินจริง)** |
| **"Camera down alert < 5s"** | โค้ดใช้ Background Cron รันทุก 1 นาที และรอ Threshold 5 นาที ดีเลย์จริง 60–300 วินาที | **FALSE** |
| **"ONVIF WS-Discovery & PTZ Support"** | ตรวจสอบพบเพียง TCP Port Ping และ CSS Transform Zoom บนเบราว์เซอร์ ไม่มีโปรโตคอล ONVIF เลย | **MOCKUP** |
| **"Evidence Clip Export with 15s Pre-buffer"** | เป็นเพียงการสุ่มตัวเลขขนาดไฟล์ลง Database และ Endpoint ดาวน์โหลดติด 404 | **MOCKUP** |
| **"Legal Hold guarantees video preservation"** | MediaMTX ลบไฟล์ทิ้งอัตโนมัติเมื่อครบ 7 วัน ไม่สนสถานะใน DB | **FALSE** |
| **"DR Drill tested and verified in Release Center"** | เป็นฟังก์ชัน `setTimeout()` นับถอยหลังหลอกในหน้าจอ UI React | **MOCKUP** |
| **"Zero-downtime DB Migrations ready"** | ไม่มี Migration Directory ในโปรเจกต์ ใช้ `prisma db push` ดิบๆ | **MISSING** |

---

## 6. HW-Required Test Plan (แผนการทดสอบเมื่อได้รับอุปกรณ์ฮาร์ดแวร์จริง)

รายการที่ไม่สามารถยืนยันความถูกต้องได้ด้วย Software Simulation และต้องทำการทดสอบซ้ำเมื่อได้รับกล้อง IP Camera และ NVR จริง:

1. **ONVIF WS-Discovery (Multicast UDP 3702):**
   - ทดสอบส่ง Multicast Probe ในวง VLAN กล้องจริง ตรวจสอบการตอบสนอง XML SOAP ของกล้องยี่ห้อ Hikvision, Dahua, และ Uniview
2. **ONVIF Profile S / Profile T PTZ Command Dispatch:**
   - ทดสอบส่งคำสั่ง Continuous Pan/Tilt, Absolute Move, และ Preset Calling ไปยังกล้อง PTZ จริง วัด Latency และความแม่นยำ
3. **RTSP Digest Authentication Handshake:**
   - ทดสอบเชื่อมต่อ RTSP ผ่าน Digest Auth กับกล้องจริง เพื่อยืนยันว่าการถอดรหัส AES-256-GCM ของระบบส่ง Header ถูกต้อง
4. **Physical Network Flapping & Reconnection:**
   - ปลดสาย LAN กล้องจริงและเสียบกลับ ทดสอบดูว่า MediaMTX ทำการ Reconnect RTSP Session ภายในกี่วินาที และสถานะบน Dashboard กลับมาเป็น Online ถูกต้องหรือไม่

---

## 7. Pre-Pilot Checklist (Wave 1: กล้อง 10 ตัวแรก)

ก่อนที่จะนำระบบไปติดตั้งทดสอบใน Pilot Wave 1 จะต้องแก้ไขข้อบกพร่องตามลำดับความสำคัญ (Prioritized Checklist) ดังนี้:

- [ ] **[P0 - บล็อกการทำงาน]** แก้ไข `mediamtx.yml`: ปรับ `hlsSegmentCount: 7` และแก้ `authHTTPAddress` ให้ชี้ไปที่ `http://image-api:3001/api/v1/media/auth`
- [ ] **[P0 - บล็อกการทำงาน]** พัฒนาระบบ Clip Stitching จริงด้วย `ffmpeg` ใน Backend และเพิ่ม Route สำหรับดาวน์โหลดไฟล์หลักฐาน
- [ ] **[P0 - ความปลอดภัยข้อมูล]** ปิดการลบไฟล์อัตโนมัติใน MediaMTX และเขียน Background Worker ใน API มาจัดการ Retention ร่วมกับ Legal Hold
- [ ] **[P1 - เสถียรภาพระบบ]** แก้ไข Unit Test ใน `image-api` ให้ผ่าน 100% และเขียน Test ครอบคลุมฟังก์ชัน CCTV เพิ่มเติม
- [ ] **[P1 - เสถียรภาพระบบ]** แก้ไข Type Error ใน `web-app` (`tsc --noEmit`) ให้ผ่านสมบูรณ์
- [ ] **[P1 - ความถูกต้องข้อมูล]** แก้ไข Bug การบันทึก Audit Log ของ Release Center (`entityType` -> `entity`)
- [ ] **[P1 - โครงสร้างฐานข้อมูล]** สร้าง Initial Migration ด้วย `prisma migrate dev` แทนการใช้ `db push`
- [ ] **[P2 - การใช้งาน]** เพิ่ม Auto-reconnect ให้กับ `WhepPlayer.tsx` เมื่อเกิดข้อผิดพลาดในการเชื่อมต่อ WebRTC
- [ ] **[P2 - ความถูกต้อง]** แก้ไข Timezone Offset ในหน้า Incident Center ให้ตรงกับ CctvPlayback (Asia/Bangkok)

---

## 8. Commands Executed During Audit (ประวัติคำสั่งที่รันจริงและผลลัพธ์)

| คำสั่งที่รัน | ไดเรกทอรีการทำงาน | Exit Code | วัตถุประสงค์ / ผลลัพธ์ |
|---|---|---|---|
| `docker context ls` | Workspace Root | **0** | ตรวจสอบความปลอดภัย: บริบทที่ใช้งานคือ Local Docker (`desktop-linux *`) |
| `docker compose config` | Workspace Root | **0** | ตรวจสอบความถูกต้องของโครงสร้าง `docker-compose.yml` |
| `npm run lint` (`tsc --noEmit`) | `image-api` | **0** | ตรวจสอบ Linting และ Type ของ Backend API |
| `npx prisma validate` | `image-api` | **0** | ตรวจสอบความถูกต้องของไฟล์ Schema ฐานข้อมูล |
| `npm test` | `image-api` | **1** | รันชุดการทดสอบ Backend: ล้มเหลว 5 รายการจาก 21 รายการ |
| `npm run build` | `web-app` | **0** | ทดสอบการ Build Frontend (Vite Transpilation ผ่าน) |
| `npx tsc --noEmit` | `web-app` | **1** | ตรวจสอบ Type Frontend: พบข้อผิดพลาด `TS18046` ใน StorageProvidersPage |
| `npm audit --omit=dev` | `image-api` | **1** | สแกนหาช่องโหว่ความปลอดภัย: พบ 17 Vulnerabilities (2 Critical ใน fast-jwt) |
| `npm audit --omit=dev` | `web-app` | **1** | สแกนหาช่องโหว่ความปลอดภัย: พบ 7 Vulnerabilities (1 Critical ใน xlsx) |
| `docker run ... mediamtx` | Workspace Root | **1** | ตรวจสอบไฟล์ `mediamtx.yml`: ล้มเหลวเนื่องจาก `hlsSegmentCount: 3` |
| `docker run ... ffmpeg` (Encode) | `.audit-sim` | **0** | สร้างไฟล์ทดสอบวิดีโอ H.264, H.265, Sub-stream พร้อม Timestamp Overlay |
| `docker run ... cctv-audit-mediamtx` | `.audit-sim` | **0** | สตาร์ท Simulation MediaMTX ด้วยคอนฟิกที่แก้ไขแล้วสำหรับจำลองระบบ |
| `docker run ... ffprobe` | `.audit-sim` | **0** | ตรวจสอบความสมบูรณ์ของไฟล์ fMP4 ที่ MediaMTX บันทึกได้จริงบนดิสก์ |
| `docker stop/rm cctv-audit-mediamtx` | Workspace Root | **0** | ปิดและลบคอนเทนเนอร์ทดสอบ คืนสภาพความสะอาดของระบบ |

---

## 9. Simulation Artifacts & Cleanup (รายการไฟล์จำลองและการล้างระบบ)

ไฟล์ทั้งหมดที่สร้างขึ้นในการตรวจสอบนี้อยู่ภายใต้ไดเรกทอรี `./.audit-sim/` เท่านั้น ไม่มีการแก้ไขไฟล์หลักของโครงการ (Tracked Files):

### รายการไฟล์ที่สร้างขึ้น:
1. `./.audit-sim/mediamtx.sim.yml` (คอนฟิกูเรชัน MediaMTX ที่แก้ไขปัญหา `hlsSegmentCount` สำหรับรันเทสต์)
2. `./.audit-sim/test_h264_aac.mp4` (ไฟล์ทดสอบ H.264 + AAC พร้อม Drawtext Clock)
3. `./.audit-sim/test_h264_opus.mp4` (ไฟล์ทดสอบ H.264 + Opus Audio)
4. `./.audit-sim/test_h264_sub.mp4` (ไฟล์ทดสอบความละเอียดต่ำ Sub-stream 640x360)
5. `./.audit-sim/test_h265_aac.mp4` (ไฟล์ทดสอบ H.265 1080p)
6. `./.audit-sim/recordings/` (โฟลเดอร์ไฟล์บันทึก fMP4 ที่ได้จากการทดสอบสตรีมจริง)
7. `./.audit-sim/AUDIT_REPORT.md` (เอกสารรายงานฉบับนี้)

### คำสั่งสำหรับลบไฟล์จำลองทั้งหมดเมื่อเสร็จสิ้นการตรวจสอบ:
```powershell
# รันคำสั่งนี้บน PowerShell เพื่อลบโฟลเดอร์ .audit-sim ทั้งหมด
Remove-Item -Recurse -Force .\.audit-sim
```
*(หมายเหตุ: หากต้องการเก็บเอกสารรายงานไว้ ให้อ่านหรือสำรองไฟล์ `AUDIT_REPORT.md` ก่อนรันคำสั่งลบ)*
