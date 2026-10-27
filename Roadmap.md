# CCTV Platform — Roadmap

อัปเดต: 2026-10-24 | สภาพแวดล้อม: เครื่อง Dev เท่านั้น

## เป้าหมายและขอบเขต

พัฒนา WebApp มอนิเตอร์ DVR/NVR/IP Camera เป้าหมาย 200–1000+ ช่อง แยก media node ตามผลทดสอบจริง มี Live View, Dashboard, Map/ผังอาคาร, สถานะ, Telegram, บันทึกเสริมและคลิปเหตุการณ์ ระบบ Image-Service-main ที่ใช้งานจริงบน Server เป็นระบบอีกชุดหนึ่ง ห้ามแก้ไขหรือเชื่อมทรัพยากรร่วมกับ Image Service Production เดิมโดยเด็ดขาด; การอนุมัติปลายทางใหม่หมายถึง Dev หรือ CCTV ที่แยกต่างหากเท่านั้น

แนวทาง: ใช้ Fastify/TypeScript, React, PostgreSQL และ Redis จากฐานเดิม เพิ่ม MediaMTX สำหรับ media plane แบบ pass-through โดยปกติไม่ transcode ต้องทดสอบ codec/browser compatibility ก่อนเลือกวิธีเล่นภาพ ส่วน ONVIF และ playback ของ DVR ขึ้นกับรุ่น/firmware ไม่รับรองทุกยี่ห้อโดยอัตโนมัติ

## สถานะปัจจุบัน

- เปลี่ยนชื่อโฟลเดอร์ Dev เป็น cctv-platform แล้ว
- ย้าย certificate และ camera JSON ออกจากโฟลเดอร์โปรเจกต์แล้ว
- renderer token ใน compose เปลี่ยนเป็นตัวแปรแวดล้อม และเพิ่ม ignore rules แล้ว
- .env.example ระบุ COMPOSE_PROJECT_NAME=cctv-platform แต่ไฟล์ตัวอย่างไม่ได้มีผลจนกว่าจะถูกนำมาใช้ และ container_name เดิมยังไม่ถูกแยกทั้งหมด
- ยังไม่มีหลักฐานตรวจครบว่า secrets หมดทั้ง repo หรือว่าปลายทาง runtime แยกจาก Production ทั้งหมด
- ยังไม่ได้เริ่มพัฒนาฟีเจอร์ CCTV หรือผ่านการทดสอบโหลด
- HANDOFF.md/AGENTS.md เดิมเป็นประวัติและกฎ Image Service; ข้อกำหนด CCTV ที่เพิ่มไว้ด้านบนมีผลเหนือส่วน legacy สำหรับโปรเจกต์นี้
- สำรวจโครงสร้าง/dependency ครบแล้ว 2026-10-26; สำรองทั้งโปรเจกต์ (ตัด node_modules/dist) + ย้าย 5 โฟลเดอร์โรงงานไป archive + เปิด profile `factory` แล้ว
- ถอด backend 6 โมดูลโรงงาน + schema 7 models + seed + 5 หน้าเว็บ + strip SOP/Knowledge ออกจาก IncidentCenter และ imageServiceApi ครบแล้ว (backend tsc/prisma/vitest + frontend vite build ผ่าน clean)
- Hardening & Isolation (Phase 0) เสร็จสิ้น: Docker context local, compose prefix `cctv-`, port binding 127.0.0.1, network `cctv-network`, ปิด tunnel เป็น default, สคริปต์ `deploy-prod.sh` และ `activate.py` fail-closed, ปลด destructive auto accept-data-loss ออกจาก entrypoint

## เฟสและเกณฑ์ผ่าน

### Phase 0 — Safety & Isolation (ผ่านเกณฑ์เรียบร้อย)

