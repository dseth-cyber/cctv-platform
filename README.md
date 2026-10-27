# Image Service — ระบบจัดการภาพสำหรับโรงงานอัจฉริยะ

ระบบจัดการภาพถ่ายจากกล้องในสายการผลิต (Smart Factory) แบบครบวงจร — ตั้งแต่การรับภาพ TIFF จาก SMB Share, ประมวลผล, จัดเก็บ, ค้นหา, ไปจนถึงการแจ้งเตือนและการเชื่อมต่อกับระบบ ERP ในอนาคต

---

## สารบัญ

- [ภาพรวมสถาปัตยกรรม](#ภาพรวมสถาปัตยกรรม)
- [เทคโนโลยีที่ใช้](#เทคโนโลยีที่ใช้)
- [ความสามารถหลัก](#ความสามารถหลัก)
- [เริ่มต้นใช้งาน](#เริ่มต้นใช้งาน)
- [ตัวแปรสภาพแวดล้อม](#ตัวแปรสภาพแวดล้อม)
- [โครงสร้างโปรเจกต์](#โครงสร้างโปรเจกต์)
- [API Endpoints หลัก](#api-endpoints-หลัก)
- [ฐานข้อมูล](#ฐานข้อมูล)
- [การยืนยันตัวตนและสิทธิ์](#การยืนยันตัวตนและสิทธิ์)
- [การปรับใช้](#การปรับใช้)
- [กฎและธรรมเนียมปฏิบัติ](#กฎและธรรมเนียมปฏิบัติ)
- [การพัฒนาเพิ่มเติม](#การพัฒนาเพิ่มเติม)

---

## ภาพรวมสถาปัตยกรรม

```
กล้องถ่ายภาพ (TIFF) ──► SMB Share
         │
         ▼
  image-sync-worker (Node.js)
  ─ Poll SMB, ลงทะเบียนภาพ, สร้าง Job
         │
         ▼
  Redis / BullMQ (Job Queue)
         │
         ▼
  image-processing-worker (Python)
  ─ อ่าน TIFF → ตรวจสอบ → แปลง PNG → สร้าง Thumbnail
  ─ SHA-256 Checksum → อัปโหลด MinIO → รายงานผล
         │
    ┌────┴────┐
    ▼         ▼
  MinIO    PostgreSQL
(Storage)  (Metadata)

         ▲
         │
    image-api (Fastify REST API)
         ▲
         │
    Web App (React)
```

**ขั้นตอนการทำงาน:**
1. กล้องถ่ายภาพ TIFF เก็บไว้ใน SMB Share ของกล้อง
2. `image-sync-worker` คอยตรวจสอบ SMB Share เมื่อเจอภาพใหม่จะลงทะเบียนผ่าน API และสร้าง Job ใน Redis Queue
3. `image-processing-worker` อ่าน Job จาก Redis, อ่าน TIFF, ตรวจสอบความถูกต้อง, แปลงเป็น PNG, สร้าง Thumbnail, คำนวณ SHA-256, อัปโหลดไฟล์ทั้ง 3 ไปยัง MinIO, รายงานผลผ่าน API, และส่ง Kafka Event
4. `image-api` เป็น REST Gateway สำหรับ CRUD, ค้นหา, ตั้งค่า, และ serve ไฟล์
5. **Web App** ให้ผู้ดูแลระบบและพนักงานหน้างานใช้งานผ่านเบราว์เซอร์

---

## เทคโนโลยีที่ใช้

| ชั้น | เทคโนโลยี |
|---|---|
| **Frontend** | React 18, TypeScript, Vite 5, TanStack React Query 5, react-router-dom 6, Tailwind CSS 3, i18next (5 ภาษา), Recharts, react-grid-layout, lucide-react |
| **Backend API** | Node.js 22, Fastify 5, TypeScript, Prisma 6, Zod, Pino, node-cron |
| **Backend Workers** | Node.js 22 (SMB Poller), Python 3.12 (TIFF Processing) |
| **ฐานข้อมูล** | PostgreSQL 15, Redis 7 |
| **Object Storage** | MinIO (S3-compatible) |
| **Message Queue** | BullMQ (Redis), Kafka 7.7 (Event Bus) |
| **DevOps** | Docker Compose (11+ containers) |

---

## ความสามารถหลัก

### ระบบรับภาพ (Image Ingestion)
- Poll SMB/CIFS Share เพื่อค้นหาภาพใหม่
- ลงทะเบียนภาพผ่าน REST API
- สร้าง Job ใน Redis Queue เพื่อรอประมวลผล
- รองรับ Retry อัตโนมัติเมื่อประมวลผลล้มเหลว

### ระบบประมวลผล (Image Processing)
- แปลง TIFF → PNG พร้อมปรับ compression quality
- สร้าง Thumbnail ขนาดกำหนดเอง
- คำนวณ SHA-256 checksum สำหรับตรวจสอบความถูกต้อง
- ตรวจสอบความถูกต้องของไฟล์ TIFF (ขนาด, bit depth, color space)
- จัดเก็บครบ 3 ประเภทต่อภาพ: Original TIFF, Processed PNG, Thumbnail

### จัดการกล้อง (Camera Management)
- CRUD กล้องถ่ายภาพ
- ตั้งค่า SMB/CIFS (path, domain, username, password)
- เข้ารหัสรหัสผ่าน SMB ด้วย pgcrypto
- ติดตามสถานะกล้อง (active, inactive, error, maintenance)
- กำหนด poll interval และ retention policy ต่อกล้อง

### จัดการพื้นที่จัดเก็บ (Storage Management)
- ภาพรวมพื้นที่ใช้งานแยกตามกล้อง
- แนวโน้มการเติบโต (Growth Trend)
- พยากรณ์พื้นที่ล่วงหน้า (Forecast)
- นโยบาย Retention (กำหนดอายุภาพแยกตามประเภท)
- ระบบ Sweep อัตโนมัติ (node-cron รายวัน)
- รองรับ Hot/Warm/Cold Storage Class

### ระบบแจ้งเตือน (Alerting & Notifications)
- กฎเกณฑ์การแจ้งเตือนแบบ Threshold-based
- ประเภทการแจ้งเตือน: พื้นที่เก็บข้อมูล, การประมวลผลล้มเหลว, กล้อง offline
- ช่องทางแจ้งเตือน: Telegram Bot, LINE Notify, In-app
- การรับทราบ (Acknowledge) และแก้ไข (Resolve)

### จัดการผู้ใช้และความปลอดภัย
- CRUD ผู้ใช้ (admin/operator/viewer + custom roles)
- RBAC แบบ Role Hierarchy + Custom Permissions
- JWT Access + Refresh Token (rotation)
- API Keys สำหรับ Machine-to-Machine (service-to-service + third-party)
- บันทึกการตรวจสอบ (Audit Log) ทุกการดำเนินการ

### ตั้งค่าระบบ (Low-Code Config)
- ปรับ retention days, compression quality, thumbnail size, poll interval
- อัปโหลดโลโก้ระบบ, ตั้งค่า version และ developer
- ตั้งค่า Telegram / LINE notification ผ่าน UI
- จัดการ Masterdata หลายภาษา (Camera Type, Image Category, Defect Type, Inspection Type)

### Multi-Language UI
- รองรับ 5 ภาษา: ไทย (th), อังกฤษ (en), จีน (cn), พม่า (mm), ญี่ปุ่น (jp)
- ตรวจจับภาษาอัตโนมัติจากเบราว์เซอร์
- แปลงปี พ.ศ./ค.ศ. ตามภาษา

### รองรับหลายธีม
- modern / dark / light
- ใช้ Theme Token จาก `themeConfig` ตลอดทั้งระบบ
- ไม่มี hardcode สี

---

## เริ่มต้นใช้งาน

### สิ่งที่ต้องมี
- Docker + Docker Compose
- Node.js 22 (สำหรับ development)
- Python 3.12 (สำหรับ development)

### ใช้งานด้วย Docker Compose (แนะนำ)

```bash
git clone <repo-url>
cd image-service
docker-compose up -d
```

บริการที่จะเริ่มทำงาน:

| Container | Port | คำอธิบาย |
|---|---|---|
| web-app | 443 (HTTPS), 80 (→redirect) | Frontend + Reverse Proxy |
| image-api | 3001 | REST API |
| postgres | 5432 | ฐานข้อมูล PostgreSQL |
| redis | 6379 | Cache และ Job Queue |
| minio | 9300 (API), 9301 (Console) | Object Storage |
| smb-server | 9445 | SMB Share จำลอง |
| image-sync-worker | — | SMB Poller |
| image-processing-worker | — | TIFF Processor |
| zookeeper | 2181 | Kafka dependency |
| kafka | 9093 | Event Bus |
| historian-consumer | — | Kafka consumer stub |
| production-consumer | — | Kafka consumer stub |

### ผู้ใช้เริ่มต้น

| ชื่อผู้ใช้ | รหัสผ่าน | สิทธิ์ |
|---|---|---|
| `admin` | `admin123` | จัดการระบบทั้งหมด |
| `operator` | `operator123` | ดูและดำเนินการ |
| `viewer` | `viewer123` | ดูอย่างเดียว |

### เข้าถึงระบบ

| บริการ | URL |
|---|---|
| Web App | https://192.168.30.248 |
| REST API | https://192.168.30.248/image-service/api/v1 |
| Swagger Docs | http://192.168.30.248:3001/docs |
| MinIO Console | http://192.168.30.248:9301 |

> **หมายเหตุ:** ระบบบังคับใช้ HTTPS — เข้าผ่าน HTTP จะ redirect ไป HTTPS อัตโนมัติ
> เบราว์เซอร์อาจแจ้งเตือน "Not Secure" เนื่องจากใช้ Self-signed Certificate ซึ่งปลอดภัยสำหรับใช้งานภายใน LAN

---

## HTTPS / SSL Certificate

ระบบใช้ **Self-signed Certificate** สำหรับการเข้าถึงผ่าน HTTPS ภายใน LAN

### สร้าง Certificate ครั้งแรก

```bash
cd /home/administrator/Image-Service
./ssl/generate-cert.sh 192.168.30.248
docker compose up -d
```

### เปลี่ยน IP เครื่อง (ย้ายติดตั้ง)

เมื่อย้ายเครื่องไปใช้ IP ใหม่ ทำแค่ 2 ขั้นตอน:

```bash
cd /home/administrator/Image-Service
./ssl/generate-cert.sh <IP-ใหม่>
docker compose restart web-app
```

ไม่ต้อง rebuild — Certificate mount ผ่าน Docker volume

### เพิ่ม Subdomain (เข้าผ่านอินเทอร์เน็ต)

```bash
./ssl/generate-cert.sh 192.168.30.248 images.yourdomain.com
docker compose restart web-app
```

สามารถใส่ได้ทั้ง IP และ domain พร้อมกัน

### ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | คำอธิบาย |
|---|---|
| `ssl/generate-cert.sh` | Script สร้าง certificate (รับ IP/domain เป็น parameter) |
| `ssl/server.crt` | Certificate (ไม่ commit เข้า git) |
| `ssl/server.key` | Private key (ไม่ commit เข้า git) |
| `web-app/nginx.conf` | Nginx config (HTTPS + HTTP redirect) |

---

## ตัวแปรสภาพแวดล้อม

### หลัก (image-api)

| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
|---|---|---|
| `NODE_ENV` | development | โหมดการทำงาน |
| `PORT` | 3002 | พอร์ตของ API |
| `DATABASE_URL` | postgresql://image_user:image_pass@localhost:5432/image_db | สตริงเชื่อมต่อฐานข้อมูล |
| `JWT_SECRET` | dev-jwt-secret-change-in-production | คีย์สำหรับเซ็น JWT |
| `JWT_ACCESS_EXPIRES_IN` | 15m | อายุ Access Token |
| `JWT_REFRESH_EXPIRES_IN` | 7d | อายุ Refresh Token |
| `MINIO_ENDPOINT` | localhost | ที่อยู่ MinIO |
| `MINIO_PORT` | 9000 | พอร์ต MinIO |
| `MINIO_ACCESS_KEY` | minioadmin | คีย์เข้าใช้ MinIO |
| `MINIO_SECRET_KEY` | minioadmin | คีย์ลับ MinIO |
| `MINIO_BUCKET` | image-service | Bucket ชื่อ |
| `REDIS_HOST` | localhost | ที่อยู่ Redis |
| `REDIS_PORT` | 6379 | พอร์ต Redis |
| `ENCRYPTION_KEY` | dev-encryption-key-32chars!! | คีย์เข้ารหัสรหัสผ่าน SMB |
| `SERVICE_API_KEY` | dev-service-api-key-change-in-production | คีย์สำหรับ service-to-service |
| `TELEGRAM_BOT_TOKEN` | (empty) | Token Telegram Bot |
| `TELEGRAM_CHAT_ID` | (empty) | Chat ID สำหรับแจ้งเตือน |
| `LINE_ACCESS_TOKEN` | (empty) | Token LINE Notify |

### Worker

| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
|---|---|---|
| `POLL_INTERVAL_MS` | 15000 | ความถี่ในการตรวจสอบ SMB (มิลลิวินาที) |
| `POLL_CONCURRENCY` | 5 | จำนวนกล้องที่ตรวจสอบพร้อมกัน |
| `PROCESSING_CONCURRENCY` | 4 | จำนวนภาพที่ประมวลผลพร้อมกัน |
| `PNG_COMPRESSION_LEVEL` | 6 | ระดับบีบอัด PNG (0-9) |
| `THUMBNAIL_SIZE` | 512 | ขนาด Thumbnail (px) |
| `KAFKA_BOOTSTRAP_SERVERS` | kafka:9092 | ที่อยู่ Kafka |

---

## โครงสร้างโปรเจกต์

```
image-service/
├── docker-compose.yml              # รวมทุก service
├── .env                            # ตัวแปรสภาพแวดล้อม
├── AGENTS.md                       # กฎและธรรมเนียมปฏิบัติ
├── ARCHITECTURE.md                 # แบบสถาปัตยกรรม C4
├── DATABASE_SCHEMA.md              # รายละเอียดฐานข้อมูล
│
├── image-api/                      # REST API (Node.js / Fastify)
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── prisma/
│   │   ├── schema.prisma           # 18 models, 9 enums
│   │   └── seed.ts                 # ข้อมูลเริ่มต้น
│   ├── src/
│   │   ├── index.ts                # จุดเริ่มต้น
│   │   ├── app.ts                  # ตั้งค่า Fastify + route registration
│   │   ├── config/index.ts         # ค่าตั้งค่าจาก environment
│   │   ├── lib/                    # prisma, minio, redis, logger, errors
│   │   ├── middleware/             # auth, rbac, api-token-auth, error-handler
│   │   └── modules/                # 19 โมดูล (auth, images, cameras, ฯลฯ)
│   └── openapi/                    # OpenAPI specs
│
├── web-app/                        # Frontend (React / Vite)
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── src/
│   │   ├── App.tsx                 # Layout หลัก + Routing
│   │   ├── contexts/               # AuthContext, ThemeContext, ToastContext
│   │   ├── i18n/locales/           # th.json, en.json, cn.json, mm.json, jp.json
│   │   ├── components/ui/          # Button, Modal, SearchableSelect ฯลฯ
│   │   └── pages/
│   │       ├── auth/LoginPage.tsx
│   │       └── image-service/      # 19 หน้า
│
├── image-sync-worker/              # SMB Poller (Node.js)
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.ts                # Main loop
│       ├── lib/                    # api-client, poller, scanner, smb, tracker, checksum, producer
│       └── types/
│
├── image-processing-worker/        # TIFF Processor (Python 3.12)
│   ├── Dockerfile
│   ├── requirements.txt
│   └── src/
│       ├── worker.py               # Main loop (Redis BRPOP)
│       ├── processor.py            # TIFF pipeline
│       ├── minio_storage.py        # MinIO upload
│       ├── api_client.py           # HTTP client
│       ├── kafka.py                # Kafka producer
│       ├── validator.py            # TIFF validation
│       └── checksum.py             # SHA-256
│
├── consumer-stubs/                 # Kafka consumer stubs
│   ├── historian_consumer.py
│   └── production_consumer.py
│
├── ssl/                            # SSL Certificate
│   ├── generate-cert.sh            # Script สร้าง cert (รับ IP/domain)
│   ├── server.crt                  # Certificate (ไม่ commit)
│   └── server.key                  # Private key (ไม่ commit)
│
└── mock_smb_shares/                # ไฟล์ทดสอบสำหรับ SMB
    ├── cam_1/ ถึง cam_10/
    └── test_*.tiff
```

---

## API Endpoints หลัก

### ยืนยันตัวตน (`/api/v1/auth`)
| Method | Path | คำอธิบาย |
|---|---|---|
| POST | `/login` | เข้าสู่ระบบ (รับ JWT + refresh token) |
| POST | `/refresh` | ต่ออายุ access token |
| GET | `/me` | ดูข้อมูลผู้ใช้ปัจจุบัน |
| POST | `/logout` | ยกเลิก refresh token |

### รูปภาพ (`/api/v1/images`)
| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/` | ค้นหาภาพ (cameraId, status, date range, filename) |
| POST | `/` | ลงทะเบียนภาพใหม่ |
| GET | `/:id` | ดูรายละเอียดภาพ |
| PATCH | `/:id/metadata` | อัปเดต metadata |
| DELETE | `/:id` | ลบภาพ (soft-delete) |
| POST | `/:id/reprocess` | ส่งภาพเข้าคิวประมวลผลใหม่ |
| GET | `/:id/files/:fileType` | ดาวน์โหลดไฟล์ (raw/processed/thumbnail) |

### กล้อง (`/api/v1/cameras`)
| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/` | รายการกล้อง |
| POST | `/` | เพิ่มกล้อง |
| PATCH | `/:id` | แก้ไขกล้อง |
| DELETE | `/:id` | ปิดการใช้งานกล้อง |

### Logs การประมวลผล (`/api/v1/processing-logs`)
| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/` | ค้นหา logs (status, jobType, imageId) |
| GET | `/stats` | สถิติการประมวลผล |
| GET | `/stream` | Real-time SSE stream |
| POST | `/:id/retry` | ลองประมวลผลใหม่ |
| POST | `/:id/reject` | ปฏิเสธ job |
| POST | `/dlq/bulk-retry` | Retry หลายรายการใน DLQ |
| POST | `/dlq/bulk-reject` | Reject หลายรายการใน DLQ |

### จัดเก็บ (`/api/v1/storage`)
| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/summary` | ภาพรวมพื้นที่ทั้งระบบ |
| GET | `/cameras/:cameraId` | พื้นที่แยกตามกล้อง |
| GET | `/growth` | แนวโน้มการเติบโต |
| GET | `/forecast` | พยากรณ์พื้นที่ |

### ตั้งค่าระบบ (`/api/v1/system-config`)
| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/` | ดูค่าตั้งค่าทั้งหมด (ไม่ต้อง auth) |
| POST | `/bulk-update` | อัปเดตค่าตั้งค่า |

### อื่นๆ
- `CRUD /api/v1/retention-policies` — นโยบาย retention
- `CRUD /api/v1/alerts` — การแจ้งเตือน
- `CRUD /api/v1/alert-rules` — กฎเกณฑ์การแจ้งเตือน
- `CRUD /api/v1/users` — ผู้ใช้
- `CRUD /api/v1/roles` — บทบาท (พร้อมชื่อหลายภาษา)
- `CRUD /api/v1/api-keys` — คีย์ API
- `CRUD /api/v1/masterdata` — ข้อมูลหลักหลายภาษา
- `GET /api/v1/audit-logs` — บันทึกการตรวจสอบ
- `GET/POST /api/v1/backup` — การสำรองข้อมูล
- `GET /api/v1/health` — ตรวจสอบสถานะระบบ

---

## ฐานข้อมูล

### โมเดล (18 models)

| โมเดล | ตาราง | คำอธิบาย |
|---|---|---|
| User | `users` | ผู้ใช้ระบบ |
| CustomRole | `custom_roles` | บทบาทแบบกำหนดเอง (หลายภาษา) |
| RefreshToken | `refresh_tokens` | Token สำหรับต่ออายุ JWT |
| ApiKey | `api_keys` | คีย์สำหรับ machine-to-machine |
| RetentionPolicy | `retention_policies` | นโยบายอายุภาพ |
| Camera | `cameras` | ข้อมูลกล้อง |
| Image | `images` | ข้อมูลภาพ (partition รายเดือน) |
| ImageFile | `image_files` | ไฟล์ภาพ (3 รายการต่อภาพ) |
| ImageTag | `image_tags` | Tag รูปภาพ (key-value) |
| ProcessingJob | `processing_jobs` | Job การประมวลผล |
| CameraEvent | `camera_events` | เหตุการณ์ของกล้อง |
| StorageSnapshot | `storage_snapshots` | ภาพรวมพื้นที่รายวัน |
| Alert | `alerts` | การแจ้งเตือน |
| AlertRule | `alert_rules` | กฎเกณฑ์แจ้งเตือน |
| SystemSetting | `system_settings` | ค่าตั้งค่าระบบ |
| SystemConfig | `system_configs` | ค่าตั้งค่า low-code |
| Masterdata | `masterdata` | ข้อมูลหลักหลายภาษา |
| AuditLog | `audit_logs` | บันทึกการตรวจสอบ |
| BackupRecord | `backup_records` | ประวัติการสำรองข้อมูล |

### Enums (9)
`Role`, `ImageStatus`, `FileType`, `StorageClass`, `CameraStatus`, `CameraEventType`, `AlertSeverity`, `AlertType`, `MasterdataType`

### Partition
- `images` — RANGE partition รายเดือนตาม `captured_at`
- `processing_events` — RANGE partition รายเดือนตาม `created_at`

---

## การยืนยันตัวตนและสิทธิ์

### JWT Authentication (หลัก)
- **Access Token**: อายุสั้น (15 นาที), เซ็นด้วย `@fastify/jwt`
- **Refresh Token**: อายุ 7 วัน, เก็บใน `refresh_tokens`, ใช้ครั้งเดียว (rotation ทุก refresh)

### Service API Key (Machine-to-Machine)
- Header: `x-service-api-key`
- ใช้โดย workers (sync-worker, processing-worker) สำหรับเรียก API โดยไม่ต้องมี JWT

### API Token (Third-party)
- Header: `x-api-token`
- ตรวจสอบกับตาราง `api_keys` (hashed + expiry + permissions)

### RBAC
- ลำดับสิทธิ์: system (100) > admin (80) > operator (50) > viewer (10)
- `requirePermission(permission)` middleware ตรวจสอบสิทธิ์
- สามารถกำหนด Custom Permissions ได้ผ่าน UI
- ผู้ใช้ admin/system ได้รับ wildcard `*`

---

## การปรับใช้

### ปัจจุบัน: Docker Compose (Single VM)
- 11+ containers บน VM เดียว
- Bridge network: `image-network`
- Persistent volumes: `postgres-data`, `redis-data`, `minio-data`

### แผนพัฒนา (Roadmap)

| Phase | รายละเอียด |
|---|---|
| **Phase 0 (Dev)** | Docker Compose รวมทุก service บน VM เดียว |
| **Phase 1 (POC)** | VM เดียว, กล้องจำนวนน้อย |
| **Phase 2 (Pilot)** | Dedicated VM สำหรับ Image Service แยกจาก ERP |
| **Phase 3 (Production)** | Load balancer, PostgreSQL replica, Redis replica, MinIO distributed (4 nodes), Kafka Event Bus |
| **Phase 4 (Scale)** | 50+ กล้อง, PB-scale, AI Vision, Synology NAS cold tier |

---

## กฎและธรรมเนียมปฏิบัติ

| ลำดับ | ข้อกำหนด |
|---|---|
| **P1** | ทุกหน้าห่อด้วย `<Layout>` component กลาง — Header, Sidebar, Theme, Language, Profile |
| **P1** | Dialog/Popup ใช้ `<Modal>` / `<ConfirmDialog>` เท่านั้น — ห้าม `alert()` / `confirm()` |
| **P1** | ข้อความ UI ใช้ `t('key')` และต้องมีครบ 5 ภาษา (th/en/cn/mm/jp) |
| **P1** | Styling ใช้ `themeConfig` เท่านั้น — ห้าม hardcode สี |
| **P1** | Dropdown ใช้ `<SearchableSelect>` — ห้าม `<select>` native |
| **P1** | Data fetching ใช้ `useQuery` — ห้าม `useEffect` + `useState` |
| **P1** | แสดงวันที่ใช้ `formatDate(date, i18n.language)` |
| **P1** | ทุกตาราง: `<TableSkeleton>`, sortable columns, `<ColumnSelector>`, soft-delete toggle, pagination |
| **P2** | POST/PUT/PATCH/DELETE ต้องมี `authorize([PERMISSIONS.X])` |
| **P2** | ข้อมูลที่ลบได้ใช้ soft delete (`deletedAt`) |
| **P3** | Business rule ที่เปลี่ยนได้ต้องตั้งค่าผ่าน Admin UI |
| **P4** | Masterdata entity ต้องมี `code`, `nameTh`/`nameEn`/`nameCn`/`nameMm`/`nameJp`, `description`, `sortOrder`, `isActive` |
| **P5** | พร้อมรองรับ Kafka Event เมื่อประมวลผลเสร็จ |

---

## การพัฒนาเพิ่มเติม

### สิ่งที่ต้องมี
- Node.js 22
- Python 3.12
- Docker Desktop
- PostgreSQL 15 (หรือใช้ Docker)
- Redis 7 (หรือใช้ Docker)
- MinIO (หรือใช้ Docker)

### เริ่มต้นพัฒนา Backend

```bash
cd image-api
npm install
cp .env.example .env
npm run db:push    # สร้างตารางในฐานข้อมูล
npm run db:seed    # เพิ่มข้อมูลเริ่มต้น
npm run dev        # เริ่มต้น development server ที่พอร์ต 3002
```

### เริ่มต้นพัฒนา Frontend

```bash
cd web-app
npm install
npm run dev        # เริ่มต้น Vite dev server ที่พอร์ต 5173
```

### ทดสอบ

```bash
# Backend
cd image-api
npm test

# Frontend
cd web-app
npm run build      # ตรวจสอบ compilation
```

### Prisma Commands

```bash
cd image-api
npx prisma db push          # สร้างตารางตาม schema
npx prisma db seed          # เพิ่มข้อมูลเริ่มต้น
npx prisma studio           # เปิด GUI สำหรับดูฐานข้อมูล
npx prisma migrate dev      # สร้าง migration ใหม่
```

---

> เอกสารนี้สร้างขึ้นโดยอัตโนมัติ — อัปเดตล่าสุด: มิถุนายน 2026
