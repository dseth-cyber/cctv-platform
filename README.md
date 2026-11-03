# iSmart CCTV

ระบบจัดการกล้องวงจรปิด: ดูสด (WebRTC), บันทึกต่อเนื่อง (fMP4), เล่นย้อนหลัง, ตัดคลิปหลักฐานพร้อม SHA-256 และ chain of custody, Legal Hold, incident และการแจ้งเตือน

> โปรเจกต์นี้คือเครื่อง **Dev เท่านั้น** อ่าน [AGENTS.md](AGENTS.md) ก่อนทุกครั้ง. ระบบภาพโรงงาน (Image Service เดิม) ถูกถอดออกแล้ว 2026-11-03 — โค้ดเดิมดูได้ที่ git tag `legacy-image-service-final`. สถานะงานอยู่ใน [Roadmap.md](Roadmap.md) และ [HANDOFF.md](HANDOFF.md)

## ส่วนประกอบ

| Service | หน้าที่ |
|---|---|
| `web-app` | React + Vite, เสิร์ฟผ่าน nginx (`/cctv/*` คือ UI, `/image-service/api/` คือ API, `/mediamtx/{webrtc,hls,playback}/` คือสื่อ) |
| `image-api` | Fastify + Prisma (PostgreSQL): กล้อง, อุปกรณ์ DVR/NVR, site/zone, media node, ดัชนีไฟล์บันทึก, playback, export, incident, alert, ผู้ใช้/สิทธิ์, audit, backup |
| `mediamtx` | ดึงสตรีม RTSP จากกล้อง, ส่ง WebRTC/HLS, บันทึก fMP4 ลง `./mediamtx/recordings`, playback server (`:9996`) |
| `postgres`, `redis`, `minio`, `seaweedfs-*` | ฐานข้อมูล, cache, storage สำหรับ backup |
| `prometheus`, `grafana`, `loki` | monitoring |

การบันทึก: `image-api` ลงทะเบียน path ของกล้องที่เปิดใช้กับ MediaMTX ทุก 60 วินาที; MediaMTX แจ้ง segment ที่บันทึกเสร็จผ่าน webhook → ดัชนี `camera_recordings` (มี reconcile ทุก 5 นาที). MediaMTX ไม่ลบไฟล์เอง (`recordDeleteAfter: 0s`) — การเก็บ/ลบทำโดย retention ของ `image-api` เท่านั้น (ย้ายไป quarantine, เคารพ Legal Hold)

## เริ่มใช้งานบนเครื่อง Dev

```bash
cp .env.example .env          # แล้วแก้ secret ทุกตัวที่เป็น changeme
docker compose -p cctv-platform up -d --build
docker compose -p cctv-platform run --rm image-api-migrate   # migration (prisma/sql/*.sql แล้ว db push)
```

เปิด `http://localhost:${WEB_HTTP_PORT}` (ค่า default 8080). ผู้ใช้เริ่มต้นจาก seed ใช้ได้เฉพาะ Dev และต้องเปลี่ยนรหัสผ่าน

ตัวแปรสำคัญ (ดู `.env.example` และ `docker-compose.yml`):

| ตัวแปร | ความหมาย |
|---|---|
| `WEB_HTTP_PORT` / `WEB_HTTPS_PORT` | พอร์ตเว็บ (ผูกกับ 127.0.0.1) |
| `WEB_LAN_ADDRESS` (+ `WEB_LAN_HTTP_PORT`, `WEB_LAN_HTTPS_PORT`, `MEDIA_UDP_BIND`, `MEDIA_WEBRTC_HOST`) | เปิดให้เข้าผ่าน IP วง LAN เพียงหนึ่ง address — ห้าม `0.0.0.0` และห้ามวงเดียวกับ Image Service production เดิม |
| `CORS_ALLOWED_ORIGINS` | origin ของเบราว์เซอร์ที่อนุญาต (ต้องรวมทุก URL ที่ใช้เปิดเว็บ) |
| `CCTV_ISOLATION_VERIFIED` | ตั้ง `true` หลังตรวจแล้วว่าเครื่องนี้แยกจาก production เดิม |
| `MEDIA_WEBHOOK_SECRET` | secret ร่วมระหว่าง MediaMTX กับ image-api (webhook และ control API) |
| `RECORDINGS_CLEANUP_ENABLED` | เปิด retention ของไฟล์บันทึก (default ปิด) |
| `MAX_EXPORT_HOURS` | ความยาวสูงสุดของคลิปหลักฐานหนึ่งไฟล์ (default 24) |

## พัฒนา

```bash
cd image-api && npm ci && npx tsc --noEmit -p . && npx vitest run
cd web-app && npm ci && npx tsc --noEmit -p . && npm run build
```

การแก้ schema: แก้ `image-api/prisma/schema.prisma`; ถ้าต้องย้ายหรือลบข้อมูล ให้เขียนไฟล์ SQL แบบ idempotent ใน `image-api/prisma/sql/` (รันก่อน `prisma db push` ตามลำดับชื่อไฟล์) และ `pg_dump` ก่อนรันกับฐานข้อมูลที่มีข้อมูลจริง. ห้ามตั้ง `ALLOW_DATA_LOSS=true`