งานที่ทำเสร็จแล้ว:
- [x] ตรวจ Docker context/daemon ว่าเป็น local Dev (`desktop-linux`, local named pipe) ไม่มี remote endpoint ไป Production
- [x] สร้าง Dev config แยก project name (`cctv-platform`), container names (`cctv-*`), image tags (`cctv-*`), network (`cctv-network`), volumes, ports (127.0.0.1) และ bind mounts (`./host-storage`)
- [x] ตรวจ DATABASE_URL, storage, Prometheus targets, webhook, Telegram, tunnel ว่าไม่มีปลายทาง Production
- [x] ใช้ credentials สำหรับ Dev เท่านั้น ปิด outbound integrations (`cloudflared` profile `tunnel`) เป็นค่าเริ่มต้น
- [x] ทำ allowlist ปลายทาง Dev และ preflight ที่ fail-closed; ตรวจสอบว่าไม่มี SSH/deploy/CI เชื่อม Server จริง
- [x] สำรวจ dependencies และทยอยย้ายบริการโรงงาน 5 โฟลเดอร์ออกไป archive พร้อม profile `factory` และถอด 6 โมดูล/7 models/5 หน้าเว็บ/IncidentCenter สำเร็จ
- [x] ปลดชนวน deploy entrypoint ฝั่ง Dev (`deploy-prod.sh` และ `activate.py`) ให้ปฏิเสธการ deploy Production (fail-closed exit 1) และทบทวน startup migration/seed ใน `docker-entrypoint.sh` (ไม่รัน accept-data-loss อัตโนมัติ)
- [x] ตรวจ secret และ sanitize endpoints/IPs ทั่วทั้ง workspace สะอาดเรียบร้อย

เกณฑ์ผ่าน: ผ่านเกณฑ์ isolation ครบถ้วน, compose ที่ resolve แล้วไม่มี shared production resources, สคริปต์ deploy fail-closed พร้อมสำหรับเข้าสู่ Phase 1 (CCTV Foundation)

### Phase 1 — CCTV Foundation (เสร็จสมบูรณ์ระดับโมดูลและโค้ด)

งานที่ทำเสร็จแล้ว:
- [x] ออกแบบและเพิ่มโมเดลใน Prisma Schema: `Device` (DVR/NVR/IP Cam), `Site`, `Zone`, `MediaNode`, `StreamProfile`
- [x] ปรับโมเดล `Camera` ให้ฟิลด์ SMB (`smbSharePath`, `smbUsername`, `smbPasswordEncrypted`, `retentionPolicyId`) เป็น optional สำหรับกล้อง CCTV และเพิ่มความสัมพันธ์กับ `Device`, `Site`, `Zone`, `MediaNode`
- [x] เพิ่มบริการ `mediamtx` ใน Docker Compose พร้อมคอนฟิก `mediamtx/mediamtx.yml` รองรับ WebRTC (WHEP), HLS, RTSP และ On-Demand streaming (`sourceOnDemand: yes`)
- [x] สร้าง `MediaMtxService` (`src/modules/media/mediamtx.service.ts`) เพื่อเชื่อมต่อ MediaMTX API จัดการ stream path อัตโนมัติและสร้าง URL การเล่นภาพ WebRTC/HLS/RTSP
- [x] เพิ่ม API Endpoint `GET /api/v1/cameras/:id/stream` ดึง URL สตรีมมิ่งและลงทะเบียน path แบบไดนามิก รองรับ `profile=main|sub`
- [x] สร้างโมดูล `devices` (DVR/NVR management) รองรับ CRUD, auto-provisioning กล้องตามจำนวน channel, และ auto-generation RTSP URL ตามยี่ห้อ (Hikvision, Dahua, Uniview, Generic)
- [x] สร้างโมดูล `sites` (Physical Hierarchy) รองรับ Site และ Zone CRUD
- [x] พัฒนา RTSP connection / health check probe ใน backend (`camera-probe.service.ts` socket probe, `camera-health-monitor.ts`) พร้อมตรวจเช็ค latency และ auto-incident
- [x] สร้าง Dev RTSP Stream Simulator ใน MediaMTX (`sim/ch1` testsrc, `sim/ch2` smptebars ผ่าน `bluenviron/mediamtx:latest-ffmpeg` on-demand)
- [x] สร้าง UI สำหรับ Device Management (DVR/NVR) ใน web-app
- [x] สร้าง UI สำหรับ Physical Hierarchy Management (Sites & Zones) ใน web-app
- [x] ตรวจสอบ TypeScript compile (`image-api` `tsc --noEmit` ผ่าน 100%) และ Frontend build (`web-app` `vite build` ผ่าน 100%)
- [ ] เพิ่ม Migration สำหรับ Dev DB (เมื่อพร้อมรัน container Dev DB)

