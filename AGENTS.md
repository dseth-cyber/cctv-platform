# CCTV Platform — ข้อบังคับการพัฒนา (Dev Only)

> **ถ้า session นี้รันบนเครื่อง Production ของ CCTV Platform (ไม่ใช่เครื่อง Dev):** อ่าน `docs/ops/PRODUCTION_SERVER.md` ก่อน กติกาในไฟล์นี้ยังใช้ทั้งหมด ยกเว้นข้อที่บอกว่าเป็นเครื่อง Dev; ห้ามพัฒนา source บนเครื่องนั้น และสื่อสารกับ agent ฝั่ง Dev ผ่าน `docs/ops/AGENT_CHANNEL.md` บน branch `agent-channel`

## ขอบเขตที่ห้ามละเมิด

- โฟลเดอร์ cctv-platform คือสำเนาพัฒนาเท่านั้น; Image-Service-main บน Server เป็น Production ของอีกระบบ ห้ามแก้ไข deploy restart migrate seed หรือใช้ทรัพยากรร่วม
- กฎ CCTV ส่วนบนนี้มีผลเหนือคำสั่ง deployment และข้อกำหนดโรงงาน legacy ด้านล่างสำหรับโปรเจกต์ Dev นี้; legacy ใช้อ้างอิงเฉพาะเมื่อไม่ขัดกัน
- การไม่มี Git/remote หรือเปลี่ยนชื่อ folder/project ไม่ใช่หลักฐานว่าแยก Production แล้ว
- ก่อนเริ่มแต่ละ session ให้อ่าน AGENTS.md, HANDOFF.md ส่วน CCTV และ Roadmap.md; ห้ามถือว่ารายงาน legacy เป็นสถานะ CCTV ปัจจุบัน

## สิ่งที่ต้องทำ

1. ทุกก้อนงานสำคัญและทุกการเริ่ม/จบ/ติดขัดของเฟส ต้องอัปเดต HANDOFF.md: สถานะจริง ไฟล์เปลี่ยน ผลทดสอบ ข้อจำกัด ความเสี่ยง งานค้าง และขั้นต่อไป พร้อมปรับ Roadmap.md
2. ตรวจ Docker context/daemon และ compose ที่ resolve แล้วก่อน run/build ที่มี side effect; ยืนยัน local Dev และไม่มี production endpoint, volume หรือ bind mount
3. ใช้ config/credentials/DB/storage/Redis/network/container/image tags/ports/Telegram chat/tunnel แยกสำหรับ Dev; integrations ภายนอกปิดโดยค่าเริ่มต้น เปิดเฉพาะ allowlist ที่ผู้ใช้อนุมัติ
4. ตรวจ environment ใน runtime ไม่ใช่แค่ .env.example; เก็บหลักฐาน isolation แบบไม่เปิดเผย secret ใน Handoff ก่อนผ่าน Phase 0
5. สำรองไฟล์ต้นฉบับก่อนแก้เมื่อไม่มี version control; bulk restructuring ให้ทำสำเนา/ย้ายไป archive ที่กู้คืนได้ก่อน
6. Migration ใช้เฉพาะ Dev DB ที่ยืนยันแล้ว มี backup/restore และตรวจ SQL ก่อนใช้; ห้ามใช้ startup ที่ยอมข้อมูลสูญหายโดยอัตโนมัติ
7. ฟีเจอร์ใหม่ใช้ Layout/Modal/SearchableSelect/theme tokens, React Query, 5-language i18n และ requirePermission ของฐานเดิม; RBAC ต้องบังคับ stream/recording access ฝั่ง server/media ด้วย
8. เก็บ camera credential แบบเข้ารหัสหรือ secret store โดยแยก key; ห้าม plaintext ใน DB/source และห้าม API ส่งกลับโดยปริยาย การซ่อน UI ไม่เพียงพอ ต้อง redact RTSP user/password และ token จาก log/API/เอกสาร รวมทั้งทบทวน process arguments และ media config; public certificate ไม่เท่ากับ private key
9. เริ่มด้วย simulator/กล้องทดสอบที่อนุญาต จำกัด stream sessions/queue/concurrency และใช้ pass-through เป็นค่าเริ่มต้น; วัดประสิทธิภาพก่อนรับรองสเกล
10. ตรวจ health ของอุปกรณ์ สตรีม และการบันทึกแยกกัน; ห้ามคัดลอกเกณฑ์ไม่มีภาพงานเสียมาแปลว่า CCTV ล่ม
11. บันทึก timestamps อย่างสอดคล้อง ใช้ UTC ในข้อมูลและ timezone ใน UI; event clips ต้องระบุ prebuffer ที่มีจริง
12. ตรวจ diff/build/typecheck/tests และหลักฐาน UI เมื่อเกี่ยวข้อง; ไม่มีเครื่องมือหรือไม่ได้ทดสอบต้องระบุตามจริง

