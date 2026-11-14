# คู่มือ Deploy ขึ้น Production (CCTV Platform)

สำหรับคนหรือ agent ที่ติดตั้งบน **Server Production ของ CCTV Platform** (Ubuntu + Docker Engine)
แผนรวม ฮาร์ดแวร์ และกติกาของ agent อยู่ใน [PRODUCTION_SERVER.md](PRODUCTION_SERVER.md) เอกสารนี้เป็นขั้นตอนลงมือทำ

> ไม่มี secret ในเอกสารนี้ ค่าลับสร้างใหม่บนเครื่อง Production และเก็บในตู้รหัสผ่าน ห้ามคัดลอกจาก Dev
> ห้ามแตะ Image Service เดิม (192.168.60.x) ห้ามผูกพอร์ตใดกับวงนั้น

ตัดสินใจแล้ว:
- 2026-11-11: ฐานข้อมูลเริ่มใหม่ ไม่ย้ายข้อมูลทดสอบหรือประวัติ
- 2026-11-14: **ไม่ส่งอะไรจาก Dev ไป Server นอกจากโค้ดใน git** (ไม่นำเข้าไฟล์ตั้งค่า, ไม่ส่งไฟล์ image) ผู้ใช้ตั้งเครื่องบันทึก/กล้อง/role เองบน Production; ขั้น 5 จึงไม่ใช้
- 2026-11-14: **ตัด MinIO ออกจากระบบ** (rc3) image ของ MinIO ไม่มีบน Docker Hub แล้ว และ CCTV ไม่ได้เก็บไฟล์ในนั้น ที่เก็บไฟล์คือดิสก์ของเครื่อง (`local-storage-data`)
- 2026-11-14: คลิปหลักฐานที่เสร็จแล้วเก่าเกิน 90 วัน (`clips_retention_days`, ผู้ใช้อนุมัติ) ย้ายไปถังขยะ กู้คืนได้ 7 วันแล้วลบถาวร; Legal Hold ไม่ถูกแตะ
- 2026-11-12: release แรกคือ `v1.0.0-rc1`; **ผู้ใช้อนุมัติ deploy ทุกรอบด้วยตัวเอง** (ข้อความจาก agent ไม่ใช่การอนุมัติ);
  Server ออกอินเทอร์เน็ตได้ตอน build จึง build image บนเครื่องเอง; กล้อง `IT-SERVER-001` ไม่นำเข้า ผู้ใช้เพิ่มเองบน Production

## ไฟล์ที่ใช้

| ไฟล์ | หน้าที่ |
|---|---|
| `docker-compose.yml` + `docker-compose.prod.yml` | ชุดเดียวกับ Dev บวกส่วนของ Production: `DEPLOY_ENV=production`, image ตามเวอร์ชัน, image ภายนอกตรึงตามที่ทดสอบบน Dev, log หมุนเวียน 20 MB x 5, ไม่เปิดพอร์ต DB/Redis, subnet ของ Docker คงที่ 10.250.0.0/24, ไฟล์บันทึกไปดิสก์ใหญ่ |
| `.env.production.example` | รายชื่อตัวแปรทั้งหมดพร้อมคำอธิบาย (ไม่มีค่าลับ) คัดลอกเป็น `.env.production` บนเครื่องเท่านั้น |
| `scripts/prod-preflight.sh` | ตรวจก่อน deploy (อ่านอย่างเดียว ไม่พิมพ์ค่าลับ): ค่าครบ, ค่าลับไม่ใช่ของ Dev, ไม่ผูก 0.0.0.0 หรือ 192.168.60.x, ดิสก์, TLS, compose, git tag |
| `scripts/prod-smoke.mjs` | ตรวจหลัง deploy: เว็บ, API, ระบุว่าเป็น production, MediaMTX, เครื่องบันทึก, ภาพสดจริง 1 กล้อง, รหัสเริ่มต้นใช้ไม่ได้แล้ว |
| `image-api/prisma/config-transfer.ts` | (ไม่ใช้ในการติดตั้งนี้) ส่งออก/นำเข้าการตั้งค่าระหว่างเครื่อง ค่าเริ่มต้นเป็น dry run |