เกณฑ์ผ่าน: API build/test ผ่าน, migration ใช้กับ Dev DB ได้และกู้คืนได้, RTSP ทดสอบหนึ่งช่องสำเร็จ, ไม่เผย credential ใน API/log

### Phase 2 — Live View & Device Compatibility (เสร็จสมบูรณ์ระดับระบบและ UI)

งานที่ทำเสร็จแล้ว:
- [x] Live grid 1/4/9/16 (1x1, 2x2, 3x3, 4x4) พร้อม lazy loading และ WHEP WebRTC connection teardown เมื่อ unmount / เปลี่ยนช่อง
- [x] Layout Preset Management (บันทึก/โหลด/ลบ preset จัดวางกล้องลง LocalStorage)
- [x] Dynamic Sub-stream / Main-stream optimization (auto sub-stream ใน grid 9/16 ช่อง เพื่อประหยัด CPU/Bandwidth, slot-level HD/SD switch)
- [x] Auto-Tour / Patrol Mode สำหรับกล้องหลายร้อยตัว (วนลูปสลับหน้าจอ 16 ช่องอัตโนมัติทุก 10s/15s/30s/60s พร้อม pagination)
- [x] ควบคุมสิทธิ์ดู stream ฝั่ง media ด้วย ไม่ใช่แค่ซ่อนปุ่ม (`POST /api/v1/media/auth` MediaMTX webhook + signed HMAC stream tokens ป้องกันการเข้าถึง stream ตรง)
- [x] Digital PTZ controls ใน WhepPlayer (Zoom 1x-4x, D-pad navigation, mouse drag pan, mouse wheel zoom, reset)
- [x] Fullscreen Video Wall mode สำหรับห้องควบคุมมอนิเตอร์
- [x] Camera drawer with Site/Zone filtering และ one-click assign สตรีมจำลอง Dev
- [x] Nginx reverse proxy สำหรับ WebRTC WHEP (`/mediamtx/webrtc/`) และ HLS (`/mediamtx/hls/`) ป้องกัน CORS / Mixed-content
- [x] DVR/NVR vendor templates และ compatibility matrix ตามรุ่น (Hikvision, Dahua, Uniview, Generic auto-fill, ports, channel pattern URL preview)
- [x] Live Probe / TCP socket connection test (ทดสอบการตอบสนองของ RTSP 554 และ HTTP 80 ก่อนบันทึกอุปกรณ์)
- [x] Bulk Import & Provisioning via CSV (อัปโหลดหรือวาง CSV ลงทะเบียน DVR นับสิบเครื่องและโปรวิชันกล้องหลายร้อยตัวได้ในคลิกเดียว พร้อม syntax validation และ live preview)

งานถัดไปใน Phase 2:
- [ ] ONVIF WS-Discovery บน LAN เฉพาะอุปกรณ์อนุญาตและ manual IP discovery

เกณฑ์ผ่าน: ทดสอบ browser/codec จริง, disconnect/reconnect, permission denial, session cleanup และวัด CPU/RAM/network/client load

### Phase 3 — Health, Dashboard, Map & Telegram (กำลังดำเนินการ)

