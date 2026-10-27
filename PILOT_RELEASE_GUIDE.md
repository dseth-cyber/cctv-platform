# CCTV Platform — Pilot & Release Guide (Phase 6)

คู่มือการติดตั้ง แยกสภาพแวดล้อม (Environment Isolation), การบริหารความลับ (Secret Management), ซักซ้อมกู้คืนระบบ (Disaster Recovery Drill), การนำร่อง (Pilot Rollout) และการปล่อยระบบ (Release) อย่างปลอดภัย

---

## 1. นโยบายการแยกสภาพแวดล้อม (Environment Isolation Architecture)

เพื่อรักษาเสถียรภาพสูงสุดและป้องกันผลกระทบต่อระบบโรงงานเดิม ระบบ CCTV Platform ใช้หลักการ **Fail-Closed Isolation** อย่างเคร่งครัด:

```mermaid
graph TD
    subgraph Legacy [ระบบเดิม (ห้ามแตะต้องเด็ดขาด)]
        ProdImageService["Image Service Production (Legacy Host)"]
    end

    subgraph CCTV_Dev [1. สภาพแวดล้อม Dev (Local)]
        DevCompose["Docker Compose (127.0.0.1)"]
        DevMediaMTX["MediaMTX Remux Core"]
        DevPostgres["Postgres 15 (Dev DB)"]
    end

    subgraph CCTV_Pilot [2. สภาพแวดล้อม Staging / Pilot (10-50 กล้อง)]
        PilotHost["Dedicated Edge Server (Isolated VLAN)"]
        PilotMediaMTX["MediaMTX Cluster (Node 1 / Node 2)"]
        PilotPostgres["PostgreSQL DB + Daily Backup Volume"]
        PilotCameras["IP Cameras (H.264/H.265 RTSP)"]
        PilotCameras --> PilotMediaMTX
    end

    subgraph CCTV_Prod [3. สภาพแวดล้อม CCTV Production (อนาคต)]
        ProdCCTVServer["New Dedicated CCTV Server Cluster"]
        ApprovedSignoff["Authorized Release Sign-off"]
    end

    DevCompose -. "ห้ามเชื่อมต่อ" .-x ProdImageService
    PilotHost -. "ห้ามเชื่อมต่อ" .-x ProdImageService
    ApprovedSignoff --> ProdCCTVServer
```

### สภาพแวดล้อมทั้ง 3 ระดับ:

| สภาพแวดล้อม | ขอบเขต & ทรัพยากร | การเชื่อมต่อเครือข่าย | แหล่งสัญญาณกล้อง |
| :--- | :--- | :--- | :--- |
| **Dev (Local)** | เครื่องพัฒนาเดี่ยว, `docker-compose.yml` ผูกพอร์ตเฉพาะ `127.0.0.1` | `cctv-network` (bridge ภายใน) | Simulated RTSP / Video Loopback |
| **Staging / Pilot** | เครื่อง Edge Server หรือ VM เฉพาะใน Internal LAN | Isolated VLAN (ห้ามเปิด Public IP ตรง) | กล้อง IP Camera จริง 10 – 50 ตัว |
| **CCTV Production** | คลัสเตอร์เฉพาะทาง (10Gbps SFP+ Ingress, Dedicated Storage NAS/SAN) | VLAN ความปลอดภัยสูง + Firewall Whitelist | กล้องทั้งโรงงาน 100 – 1000 ตัว |

> [!CAUTION]
> **ข้อห้ามถาวร (Strict Prohibition)**:
> สคริปต์ `deploy-prod.sh` ถูกล็อก (blocked) ไม่ให้นำไป deploy ทับหรือเชื่อมต่อไปยังโฮสต์ Image Service Production เดิมเด็ดขาด หากต้องการติดตั้ง Production ของ CCTV จะต้องกำหนดเซิร์ฟเวอร์ปลายทางใหม่และผ่านการ Sign-off ก่อนเท่านั้น

---

## 2. Version Pinning Matrix (การล็อกเวอร์ชันซอฟต์แวร์)

ห้ามใช้แท็ก `:latest` ในสภาพแวดล้อม Staging / Pilot หรือ Production เพื่อป้องกัน Breaking Changes:

| บริการ / องค์ประกอบ | เวอร์ชันที่ระบุ (Pinned Version) | วัตถุประสงค์ |
| :--- | :--- | :--- |
| **Node.js Runtime** | `node:20.18-alpine` | API Server (`image-api`) และ Frontend Build Engine |
| **PostgreSQL** | `postgres:15-alpine` | ฐานข้อมูลดัชนีภาพ, บันทึกการตรวจจับ และ Metadata การบันทึกวิดีโอ |
| **MediaMTX** | `bluenviron/mediamtx:1.9.3` | สตรีมมิ่งเอนจิน (WHEP, RTSP, HLS, fMP4 direct remux) |
| **Redis** | `redis:7.2-alpine` | คิวงาน BullMQ, กลไก Distributed Lock และชั่วคราว Cache |
| **SeaweedFS** | `chrislusf/seaweedfs:3.64` | Object Storage สำหรับจัดเก็บภาพและคลิปหลักฐานถาวร |
| **Nginx (Web Gateway)** | `nginx:1.27-alpine` | Reverse proxy สำหรับ Frontend และการส่งต่อ API |

---

## 3. Secret Management & Hardening Checklist

ก่อนนำขึ้นทดสอบ Pilot หรือ Release ต้องตรวจสอบไฟล์ `.env` ไม่ให้มีค่าเริ่มต้นที่เป็นช่องโหว่:

```bash
# ตรวจสอบความปลอดภัยของ Secret เบื้องต้น
node -e "
const keys = ['JWT_SECRET', 'ENCRYPTION_KEY', 'POSTGRES_PASSWORD', 'TURN_SECRET'];
keys.forEach(k => {
  const val = process.env[k];
  if (!val || val === 'change-me' || val.length < 16) {
    console.error('INSECURE SECRET:', k);
  } else {
    console.log('PASSED:', k);
  }
});
"
```

### เกณฑ์ความปลอดภัย:
1. **JWT_SECRET**: ต้องมีความยาวอย่างน้อย 32 ตัวอักษร (สุ่มด้วย `openssl rand -base64 32`)
2. **ENCRYPTION_KEY**: ต้องเป็นคีย์ 32-byte สำหรับเข้ารหัสรหัสผ่าน RTSP ของกล้องด้วย AES-256-GCM
3. **POSTGRES_PASSWORD**: ห้ามใช้ `postgres`, `admin`, หรือ `password` เด็ดขาด
4. **CORS_ALLOWED_ORIGINS**: ระบุเฉพาะโดเมนของระบบ (เช่น `https://cctv.local.internal`) ห้ามใช้ `*` เมื่อเปิด `credentials: true`

---

## 4. Disaster Recovery (DR) & Backup Drill Runbook

### 4.1 การสำรองข้อมูลฐานข้อมูลรายวัน (Daily PostgreSQL Backup)
สร้าง cron job หรือสคริปต์สำรองข้อมูลอัตโนมัติ:

```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/var/backups/cctv"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="${BACKUP_DIR}/cctv_db_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

# ดัมป์ฐานข้อมูล PostgreSQL และบีบอัด
docker compose exec -T postgres pg_dump -U postgres cctv_db | gzip > "${FILENAME}"

# ลบไฟล์สำรองที่มีอายุเกิน 14 วัน
find "${BACKUP_DIR}" -type f -name "cctv_db_*.sql.gz" -mtime +14 -delete

echo "[DR Backup] Snapshot created successfully: ${FILENAME}"
```

### 4.2 การกู้คืนฐานข้อมูล (Restore Drill Procedure)
เพื่อทดสอบความสมบูรณ์ของไฟล์สำรอง ให้ซ้อมกู้คืนลงฐานข้อมูลทดสอบ:

```bash
# 1. สร้างฐานข้อมูลทดสอบสำหรับซักซ้อม DR
docker compose exec -T postgres psql -U postgres -c "CREATE DATABASE cctv_db_dr_test;"

# 2. นำเข้าข้อมูลจากไฟล์สำรอง
gunzip -c /var/backups/cctv/cctv_db_20261027_000000.sql.gz | docker compose exec -T postgres psql -U postgres -d cctv_db_dr_test

# 3. ตรวจสอบจำนวนแถวตารางสำคัญ
docker compose exec -T postgres psql -U postgres -d cctv_db_dr_test -c "SELECT count(*) FROM \"Camera\";"
docker compose exec -T postgres psql -U postgres -d cctv_db_dr_test -c "SELECT count(*) FROM \"CameraRecording\";"

# 4. ลบฐานข้อมูลทดสอบเมื่อเสร็จสิ้น
docker compose exec -T postgres psql -U postgres -c "DROP DATABASE cctv_db_dr_test;"
```

### 4.3 การซ้อมรับมือ Media Node ล่ม (Failover Evacuation Drill)
เมื่อโหนดมีเดียเกิดปัญหา ให้สั่งย้ายกล้องไปยังโหนดสำรองทันทีผ่าน API:

```bash
# ส่งคำสั่งอพยพกล้องจากโหนด node-01 ไปยังโหนดสำรอง node-02
curl -s -X POST http://127.0.0.1:3000/api/v1/media-nodes/node-01/failover \
  -H "Authorization: Bearer <ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"targetNodeId": "node-02"}'
```

---

## 5. แผนการนำร่อง (Pilot Rollout Staging Gates)

การติดตั้งกล้องจริงจะต้องดำเนินการเป็นระยะ (Staged Rollout) เพื่อตรวจสอบภาระเครือข่ายและสตอเรจ:

```
[Wave 1: Canary Pilot (10 กล้อง)]
   ├── ตรวจสอบค่าความหน่วง WebRTC WHEP (< 500ms)
   ├── ยืนยันการบันทึก fMP4 24 ชั่วโมงไม่มีช่องว่าง (Data Gaps = 0)
   └── ทดสอบการแจ้งเตือน Telegram Bot เมื่อสาย LAN หลุด (< 5 วินาที)
          │ (ผ่านเกณฑ์ 100%)
          ▼
[Wave 2: Multi-Zone Expansion (25 - 50 กล้อง)]
   ├── วางโหนด Media Node แยกตามไซต์โรงงาน (Edge Site Routing)
   ├── ตรวจสอบ Bandwidth Ingress รวม (~50 - 100 Mbps)
   ├── สตรีม Multi-Grid 16 จอพร้อมกัน 3 แดชบอร์ด
   └── ทดสอบตัดต่อและส่งออกคลิปเหตุการณ์ (Evidence Export + 15s Pre-Buffer)
          │ (ผ่านเกณฑ์ 100%)
          ▼
[Wave 3: Full Production Readiness (100 - 1000 กล้อง)]
   ├── ขยาย Media Nodes เป็น Active/Standby Cluster
   ├── กำหนดการ์ดแลน 10Gbps SFP+ หรือ Dual 2.5Gbps LACP
   └── ลงนาม Authorize Release Sign-off อย่างเป็นทางการ
```

---

## 6. UAT Acceptance Criteria & Sign-off

ระบบถือว่าพร้อมส่งมอบเมื่อผ่านเกณฑ์ทดสอบ UAT ครบทั้ง 6 มิติ:

1. **Streaming Performance**: เล่นสดผ่าน WebRTC WHEP พร้อมกัน 16 ช่อง ด้วยความหน่วง Sub-500ms
2. **Continuous Recording**: บันทึก fMP4 โดยตรง (Direct Remux) ต่อเนื่อง 24 ชม. ไม่กิน CPU แปลงรหัส
3. **Evidence Integrity**: ค้นหาไทม์ไลน์และตัดคลิปเหตุการณ์พร้อมบัฟเฟอร์ก่อนเกิดเหตุ (Pre-buffer) สำเร็จภายใน 15 วินาที
4. **Resilience & Scale**: ระบบ Failover ย้ายสตรีมไปยังโหนดสำรองได้อัตโนมัติเมื่อโหนดหลักถูกปิด
5. **Security & Privacy**: มีระบบ Audit Log ติดตามการเข้าดูคลิปย้อนหลัง และระบบ Role-Based Access Control
6. **Isolation Assurance**: ระบบทำงานแยกต่างหาก 100% ไม่ส่งผลกระทบต่อ Image Service เดิม