image-api จะ **ไม่ยอมเริ่มทำงาน** บน Production ถ้าค่าลับเป็นค่าของ Dev/ค่าตัวอย่าง สั้นกว่า 32 ตัว ซ้ำกัน หรือ `CCTV_ISOLATION_VERIFIED` ไม่เป็น true
(`src/config/production-guard.ts`) log จะบอกชื่อตัวแปรที่ผิด ไม่บอกค่า

ในตัวอย่างคำสั่งข้างล่าง ใช้ตัวย่อนี้:

```sh
alias dcp='docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml'
```

## ขั้น 0 ฝั่ง Dev: ปล่อย release (ต้องให้ผู้ใช้อนุมัติ)

1. ทุกอย่างอยู่ใน `fix/audit-remediation` แล้ว ทดสอบผ่านบน Dev
2. ผู้ใช้อนุมัติชื่อเวอร์ชัน เช่น `v1.0.0-rc1` แล้วจึงสร้าง tag และ push (`git tag -a v1.0.0-rc1 -m ...`, `git push origin v1.0.0-rc1`)
3. ส่งออกการตั้งค่าจาก Dev (อ่านอย่างเดียว):
   ```sh
   docker cp image-api/prisma/config-transfer.ts cctv-api:/app/prisma/config-transfer.ts   # ถ้า image บน Dev ยังไม่มีไฟล์นี้
   docker exec -w /app cctv-api tsx prisma/config-transfer.ts export /tmp/cctv-config.json
   docker cp cctv-api:/tmp/cctv-config.json ./cctv-config-<วันที่>.json
   ```
   ไฟล์นี้ **ไม่มีรหัสผ่าน** แต่มี IP, ชื่อผู้ใช้ของเครื่องบันทึก และผังสิทธิ์ ถือเป็นข้อมูลภายใน ส่งให้เครื่อง Production ทางที่ปลอดภัย (scp) ห้ามแปะในแชท/channel
4. ประกาศใน `docs/ops/AGENT_CHANNEL.md`: tag, สิ่งที่เปลี่ยน, ต้อง migrate ไหม, วิธีย้อนกลับ

## ขั้น 1 เตรียมเครื่อง (ครั้งแรก)

ทำตาม checklist ใน [PRODUCTION_SERVER.md §6](PRODUCTION_SERVER.md) แล้วเพิ่ม:

- ดิสก์บันทึก: mount ดิสก์ใหญ่ (เช่น `/srv/cctv/recordings`) แยกจากดิสก์ระบบ แล้ว `sudo chown -R 1001:1001 /srv/cctv/recordings`
  (mediamtx และ image-api ทำงานเป็น uid 1001)
- subnet ของ Docker: ค่าเริ่มต้น `10.250.0.0/24` ต้องไม่ชนกับ LAN ใดที่เครื่องนี้ใช้ ถ้าชนให้ตั้ง `CCTV_DOCKER_SUBNET`
  แนะนำตั้ง `default-address-pools` ใน `/etc/docker/daemon.json` เป็นวง 10.x ด้วย เพื่อไม่ให้ network อื่นของ Docker ไปได้วง 192.168.x
  (บน Dev เคยเกิด: network ทดสอบได้ 192.168.16.0/20 แล้วทับวงกล้อง 192.168.20.x/30.x ทำให้ทุก container ติดต่อเครื่องบันทึกไม่ได้)
- TLS: ใส่ใบรับรองของบริษัทที่ `ssl/server.crt` และ `ssl/server.key` (หรือ `bash ssl/generate-cert.sh <IP ของ Server>` ชั่วคราว; ใช้ bash ไม่ใช่ sh) โฟลเดอร์นี้ไม่อยู่ใน git
- `git clone` แล้ว `git checkout v<เวอร์ชัน>` (ห้าม deploy จาก branch)

## ขั้น 2 ตรวจการแยกจาก Image Service เดิม