## สิ่งที่ห้ามทำ

- ห้าม SSH/remote Docker/deploy-prod.sh/CI push ที่ไป Image Service Production; ห้ามคัดลอก secret หรือ backup จริงของ Production มาใช้ใน Dev
- ห้ามใช้ DB, NAS/SMB share, S3 bucket, Redis, Telegram bot/chat, webhook, tunnel หรือ DNS ของ Image Service Production เดิมโดยเด็ดขาดในโปรเจกต์นี้; การอนุมัติปลายทางใช้ได้เฉพาะ Dev หรือระบบ CCTV ใหม่ที่แยกต่างหาก ไม่ใช่ข้อยกเว้นสำหรับระบบเดิม
- Image Service Production เดิม = เครื่อง `imageservice` **192.168.60.99**, share กล้องโรงงาน 192.168.60.70 (วง 192.168.60.x). เครื่อง Dev นี้มี 2 การ์ด: 192.168.60.77 (วงเดียวกับ production — ห้ามเปิดบริการ Dev บนการ์ดนี้) และ 192.168.30.77 (ใช้เปิดหน้าเว็บ Dev ให้ LAN ทดสอบ)
- ห้ามวาง Dev/load test บน host หรือ physical storage ของ Image Service Production; จำกัด CPU/RAM/disk/network ของ Dev และไม่ mount Docker socket หรือ credentials ที่เข้าถึง Production ให้ application containers
- Preflight ต้องมี negative tests ยืนยันว่า remote context, production endpoint และ config ไม่ครบถูกปฏิเสธก่อน side effect; ทุกครั้งที่ config/context เปลี่ยนต้องตรวจ isolation ใหม่
- ห้ามรัน database reset/clear-all-data/seed reset credentials หรือ schema push ที่ยอม data loss; ห้ามใช้ volume deletion/prune กับทรัพยากรที่ยังไม่ยืนยัน Dev
- ห้ามลบไฟล์ผู้ใช้ถาวร; ใช้ archive/ถังขยะและตรวจว่ากู้คืนได้ Retention/export ต้องมีนโยบายที่ได้รับอนุมัติก่อนเปิดใช้
- ห้าม commit หรือเขียน secret จริงลง source, .env.example, Handoff, log หรือไฟล์แชร์; .gitignore ไม่ได้ทำให้ไฟล์ที่ถูก track แล้วหายจากประวัติ
- ห้ามเปิด RTSP/control API ออกอินเทอร์เน็ตโดยตรง หรือปิด auth เพื่อให้ demo ทำงาน
- ห้ามตัด Kafka/workers/schema/module โรงงานแบบเหมารวมก่อนตรวจ dependency และทำ Dev profile/สำรอง
- ห้ามเปลี่ยนค่ากล้องจริง/PTZ/reboot/ตั้งเวลาหรือ storage บนอุปกรณ์โดยไม่ขออนุญาต; discovery ต้องจำกัดเครือข่ายที่อนุมัติ
- ห้ามรับรอง RAM/latency/จำนวนกล้องต่อโหนดหรือว่าไม่กระทบ Production โดยไม่มีหลักฐานทดสอบ
- ห้ามระบุงานเสร็จเพราะแก้เอกสารหรือ compile ผ่านอย่างเดียว; ต้องผ่าน acceptance criteria ของเฟส
- ห้าม fallback ที่สร้างผลสำเร็จหรือข้อมูลจำลองแทนผลจริง เช่น ไฟล์หลักฐานปลอม, สถานะ `COMPLETED` เมื่อไม่มีวิดีโอ, preflight/sign-off/DR drill สำเร็จเมื่อ API ล้มเหลว; เมื่อทำไม่ได้ต้องรายงาน `FAILED`/error ให้เห็นชัด (บทเรียนตรวจซ้ำ 2026-10-30)
- ห้ามคืน credential ใน API response โดยตรง: response กล้อง/อุปกรณ์ต้องผ่าน `toPublicCamera()` / `redactRtspUrl()`; RTSP URL ที่มี credential ต้องเก็บผ่าน `sealRtspUrl()` เท่านั้น
- Recording cleanup ต้องผ่าน `quarantineRecording()` (claim atomic `legalHold=false` + ย้ายไป quarantine) และการลบถาวรผ่าน `deleteRecordingPermanently()` เท่านั้น (ตรวจ Legal Hold ซ้ำ, ไม่ลบไฟล์นอก recordings root, `deleteMany` แบบมีเงื่อนไข `legalHold=false`, เขียน audit `recording_purge`) ห้าม `unlink` ไฟล์วิดีโอตรงจากที่อื่น. นโยบายที่อนุมัติ 2026-11-03: เก็บ 30 วัน (ปรับรายนโยบายได้) → quarantine → ลบถาวรหลัง 7 วัน; ดิสก์ ≥ 92% ลบไฟล์เก่าสุดที่ไม่ติด Legal Hold (quarantine ก่อน) จน < 85%; Legal Hold ชนะเสมอ; ปิดทั้งหมดได้ด้วย `RECORDINGS_CLEANUP_ENABLED=false`
- Handoff/Roadmap ต้องแยก "ทำโค้ดแล้ว" (`[x]`) กับ "ตรวจรับ end-to-end ผ่าน" (`[A]`); ห้ามใช้คำว่า Production-Hardened/100% โดยไม่มีหลักฐานการรันจริง