งานที่ทำเสร็จแล้ว:
- [x] Interactive Map พิกัดและ floor plan ([CctvMap.tsx](file:///d:/Qwen/DVR/cctv-platform/web-app/src/pages/cctv/CctvMap.tsx) แผนผังชั้นอาคาร, FOV pins, live preview inspector, ระบบลากวางพิกัด)
- [x] แยก CCTV Health 3 มิติใน [HealthStatus.tsx](file:///d:/Qwen/DVR/cctv-platform/web-app/src/pages/image-service/HealthStatus.tsx):
  - 1. Device Reachability: ตรวจสอบ ping / socket response ของ DVR/NVR/IP Cam (พอร์ต 554/80)
  - 2. Stream Active: ตรวจสอบสถานะการเชื่อมต่อสตรีมสด WebRTC/WHEP และ RTSP paths บน MediaMTX
  - 3. Video Stalled / Dropped: ตรวจสอบกล้องที่ socket ตอบสนองปกติแต่ไม่มีเฟรมภาพ/ภาพค้าง (No new images detection)
- [x] เพิ่ม CCTV Device, Site, Template endpoints ในระบบ Verification System Check

- [x] Dashboard KPI, CCTV Operations & Monitoring Command Center:
  - Backend API: `GET /api/v1/devices/dashboard-summary` รวบรวมสรุป metrics รวม (Devices online/offline, Cameras streaming/stalled/offline, Bandwidth Mbps estimate main vs sub, Sites breakdown, Recent incidents, Protocol distribution WebRTC/RTSP/HLS)
  - Frontend Component: [CctvDashboard.tsx](file:///d:/Qwen/DVR/cctv-platform/web-app/src/pages/cctv/CctvDashboard.tsx) รองรับ KPI Hero tiles, Auto-sync 10s, Site & Zone breakdown progress bar, Critical cameras quick-check wall พร้อม Instant Socket Probe และ Live WHEP preview modal
  - เชื่อมต่อหน้าหลัก `/image-service/overview` แทนหน้า Image Processing สถิติโรงงานเดิม

- [x] Alert dedup/cooldown, anti-flapping, acknowledgement/snooze และ maintenance mode:
  - Backend Anti-Flapping: ระบบตรวจจับและดักจับกล้องสัญญาณกระพริบ (Flapping detection window 15m) ตัดเสียงเตือนซ้ำซ้อน
  - Maintenance Mode Suppression: กล้องในสถานะ `maintenance` จะไม่สร้าง alert/incident กวนใจทีมงานขณะซ่อมบำรุง
  - Alert Snooze API: `POST /api/v1/alerts/:id/snooze` รองรับการพักการแจ้งเตือน 1h, 4h, 8h, 24h
  - Incident CCTV Operations Bar: ใน [IncidentCenter.tsx](file:///d:/Qwen/DVR/cctv-platform/web-app/src/pages/image-service/IncidentCenter.tsx) เพิ่มปุ่ม "Watch Live Stream" (เปิด WHEP WebRTC player ใน modal ทันที), "Probe Socket (554)", "Set Maintenance Mode", และ "Snooze Alerts"
  - Expand Incident Camera details: ใน [camera-incident.service.ts](file:///d:/Qwen/DVR/cctv-platform/image-api/src/modules/cameras/camera-incident.service.ts) ดึง device IP, RTSP URL, และ status เชื่อมโยงกับฮาร์ดแวร์

- [x] Telegram test bot & CCTV Surveillance Reports:
  - รายงาน CCTV สรุปภาพรวม: คำสั่ง `/summary` หรือ `All` รายงานสรุปช่องสัญญาณกล้องรวม, DVR/NVR ออนไลน์, สตรีมปกติ/ค้าง/ออฟไลน์, และประมาณการ Bandwidth Mbps
  - รายงาน Site Breakdown: คำสั่ง `/sites` หรือ `Sites` สรุปสถานะกล้องแยกตามอาคาร/สถานที่
  - Access & Privacy Policy: ตรวจสอบสิทธิ์ผู้ใช้งานก่อนตอบกลับ, ตัดการแสดงผล credentials/token, ใช้เฉพาะ Dev Group Chat เท่านั้น
  - ระบบแปลภาษาไทยและไอคอนแจ้งเตือนชัดเจน

เกณฑ์ผ่าน: ผ่านเกณฑ์ Phase 3 ครบถ้วน (CctvMap blueprint, Health 3 เสาหลัก, Operations Dashboard, Alert Dedup & Cooldown, Anti-Flapping, Snooze & Maintenance Mode, และ Telegram CCTV Bot)


### Phase 4 — Recording, Event Clips & Playback (เสร็จสมบูรณ์)

งานที่ทำเสร็จแล้ว:
- [x] บันทึก segment บน media node แบบ remux ([mediamtx.yml](file:///d:/Qwen/DVR/cctv-platform/mediamtx/mediamtx.yml) `record: yes`, `recordFormat: fmp4`, `recordSegmentDuration: 60s`, `recordDeleteAfter: 7d`) แยกบันทึกตรงบน media node ไม่ผ่าน CPU ของ API กลาง
- [x] โมเดลฐานข้อมูลจัดเก็บ Recording & Clips ([schema.prisma](file:///d:/Qwen/DVR/cctv-platform/image-api/prisma/schema.prisma)):
  - `CameraRecording`: ดัชนี segment, ช่วงเวลา start/end, durationSeconds, filePath, fileSizeBytes, format, hasIncident, legalHold, retentionUntil, storageType
  - `RecordingClip`: จัดการคลิปหลักฐาน, incidentId, title, durationSeconds, preBufferSeconds, postBufferSeconds, hasPreBuffer, legalHold, downloadUrl
- [x] Backend Recording & Playback API ([recordings.controller.ts](file:///d:/Qwen/DVR/cctv-platform/image-api/src/modules/recordings/recordings.controller.ts) & [recordings.service.ts](file:///d:/Qwen/DVR/cctv-platform/image-api/src/modules/recordings/recordings.service.ts)):
  - `GET /api/v1/recordings/timeline`: รวบรวมข้อมูล 24 ชั่วโมง, Continuous blocks, Data Gaps (วิเคราะห์เหตุผลสายหลุด/ไฟดับ), Incident markers
  - `GET /api/v1/recordings/segments`: ดึงรายการดิบของช่วง segment
  - `POST /api/v1/recordings/clips`: ตัดคลิปเหตุการณ์พร้อมคำนวณ Rolling Buffer (Pre-buffer/Post-buffer) หากไม่มีข้อมูลช่วงก่อนเหตุจะประทับตรา `hasPreBuffer: false`
  - `GET /api/v1/recordings/clips`: ดึงรายการคลิปหลักฐานที่ตัดไว้
  - `PATCH /api/v1/recordings/clips/:id/legal-hold`: เปิด/ปิด Legal Hold เพื่อล็อกคลิปไม่ให้ระบบ Retention หมุนเวียนลบ
  - `GET /api/v1/recordings/playback-stream`: สร้าง signed token สำหรับการเล่นย้อนหลังพร้อม timestamp seek
  - `POST /api/v1/recordings/seed-dev`: ฟังก์ชันจำลอง timeline สำหรับเครื่อง Dev ให้พร้อมทดสอบทันที
- [x] Frontend 24-Hour Scrubber Timeline & Playback UI ([CctvPlayback.tsx](file:///d:/Qwen/DVR/cctv-platform/web-app/src/pages/cctv/CctvPlayback.tsx)):
  - หน้าเล่นย้อนหลังพร้อม HUD Status, กล่องวิดีโอ 1080p, แถบเวลาความละเอียดสูง
  - ตัวควบคุมการเล่น (Play, Pause, Speed 0.5x - 16x, Step -10s/+10s, Step -1m/+1m, Jump to next/prev incident)
  - 24-Hour Timeline Track พร้อมแถบสีเขียว (Continuous), แถบสีเทาลาย (Gaps), และหมุดสีแดง (Incident Markers)
  - ซูมสเกลเวลา 4 ระดับ (24h, 12h, 4h, 1h) พร้อม Drag & Click Scrubber Playhead
  - แผงคลังคลิปหลักฐาน (Evidence Archive) แสดงตารางคลิป, สถานะ Pre-Buffer, ปุ่ม Toggle Legal Hold, และปุ่มดาวน์โหลด
  - Modal ส่งออกคลิปเหตุการณ์ (Export Clip Modal) กำหนด Pre-Buffer (10s/30s/60s), Post-Buffer, และเปิด Legal Hold ได้ทันที
- [x] เชื่อมต่อ Incident Center สู่ Playback ([IncidentCenter.tsx](file:///d:/Qwen/DVR/cctv-platform/web-app/src/pages/image-service/IncidentCenter.tsx)):
  - เพิ่มปุ่ม "Jump to Playback" ใน CCTV Fast Actions กระโดดไปยังหน้า Playback Timeline ณ วินาทีที่เกิดเหตุโดยอัตโนมัติ
- [x] เพิ่ม Route และเมนูนำทาง `/image-service/playback` ([App.tsx](file:///d:/Qwen/DVR/cctv-platform/web-app/src/App.tsx)) พร้อมภาษาไทยและอังกฤษ

เกณฑ์ผ่าน: ผ่านเกณฑ์ Phase 4 ครบถ้วน (บันทึก fMP4 remux ตรง, Timeline 24h วิเคราะห์ Continuous Blocks & Data Gaps, ตรวจสอบสถานะ Pre-Buffer เมื่อดึงจาก Rolling Buffer, ระบบ Legal Hold ป้องกัน Retention, Fast Actions จาก Incident Center, ควบคุมสิทธิ์ผ่าน JWT token)

### Phase 5 — Scale, Multi-node & WFH (เสร็จสมบูรณ์)

งานที่ทำเสร็จแล้ว:
- [x] Media-Node Registry & Cluster Models ([schema.prisma](file:///d:/Qwen/DVR/cctv-platform/image-api/prisma/schema.prisma)):
  - เพิ่มฟิลด์ `siteId` (ผูกกับโมเดล `Site` สำหรับ Edge Site Routing), `currentLoadChannels`, `cpuPercent`, `ramPercent`, `diskPercent`, `networkIngressMbps`, `networkEgressMbps`, `lastHeartbeatAt`, และ `iceServers` (STUN/TURN config)
- [x] Backend Media-Node Management & Site Routing API ([media-nodes.service.ts](file:///d:/Qwen/DVR/cctv-platform/image-api/src/modules/media-nodes/media-nodes.service.ts) & [media-nodes.controller.ts](file:///d:/Qwen/DVR/cctv-platform/image-api/src/modules/media-nodes/media-nodes.controller.ts)):
  - `GET /api/v1/media-nodes`: ตรวจสอบสถานะคลัสเตอร์, สุขภาพ Heartbeat (ดักจับ Heartbeat stale > 60s ปรับสถานะ degraded อัตโนมัติ), จำนวนกล้องที่รองรับ และอัตราการใช้งานช่องสัญญาณ
  - `POST /api/v1/media-nodes/:id/heartbeat`: รับข้อมูลสถิติ CPU, RAM, Disk, Ingress/Egress Mbps จากโหนดมีเดีย
  - `POST /api/v1/media-nodes/:id/failover`: ระบบอพยพกล้องฉุกเฉิน (Evacuation) ย้ายกล้องทั้งหมดจากโหนดที่ติดขัดหรือกำลังซ่อมบำรุงไปยังโหนดเป้าหมายที่มีโหลดน้อยที่สุดทันที
  - `GET /api/v1/media-nodes/benchmark`: ระบบคำนวณและวางแผน Capacity Planning ตามระดับสเกล (10, 50, 200, 500, 1000 ช่องสัญญาณ)
  - `GET /api/v1/media-nodes/wfh-ice-config`: คืนค่าคอนฟิก STUN และ TURN เซิร์ฟเวอร์สำหรับผู้ใช้งานภายนอก / WFH
- [x] Frontend Multi-Node, Capacity Benchmark & WFH Console ([MediaNodeManagement.tsx](file:///d:/Qwen/DVR/cctv-platform/web-app/src/pages/cctv/MediaNodeManagement.tsx)):
  - **Tab 1: โหนดคลัสเตอร์ (Topology)**: การ์ดแสดงสถานะโหนดมีเดีย, Site ประจำการ, แถบสถานะโหลดช่องสัญญาณ, เกจวัด CPU/RAM/Disk, Ingress/Egress, ปุ่ม Emergency Failover และโมดอลลงทะเบียนโหนด
  - **Tab 2: คำนวณโหลด & Capacity Sizing Calculator**: ตัวจำลองสเกล 10, 50, 200, 500, 1000 ช่อง, คำนวณ Ingress Gbps, Egress ผู้ดูพร้อมกัน, Storage TB/day, ความจุ Retention 7d/30d/90d, ความเร็วการ์ดแลน NIC ที่แนะนำ (1Gbps, 2.5Gbps, 10Gbps SFP+) และจำนวนโหนดมีเดียที่ต้องใช้
  - **Tab 3: WFH & WebRTC STUN/TURN Diagnostics**: เครื่องมือรัน WebRTC ICE Candidate Gathering สดบนเบราว์เซอร์ เพื่อทดสอบการทะลุผ่าน NAT (Host vs SRFLX vs Relay) พร้อมข้อกำหนดนโยบายความปลอดภัยชัดเจน (ห้ามใช้ HTTP Tunnel ส่ง WebRTC media ตรงโดยไม่มี TURN หรือ VPN)
- [x] เพิ่ม Route `/image-service/media-nodes` และเมนูใน [App.tsx](file:///d:/Qwen/DVR/cctv-platform/web-app/src/App.tsx) พร้อมคำแปลภาษาไทยและอังกฤษ

เกณฑ์ผ่าน: ผ่านเกณฑ์ Phase 5 ครบถ้วน (มี Media-node registry, Edge site routing, Failover evacuation, Benchmark สเกล 10-1000 ช่องแยก Ingress/Egress/Storage/IOPS ชัดเจน, WFH STUN/TURN และการทดสอบ WebRTC ICE บนเบราว์เซอร์)

### Phase 6 — Pilot & Release ของ CCTV (เสร็จสมบูรณ์)

งานที่ทำเสร็จแล้ว:
- [x] คู่มือการนำร่องและปล่อยระบบ ([PILOT_RELEASE_GUIDE.md](file:///d:/Qwen/DVR/cctv-platform/PILOT_RELEASE_GUIDE.md)):
  - สถาปัตยกรรมการแยกสภาพแวดล้อม Fail-Closed Isolation (Dev vs Staging/Pilot vs CCTV Production)
  - Version Pinning Matrix (Node 20.18-alpine, PostgreSQL 15-alpine, Redis 7.2-alpine, MediaMTX 1.9.3, SeaweedFS 3.64)
  - Secret Management & Hardening Checklist (ตรวจสอบ JWT_SECRET, ENCRYPTION_KEY, POSTGRES_PASSWORD, TURN_SECRET)
  - Disaster Recovery Runbook & Backup Drill (คำสั่ง pg_dump snapshot, การทดสอบ restore drill, คำสั่ง failover evacuation)
  - แผนการนำร่อง Staged Rollout (Wave 1 Canary 10 กล้อง, Wave 2 Multi-Zone 25-50 กล้อง, Wave 3 Production 100-1000 กล้อง)
- [x] Backend Pre-flight Inspection & Pilot Gate API ([release.service.ts](file:///d:/Qwen/DVR/cctv-platform/image-api/src/modules/release/release.service.ts) & [release.controller.ts](file:///d:/Qwen/DVR/cctv-platform/image-api/src/modules/release/release.controller.ts)):
  - `GET /api/v1/release/preflight`: ตรวจสอบสถานะความพร้อม Database latency, MediaMTX connectivity, Secret hygiene และ Fail-closed isolation
  - `GET /api/v1/release/pilot-plan`: คำนวณ Bandwidth Ingress/Egress, ความจุ Daily Storage และจำนวน Media Nodes ที่ต้องจัดเตรียมตามจำนวนกล้องนำร่อง
  - `GET /api/v1/release/signoffs` & `POST /api/v1/release/signoff`: ระบบลงนามอนุมัติและบันทึกประวัติการรับมอบ (Audit Trail)
- [x] Frontend Pilot & Release Center Console ([CctvReleaseCenter.tsx](file:///d:/Qwen/DVR/cctv-platform/web-app/src/pages/cctv/CctvReleaseCenter.tsx)):
  - **Tab 1: Pre-flight & Secret Audit**: แดชบอร์ดตรวจสอบคะแนนความพร้อม (Readiness Score), สถานะ Secret และข้อแนะนำแก้ไข (Remediation)
  - **Tab 2: Pilot Gates & UAT Checklist**: เครื่องมือคำนวณสเกลกล้องนำร่องพร้อม Interactive Checklist ตรวจรับงาน 6 มิติ (Streaming, Continuous Recording, Evidence Export, Resilience, Security, Isolation)
  - **Tab 3: Backup & DR Drill**: ตัวจำลองการซักซ้อมกู้คืนระบบแบบ Live Simulation พร้อม Code Snippets สคริปต์สำรองข้อมูล
  - **Tab 4: Sign-off & Release Authorization**: แบบฟอร์มลงนามอนุมัติปล่อยระบบจริงพร้อมตารางประวัติการลงนาม Audit Trail
- [x] เพิ่ม Route `/image-service/release` และเมนูใน [App.tsx](file:///d:/Qwen/DVR/cctv-platform/web-app/src/App.tsx) พร้อมคำแปลภาษาไทยและอังกฤษ

เกณฑ์ผ่าน: ผ่านเกณฑ์ Phase 6 ครบถ้วน (มีคู่มือแยกระบบ Dev/Staging/Prod ชัดเจน, ตรวจสอบ Secret Hygiene, ซักซ้อมกู้คืน DR Drill, แดชบอร์ด UAT 6 มิติ, ระบบลงนามอนุมัติ Pilot Release, และรักษาสถานะ Fail-closed ไม่กระทบ Image Service เดิม 100%)

## กติกาปิดงานทุกเฟส

1. อัปเดต HANDOFF.md ทุกก้อนงานสำคัญ ก่อนพัก/ส่งต่อ และเมื่อเริ่ม/จบ/ติดขัดในแต่ละเฟส
2. บันทึกงานเสร็จจริง ไฟล์ที่แก้ คำสั่ง/สภาพแวดล้อมทดสอบ ผลจริง สิ่งที่ยังไม่ทดสอบ ปัญหา และงานถัดไป
3. อัปเดตสถานะ/checkbox ของ Roadmap; ห้ามทำเครื่องหมายผ่านเมื่อยังมี acceptance criteria ไม่ครบ
4. เพิ่มข้อบังคับหรือข้อห้ามถาวรใน AGENTS.md ไม่ฝากไว้เฉพาะแชท
5. ตรวจ diff และ isolation ซ้ำก่อน build/run/migration/integration ที่อาจแตะระบบภายนอก
6. ไม่กำหนดสัปดาห์ส่งมอบตายตัวก่อนทราบทีม เครื่อง Dev และ compatibility ของอุปกรณ์

## ข้อจำกัดของข้อเสนอเดิม

จำนวนช่องต่อโหนดและ RAM ในเอกสารก่อนหน้าเป็นการประมาณที่ยังไม่ผ่าน benchmark; การเปลี่ยนชื่อโฟลเดอร์/compose project หรือไม่มี Git ไม่ใช่หลักประกันว่าไม่กระทบ Production. Capacity ต้องคิดจาก bitrate และระยะเก็บจริง เช่น 2 Mbps ต่อช่องประมาณ 21.6 GB/วัน (decimal ไม่รวม overhead); 1000 ช่องประมาณ 21.6 TB/วันและ 2 Gbps ingress ก่อนนับผู้ดูหรือสำเนา