จากเครื่อง Production ต้อง **ติดต่อไม่ได้**:

```sh
nc -z -w3 192.168.60.99 443 && echo "REACHABLE: STOP" || echo "not reachable: ok"
nc -z -w3 192.168.60.99 80  && echo "REACHABLE: STOP" || echo "not reachable: ok"
```

ถ้าติดต่อได้ ให้หยุดและแจ้ง IT ปิดเส้นทางก่อน ผ่านแล้วจึงตั้ง `CCTV_ISOLATION_VERIFIED=true`

## ขั้น 3 ค่าตั้งของเครื่อง

```sh
cp .env.production.example .env.production
chmod 600 .env.production
# สร้างค่าลับแต่ละตัวแยกกัน: openssl rand -hex 32
nano .env.production
sh scripts/prod-preflight.sh .env.production      # ต้องได้ 0 FAIL
```

เก็บ `ENCRYPTION_KEY` ไว้ในตู้รหัสผ่านด้วย ถ้าหาย backup ที่ restore กลับมาจะอ่านรหัสเครื่องบันทึกไม่ได้ และห้ามเปลี่ยนหลังเพิ่มเครื่องบันทึกแล้ว

## ขั้น 4 ติดตั้งครั้งแรก (DB ว่าง)

```sh
dcp build image-api web-app
RUN_SEED=true dcp run --rm image-api-migrate      # ครั้งเดียวเท่านั้น บน DB ว่าง: สร้างโครงสร้าง + role + ข้อมูลหลัก + บัญชีเริ่มต้น
dcp up -d
dcp ps                                            # ทุกตัว Up, image-api (healthy)
```

`RUN_SEED=true` ใส่เป็นตัวแปรของคำสั่งนี้คำสั่งเดียว ห้ามเขียนลง `.env.production` (seed ซ้ำจะเขียนทับสิทธิ์ role และชื่อข้อมูลหลัก)

## ขั้น 5 นำเข้าการตั้งค่าจาก Dev (ไม่ใช้: ผู้ใช้ตัดสินใจ 2026-11-14 ให้ตั้งค่าเองบน Production)

เก็บไว้เผื่ออนาคต ถ้าจะใช้ต้องให้ผู้ใช้อนุมัติก่อน

```sh
docker cp cctv-config-<วันที่>.json cctv-api:/tmp/cctv-config.json
docker exec -w /app cctv-api tsx prisma/config-transfer.ts import /tmp/cctv-config.json          # dry run: อ่านรายงานก่อน
docker exec -w /app cctv-api tsx prisma/config-transfer.ts import /tmp/cctv-config.json --apply  # เขียนจริง (ทั้งหมดหรือไม่เลย)
dcp restart image-api
```

- ย้าย: สถานที่/โซน, นโยบายการจัดเก็บ, ข้อมูลหลัก, role (สิทธิ์ ขอบเขตกล้อง โควตาภาพสด), ค่าตั้งระบบ, กฎแจ้งเตือน,
  เครื่องบันทึก + กล้อง (ชื่อ ตัวย่อ ที่ตั้ง ประเภท/ยี่ห้อ/รุ่น กล้องอ่อนไหว รอบรีเฟรช), กลุ่มกล้อง
- ไม่ย้าย: **รหัสผ่านเครื่องบันทึก** (เข้ารหัสด้วยกุญแจของ Dev), ผู้ใช้, ชุดมุมมองภาพสด, ประวัติทั้งหมด (แจ้งเตือน Incident ใบงาน audit), สถานะ runtime, กล้องในถังขยะ
- ไม่ย้ายค่าตั้งเฉพาะเครื่อง: `public_base_url`, `device_ntp_server`, `webhook_secret`, `webhook_url`, `system_version`
- นำเข้าได้เฉพาะเครื่องที่ยังไม่มีเครื่องบันทึก/กล้อง ถ้ามีแล้วจะปฏิเสธ
- กล้องที่ไม่ได้อยู่ใต้เครื่องบันทึกรายงานจะแยกให้เห็น รอบแรกใช้ `--skip-camera=IT-SERVER-001` ทั้ง dry run และ `--apply` (ผู้ใช้จะเพิ่มกล้องนี้เองบน Production)