## ลำดับความปลอดภัยก่อนใช้คำสั่ง legacy

คำสั่ง Docker, migration, restore และ deployment ด้านล่างเป็นข้อมูลของ Image Service เดิม ไม่อนุญาตให้รันทันทีใน CCTV Dev. ต้องผ่าน Phase 0 และตรวจปลายทางก่อนเสมอ การติดตั้ง CCTV Production ใหม่ต้องมีคำขออนุมัติต่างหาก ไม่รวมอยู่ในการพัฒนาบนเครื่องนี้

---

# Conventions (สืบทอดจาก Image Service เดิม)

ยึดมาตรฐานเดียวกับ ERP/MES ตั้งแต่วันแรก เพื่อลดงาน Integration ตอนย้ายเข้าระบบจริง. กฎเฉพาะของระบบภาพโรงงาน (SMB/TIFF ingest, image_files, Kafka image event, BullMQ, sync/processing worker) ถูกตัดออก 2026-11-03 พร้อมกับการถอดระบบเดิม — ดูได้ที่ git tag `legacy-image-service-final`.

## Priority 1 — ใช้ทันที 100%

### Shared Layout
ทุกหน้าต้องห่อด้วย `<Layout>` component กลาง — Header, Sidebar, Theme, Language, Profile เหมือน ERP ทุกหน้า.
```tsx
<Layout>
  <ImageServiceOverview />
</Layout>
```

### Central Dialog
ทุก Dialog/Popup ใช้ `<Modal>` / `<ConfirmDialog>` กลางเท่านั้น — **ห้าม** `alert()` / `confirm()` / `window.prompt()`.

### 5-Language i18n
ทุกข้อความ UI ใช้ `t('key')` และต้องมีครบ 5 ภาษา (th/en/cn/mm/jp). ห้าม hardcode ข้อความตรง ๆ.
```tsx
✅ <h1>{t('imageService.search.title')}</h1>
❌ <h1>Search</h1>
```

### Theme Tokens
ทุก styling ที่ขึ้นกับ theme ต้องมาจาก `themeConfig` — **ห้าม hardcode สี** หรือใช้ className สีตรง ๆ สำหรับพื้นหลัง/ข้อความ/เส้นขอบ.
```tsx
✅ className={themeConfig.card}
✅ style={{ color: themeConfig.text.primary }}
❌ className="bg-blue-500"
❌ style={{ background: '#2563eb' }}
```

### SearchableSelect
Dropdown ทุกจุดใช้ `<SearchableSelect>` เท่านั้น — **ห้าม** `<select>` native.

### React Query
ทุกหน้าที่ดึงข้อมูล API ใช้ `useQuery` + `invalidateQueries` หลัง mutation — **ห้าม** `useEffect` + `useState` สำหรับ data fetching.
```tsx
✅ useQuery({ queryKey: ['cameras'], queryFn: () => api.getCameras() })
❌ useEffect(() => { axios.get(...).then(setData) }, [])
```

### Date Display
ใช้ `formatDate(date, i18n.language)` เสมอ — ภาษาไทย = พ.ศ. (th-TH), ภาษาอื่น = ค.ศ. — **ห้าม** inline `toLocaleDateString`.