## ขั้น 6 ตั้งค่าในหน้าเว็บ

1. เข้าด้วย admin แล้ว **เปลี่ยนรหัสของ admin, operator, viewer ทันที** (หรือปิดบัญชีที่ไม่ใช้)
2. ผู้ใช้เพิ่มสถานที่/โซน เครื่องบันทึก กล้อง กลุ่ม และ role เอง (ไม่นำเข้าจาก Dev)
   ใช้รหัสใหม่สำหรับเครื่องบันทึกที่เคยมีรหัสถูกแปะในแชท (เปลี่ยนที่ตัวเครื่องบันทึกก่อน โดยผู้ใช้)
3. สร้างบัญชีผู้ใช้จริงและกำหนด role/ขอบเขตกล้อง
4. ตั้งค่าระบบ: `public_base_url` = ที่อยู่เว็บจริง, NTP server ของเครื่องบันทึก = `NTP_BIND`
5. ตั้ง Telegram bot/chat **ของระบบนี้** (ไม่ใช่ของ Image Service เดิม)
6. ติ๊กกล้องอ่อนไหวที่ยังไม่ได้ติ๊ก

## ขั้น 7 ตรวจหลัง deploy

```sh
SMOKE_USER=<admin> SMOKE_PASSWORD='<รหัส>' node scripts/prod-smoke.mjs https://127.0.0.1:${WEB_HTTPS_PORT:-8443}
```

ต้องได้ `all passed` WARN ที่ยอมรับได้ชั่วคราว: เครื่องบันทึกที่ยังไม่ใส่รหัส, ยังไม่ครบรอบตรวจสุขภาพรอบแรก
(ถ้าไม่มี node บน host: `docker run --rm --network host -e SMOKE_USER -e SMOKE_PASSWORD -v $PWD/scripts:/s:ro node:22-alpine node /s/prod-smoke.mjs ...`)
จากนั้นเปิดหน้าเว็บจาก PC ในสำนักงาน: ภาพสด 4 จอ, เล่นย้อนหลัง, แผงสุขภาพเครื่องบันทึก, หน้าส่งมอบต้องเขียนว่า production

## ขั้น 8 สำรองข้อมูล

ที่ทำจริงบน 192.168.30.244 (2026-11-14):

- **สำรองหลัก = cron บน host** สั่ง `pg_dump -Fc` ทุกวัน 02:30 ลง HDD `/srv/cctv-data/backup` เก็บ 14 วัน
  (ไม่ได้อาศัย volume `backup-data`: ตัวสำรองในแอป 03:00 เขียนลง volume นั้นบน SSD ระบบ ใช้เป็นสำเนาที่สองได้ แต่ไม่ต้องคัดลอกออก)
- สำรองด้วยมือก่อนทุก deploy ลงที่เดียวกัน:
  ```sh
  docker exec cctv-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > /srv/cctv-data/backup/cctv-$(date +%F-%H%M)-before-<เวอร์ชัน>.dump
  ```
- **ยังไม่มีสำเนานอกเครื่อง** (รอผู้ใช้เลือกปลายทาง) ถ้าเครื่องเสียทั้งเครื่อง backup บน HDD เดียวกันหายด้วย
- เก็บ `.env.production` ไว้ในตู้รหัสผ่าน: backup ถอดรหัสผ่านเครื่องบันทึกไม่ได้ถ้าไม่มี `ENCRYPTION_KEY` ตัวเดิม

### ทดสอบ restore (อย่างน้อยหลังติดตั้ง และทุกครั้งที่เปลี่ยน ENCRYPTION_KEY)

กู้ลง DB ทดลองแยก ไม่แตะ `cctv-postgres` จริง แล้วตรวจ 2 อย่าง: จำนวนแถว และ **ค่าที่เข้ารหัสยังถอดได้ด้วยกุญแจของเครื่องนี้**

```sh
F=/srv/cctv-data/backup/<ไฟล์ล่าสุด>.dump
docker network create --internal --subnet 10.250.99.0/24 cctv-restore-test          # 10.x เสมอ ห้ามให้ Docker เลือกเอง
docker run -d --name cctv-restore-db --network cctv-restore-test -e POSTGRES_PASSWORD=restore-test -e POSTGRES_DB=restore postgres:15-alpine
sleep 5; docker exec -i cctv-restore-db pg_restore -U postgres -d restore --no-owner < "$F"
# 1) นับแถวตารางหลักเทียบกับ DB จริง (devices, cameras, users, recording_clips, ...)
# 2) ค่าที่เข้ารหัส: ใช้ image เวอร์ชันที่รันอยู่ + ENCRYPTION_KEY ของเครื่องนี้ ไม่พิมพ์ค่าหรือกุญแจออกมา
docker run --rm --network cctv-restore-test --env-file .env.production \
  -e DATABASE_URL=postgresql://postgres:restore-test@cctv-restore-db:5432/restore \
  --entrypoint node cctv-api:<เวอร์ชัน> dist/scripts/verify-secrets.js
docker rm -f cctv-restore-db && docker network rm cctv-restore-test
```

`verify-secrets` ตอบ exit 0 = รหัสผ่านเครื่องบันทึก, RTSP URL ที่มีรหัส และค่าลับของระบบถอดได้ครบ;
exit 1 = มีรายการที่ถอดไม่ได้ (บอกชื่อเครื่อง/กล้อง) แปลว่ากุญแจไม่ตรงกับ backup นี้ ให้หยุดและหากุญแจที่ถูกก่อน

## ขั้น 9 อัปเดตรอบถัดไป

```sh
docker exec cctv-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > ~/cctv-backup/cctv-$(date +%F-%H%M).dump
git fetch --tags && git checkout v<ใหม่>
nano .env.production                      # CCTV_VERSION=<ใหม่>
sh scripts/prod-preflight.sh .env.production
dcp build image-api web-app
dcp run --rm image-api-migrate            # ไม่มี RUN_SEED; ไม่มี ALLOW_DATA_LOSS
dcp up -d
node scripts/prod-smoke.mjs ...
```

ถ้า migrate บอกว่าจะลบข้อมูล (db push ปฏิเสธ) **หยุด** แล้วแจ้ง Dev ห้ามแก้ด้วย `ALLOW_DATA_LOSS=true`

## ขั้น 10 ย้อนกลับ

image ของรุ่นก่อนยังอยู่ในเครื่อง (`cctv-api:<เดิม>`, `cctv-web-app:<เดิม>`):

```sh
git checkout v<เดิม>
nano .env.production                      # CCTV_VERSION=<เดิม>
dcp up -d image-api web-app
```

ถ้ารุ่นใหม่เปลี่ยนโครงสร้าง DB ไปแล้วและรุ่นเดิมใช้ไม่ได้: หยุด image-api แล้ว `pg_restore --clean` จากไฟล์ที่สำรองก่อน deploy (ต้องให้ผู้ใช้อนุมัติ เพราะข้อมูลหลังเวลาสำรองจะหาย)

## ขั้น 11 Cutover (ผู้ใช้อนุมัติและกดเอง)

1. Production ผ่านขั้น 7 และใช้คู่ขนานกับ Dev จนผู้ใช้พอใจ
2. ย้าย NTP ของเครื่องบันทึกจาก 192.168.30.77 (Dev) ไป `NTP_BIND` ของ Production: ปุ่ม "ตั้ง NTP หลายเครื่อง" ผู้ใช้เป็นคนกด
   (เป็นการเขียนค่าเครื่องบันทึกอย่างเดียวที่อนุญาต)
3. แจ้งผู้ใช้ทุกคนให้ใช้ที่อยู่ใหม่ แล้วปิดการใช้งานบนเครื่อง Dev (Dev กลับไปเป็นเครื่องทดลอง)
4. บันทึกผลลง `docs/ops/AGENT_CHANNEL.md`