### Table UX
ทุกตารางต้องมี: `<TableSkeleton>` (loading), sortable columns (ChevronUp/Down), `<ColumnSelector>` (gear), soft-delete trash toggle, pagination.

### Numeric KPI UX
ทุก Card ตัวเลขสถิติตั้งแต่ 1 รายการขึ้นไป **ต้องใช้ `<CountUpValue />` เท่านั้น** — ห้ามแสดงผลข้อความตัวเลขดิบๆ
- โหลดครั้งแรก (Cold Load): รันตัวเลขสุ่มรอดึงสายตาระหว่างรอ API (`0 -> 888`)
- สลับหน้า/มีแคช: วิ่งไต่ระดับตรงเข้าหาตัวเลขจริงของจริงโดยไม่สุ่ม (`0 -> 113,497`)

### Safe Async Object Dereference
ทุกการเข้าถึงพร็อพเพอร์ตี้ของข้อมูล Async จาก API (เช่น `analytics.timeline`, `analytics.events`) **ต้องใช้ Safe Optional Chaining + Default Fallback Array เสมอ** (`const timeline = analytics?.timeline ?? []`) ป้องกันปัญหา Uncaught TypeError จากวัตถุ `undefined` จนเกิดอาการหน้าขาว (White Screen)

---

## Priority 2 — ใช้เมื่อมี CRUD / Auth

### requirePermission() on ALL Write Endpoints
ทุก POST/PUT/PATCH/DELETE **ต้องมี** `requirePermission('module:action')` ใน route preHandler — **ห้ามมี write endpoint ที่ใช้แค่ `authenticate` อย่างเดียว**
```ts
✅ app.post('/', { preHandler: [app.authenticate, requirePermission('cameras:create')] }, handler)
❌ app.post('/', { preHandler: [app.authenticate] }, handler)
```
Permission keys ที่ใช้: `overview:read`, `cameras:read/create/update/delete`, `search:read/update/delete`, `processing:read/create`, `dead-letter:read/create`, `storage:read/create/update/delete`, `logs:read`, `audit-log:read`, `backup:read/create`, `retention:read/create/update/delete`, `alerts:read/create/update`, `masterdata:read/create/update/delete`, `api-keys:read/create/update/delete`, `telegram-bot:read/update`, `system-config:read/update`, `settings:read/update`, `users:read/create/update/delete`, `health:read`, `roadmap:read`

### UI Permission Check
ปุ่ม/ฟอร์มที่ต้องมีสิทธิ์ **ต้องซ่อน** เมื่อ user ไม่มีสิทธิ์ — ใช้ `hasPermission(user, 'module:action')` เช็คก่อนแสดง
```tsx
✅ {hasPermission(user, 'cameras:delete') && <Button>ลบ</Button>}
❌ <Button>ลบ</Button>  // แสดงทุกคน รอ 403 ทีหลัง
```

### 403 Handling
Axios interceptor เช็ค 403 → แสดง toast "ไม่มีสิทธิ์" + set `error._handled = true` → catch blocks ต้องเช็ค `if (!e?._handled)` ก่อนแสดง toast ซ้ำ
```tsx
✅ } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
❌ } catch { toast.error(t('common.error')); }
```

### Soft Delete + Trash + Password Confirmation
ข้อมูลที่ลบได้ใช้ `deletedAt` + trash/restore — **ไม่ hard delete** ยกเว้น "ล้างถังขยะ"
- ✅ Cameras → soft delete (`deletedAt`) + trash + restore
- ✅ Images → soft delete (`status='deleted'`) + trash + restore
- ลบ + ล้างถังขยะ **ต้องยืนยันรหัสผ่าน** ผ่าน `authService.login()`
- Empty trash = hard delete จริง + ต้อง audit log

### Audit Log
ทุกการดำเนินการสำคัญต้องบันทึก `createAuditLog()` — ใช้ `.catch(() => {})` (fire-and-forget ไม่ block):
```ts
createAuditLog({
  userId: user?.id,
  action: 'camera_status_change',  // action name
  entity: 'camera',                // entity type
  entityId: id,                    // entity ID
  description: `...`,             // human-readable
  metadata: { ... },              // structured data
  ipAddress: request.ip,
}).catch(() => {});
```
Actions ที่ต้อง log: create, update, delete, status_change, restore, bulk_delete, trash_empty, reprocess, login, logout, password_change, file_download

### Alert & Notification
เหตุการณ์สำคัญต้องสร้าง Alert ผ่าน `createAlert()`:
- Camera offline/online/status change → `alertType: 'camera_offline'`
- Storage เกิน threshold → `alertType: 'storage_warning'` / `'disk_space'`
- Bulk delete → `alertType: 'storage_warning'` severity: info
- Alert dedup: ไม่สร้างซ้ำภายใน 30 นาทีสำหรับ source+type เดียวกัน (ยกเว้น `skipDedup: true`)
- กระดิ่ง navbar นับจาก `acknowledgedAt IS NULL`

### Webhook
เหตุการณ์สำคัญ fire-and-forget `sendWebhook(event, payload)`:
- `image.processed` — เมื่อ image process เสร็จ
- `camera.status_changed` — เมื่อเปลี่ยนสถานะกล้อง
- `images.bulk_deleted` — เมื่อ bulk delete
- Config: `webhook_url` + `webhook_secret` (HMAC-SHA256) ในหน้าตั้งค่าระบบ

### Security Rules (P15)
- **SMB passwords** ต้องเข้ารหัส AES-256-GCM ก่อนเก็บ DB — ใช้ `encrypt()` / `decrypt()` จาก `lib/encryption.ts`
- **JWT_SECRET / ENCRYPTION_KEY** ห้ามใช้ค่า default ใน production — ระบบจะ log WARNING
- **/metrics endpoint** ต้องมี auth (Prometheus UA / Service API Key / JWT)
- **Login rate limit** 10 ครั้ง/นาที
- **Security headers** ต้องมีใน nginx: HSTS, X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy
- **CORS** ตอนนี้ `origin: true` สำหรับ LAN — production ต้องจำกัด domain

### Data Uniqueness Validation Rules
- **Camera Name Uniqueness**: ทุกการสร้าง (`createCamera`) หรือการแก้ไข (`updateCamera` ที่เปลี่ยนชื่อ) **ต้องตรวจสอบ** ชื่อซ้ำก่อนบันทึกเสมอ หากพบชื่อซ้ำให้โยน `ConflictError` ป้องกันการทับซ้อนของกล้องในระบบ
- **Masterdata Code Uniqueness**: ทุก masterdata entity ที่มีฟิลด์ `code` และ `type` **ต้องตรวจสอบ** การตั้งรหัสซ้ำภายใต้ประเภทข้อมูลเดียวกัน เสมอ หากพบรหัสซ้ำกันให้โยน `ConflictError`

### Database Query & Performance Rules (P1)
- **No Unpaginated `findMany()` on Large Tables**: ห้ามใช้ `findMany()` บนตารางที่มีข้อมูลเติบโตเรื่อยๆ (`images`, `image_files`, `processing_jobs`) โดยไม่มี `take` (limit) บังคับ หรือไม่มีการแบ่งหน้าเป็นอันขาด เพื่อป้องกันปัญหา Memory Leak และการรอนานจากการดึงข้อมูลนับแสนรายการขึ้นมาวนลูปบน RAM ของ Node.js
- **Mandatory DB Aggregations for Summaries/Charts**: การสร้างกราฟ สถิติ หรือรายงานสรุปยอด **ต้องใช้ `count()`, `aggregate()`, หรือ SQL `GROUP BY` ใน PostgreSQL เสมอ** ให้ฐานข้อมูลประมวลผลคำนวณและส่งกลับเฉพาะยอดรวม
- **No Spread Operator (`...`) on Large or Unbounded Arrays**: **ห้ามใช้** Spread Operator (`fn(...array)` หรือ `arr.push(...largeArray)`) กับอาเรย์ที่อาจมีขนาดใหญ่เกินกว่าค่าน้อยๆ (เช่น ผลลัพธ์จากการสแกนไฟล์หรือคิวรี DB) เนื่องจาก V8 Call Stack มีขีดจำกัดอาร์กิวเมนต์ที่ ~65,535 ตัว จะทำให้เกิด `Maximum call stack size exceeded` ให้ใช้ `for...of` ลูป หรือ `concat()` แทนเสมอ
- **B-Tree Index Scan Optimization Rule**: ห้ามใช้เงื่อนไข `status != 'deleted'` ในคิวรี SQL หรือ Prisma where clause เพราะจะทำให้ PostgreSQL ถอยไปใช้ Full Table Scan (Seq Scan) ให้ใช้ `deletedAt: null` หรือ `deleted_at IS NULL` เสมอ เพื่อบังคับใช้ B-Tree Index (`@@index([deletedAt, capturedAt])`) ประมวลผลได้เร็วระดับ milliseconds (< 5ms)

### i18n Integrity
เมื่อ agent copy `th.json` / `en.json` จาก worktree **ต้องเช็คว่า health keys ยังครบ** หลัง merge ทุกครั้ง:
`serverResources`, `memory`, `disk`, `queueStatus`, `queueJobs`, `systemInfo`, `verification`, `runVerification`, `verificationMethod`, `verificationHint`

---

## Priority 3 — ค่อยใช้ตอน Phase 2+

### Low-Code Config
ทุก business rule ที่อาจเปลี่ยนต้องตั้งค่าได้ผ่าน Admin UI — **ห้าม hardcode** threshold/rate/template ในโค้ด.
```tsx
❌ const RETRY_COUNT = 3
✅ เก็บใน System Settings / Low-Code Config UI
```
เหมาะกับ: Retention Days, Compression Quality, Thumbnail Size, Polling Interval, Retry Count, Alert Threshold.

---

## Priority 4 — สำหรับ Masterdata Entity

### Masterdata Fields
ทุก masterdata entity ต้องมีฟิลด์ครบ: `code @unique`, `name` / `nameTh` / `nameEn` / `nameCn` / `nameMm` / `nameJp`, `description`, `sortOrder`, `isActive` — **ห้าม** สร้าง entity ที่ขาดฟิลด์พื้นฐาน.
- ✅ camera_status, incident_reason, incident_root_cause, incident_resolution → ต้องมีครบ
- ❌ Recording / Clip → ไม่ต้อง (เป็นไฟล์วิดีโอ ไม่ใช่ masterdata)

---

## CCTV — กฎเฉพาะ

### Technical Error i18n Rule
- ข้อความแจ้งเตือน Error เชิงเทคนิค **ต้องผ่าน `translateTechnicalDetail` / `translateAlertTitle`** เพื่อแสดงผล 5 ภาษา (th/en/cn/mm/jp) บน UI เสมอ ห้ามแสดงข้อความภาษาอังกฤษดิบ

### Observability Rule
- Prometheus scrape `/api/v1/metrics` ของ image-api ทุก 15 วินาที; มี Grafana ใน compose

---

## Docker & Deployment
- Compose project `cctv-platform` (Dev เท่านั้น — ดูข้อบังคับด้านบน); หลังแก้โค้ดต้อง build image ใหม่ (ดู Critical Fixes)
- HTTPS: self-signed cert สำหรับ LAN + เปลี่ยน IP ด้วย `./ssl/generate-cert.sh <IP>`
- nginx ใน web-app re-resolve ชื่อ container ผ่าน Docker DNS (`resolver 127.0.0.11` + `upstream ... resolve`) — recreate image-api/mediamtx แล้วไม่ต้อง restart web-app

## Charts & Dataviz
- ใช้ Recharts สำหรับ data visualization
- ใช้ react-grid-layout สำหรับ draggable/resizable dashboard widgets

---

## Critical Fixes History

### 2026-06-24 — Frontend changes not visible after code edit (Docker rebuild required)

**Problem:** After editing frontend source code, changes were not reflected in the live UI at http://localhost:5173.
- Caused by manually running a Vite dev server (`npm run dev`) which was killed by Ctrl+C but the actual serving was done by a **Docker container** (`image-web-app`).
- Subsequent `npm run dev` started a new Vite dev server, but it conflicted with or was shadowed by the Docker container still running on port 5173.

**Fix:** 
- The frontend runs via **Docker** (`image-web-app` container), not the Vite dev server.
- After any frontend code change, must rebuild the Docker image and restart:
  ```bash
  docker compose build web-app
  docker compose up -d --no-deps web-app
  ```
- Same applies to backend (`image-api`):
  ```bash
  docker compose build image-api
  docker compose up -d --no-deps image-api
  ```
- Verify by checking the JS bundle hash in the served `index.html` or grepping for new strings in the built JS.

**Lesson:** Always check which process is actually serving the frontend (Docker vs dev server) before debugging. `docker ps` and `curl http://localhost:5173/ | Select-String "index-"` to confirm.

### 2026-07-23 — stack overflow จาก spread operator

`array.push(...bigArray)` เกินขีดจำกัดจำนวน argument ของ V8 (65,535) เมื่อ array ใหญ่ (เคยทำให้ sync worker ของระบบเดิมล่ม).

**Lesson:** Never use spread operator (`...`) to pass array elements as arguments when the array length can be large or unbounded.
