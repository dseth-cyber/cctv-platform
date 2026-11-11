import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  console.log('Seeding custom roles...');
  const roles = [
    {
      code: 'admin',
      nameTh: 'ผู้ดูแลระบบ',
      nameEn: 'Administrator',
      nameCn: '管理员',
      nameMm: 'အက်ဒမင်',
      nameJp: '管理者',
      description: 'Full system access',
      permissions: ['*'],
      sortOrder: 1,
    },
    {
      code: 'operator',
      nameTh: 'ผู้ปฏิบัติการ',
      nameEn: 'Operator',
      nameCn: '操作员',
      nameMm: 'အော်ပရေတာ',
      nameJp: 'オペレーター',
      description: 'Standard operational read/write access',
      permissions: [
        'overview:read',
        'cameras:read', 'cameras:create', 'cameras:update',
        'camera-template:read', 'camera-template:create', 'camera-template:update',
        'search:read', 'search:update',
        'processing:read', 'processing:create',
        'storage:read',
        'logs:read',
        'dead-letter:read', 'dead-letter:create',
        'retention:read', 'retention:create', 'retention:update',
        'alerts:read', 'alerts:update',
        'masterdata:read', 'masterdata:create', 'masterdata:update'
      ],
      sortOrder: 2,
    },
    {
      code: 'viewer',
      nameTh: 'ผู้เข้าชม',
      nameEn: 'Viewer',
      nameCn: '观察员',
      nameMm: 'ကြည့်ရှုသူ',
      nameJp: 'ビューアー',
      description: 'Read-only access',
      permissions: [
        'overview:read',
        'cameras:read',
        'camera-template:read',
        'search:read',
        'processing:read',
        'storage:read',
        'logs:read',
        'alerts:read',
        'masterdata:read'
      ],
      sortOrder: 3,
    },
  ];

  for (const r of roles) {
    const createdRole = await prisma.customRole.upsert({
      where: { code: r.code },
      update: {
        nameTh: r.nameTh,
        nameEn: r.nameEn,
        nameCn: r.nameCn,
        nameMm: r.nameMm,
        nameJp: r.nameJp,
        description: r.description,
        permissions: r.permissions,
        sortOrder: r.sortOrder,
      },
      create: r,
    });
    console.log(`  Role: ${createdRole.code} (${createdRole.nameEn})`);
  }

  const adminPassword = await bcrypt.hash('admin123', 10);
  const operatorPassword = await bcrypt.hash('operator123', 10);
  const viewerPassword = await bcrypt.hash('viewer123', 10);
  const forceReset = process.env.RESET_DEFAULT_CREDENTIALS === 'true';

  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: forceReset ? { role: 'admin', password: adminPassword, enabled: true } : { role: 'admin' },
    create: {
      username: 'admin',
      email: 'admin@image-service.local',
      password: adminPassword,
      role: 'admin',
      enabled: true,
    },
  });
  console.log(`  Admin user: ${adminUser.username}`);

  const operatorUser = await prisma.user.upsert({
    where: { username: 'operator' },
    update: forceReset ? { role: 'operator', password: operatorPassword, enabled: true } : { role: 'operator' },
    create: {
      username: 'operator',
      email: 'operator@image-service.local',
      password: operatorPassword,
      role: 'operator',
      enabled: true,
    },
  });
  console.log(`  Operator user: ${operatorUser.username}`);

  const viewerUser = await prisma.user.upsert({
    where: { username: 'viewer' },
    update: forceReset ? { role: 'viewer', password: viewerPassword, enabled: true } : { role: 'viewer' },
    create: {
      username: 'viewer',
      email: 'viewer@image-service.local',
      password: viewerPassword,
      role: 'viewer',
      enabled: true,
    },
  });
  console.log(`  Viewer user: ${viewerUser.username}`);

  const defaultPolicy = await prisma.retentionPolicy.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {
      isDefault: true,
    },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'มาตรฐาน',
      description: 'ใช้กับกล้องที่ให้ Server บันทึกเอง (ไม่ใช่ภาพใน HDD ของ DVR/NVR): ไฟล์ที่เก่ากว่าจำนวนวันที่ตั้งจะย้ายไปที่พักไฟล์ 7 วันแล้วลบถาวร ไฟล์ที่ติด Legal Hold ไม่ถูกลบ',
      isDefault: true,
    },
  });
  console.log(`  Default retention policy: ${defaultPolicy.name}`);

  const longTermPolicy = await prisma.retentionPolicy.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'เก็บนาน',
      description: 'สำหรับกล้องที่ต้องเก็บหลักฐานนานกว่าปกติ เช่น ประตูเข้า-ออก จุดรับเงิน (ใช้เมื่อให้ Server บันทึกกล้องนั้นเอง)',
      recordingRetentionDays: 90,
    },
  });
  console.log(`  Long-term retention policy: ${longTermPolicy.name}`);

  const defaultTemplate = await prisma.cameraTemplate.upsert({
    where: { id: '00000000-0000-0000-0000-000000000050' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000050',
      name: 'Default Template',
      description: 'Default ingestion preset (TIFF -> PNG, keep smaller, generate thumbnail)',
      retentionPolicyId: '00000000-0000-0000-0000-000000000001',
      isDefault: true,
      sortOrder: 0,
      isActive: true,
    },
  });
  console.log(`  Default camera template: ${defaultTemplate.name}`);

  const alertRule = await prisma.alertRule.upsert({
    where: { id: '00000000-0000-0000-0000-000000000003' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'Camera Offline Alert',
      alertType: 'camera_offline',
      description: 'Triggered when a camera has not polled for 5 minutes',
      enabled: true,
      condition: {
        metric: 'seconds_since_last_poll',
        operator: '>',
        value: 300,
        duration_minutes: 5,
      },
      cooldownMinutes: 60,
      // Must be a plain array of channel-name strings (matches the Incident Escalation
      // rule below) — notifyChannels() switches on each entry directly ('telegram' |
      // 'line'), so an object like { type: 'log' } never matches any case and silently
      // no-ops forever (found 2026-08-07: this rule had never actually notified anyone).
      notificationChannels: ['telegram'],
    },
  });
  console.log(`  Alert rule: ${alertRule.name}`);

  const escalationRule = await prisma.alertRule.upsert({
    where: { id: '00000000-0000-0000-0000-000000000004' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000004',
      name: 'Incident Escalation Alert',
      alertType: 'incident_escalation',
      description: 'Triggered when an open auto-created incident escalates priority (e.g. still unassigned, or reaches Critical)',
      enabled: true,
      condition: { metric: 'incident_priority_escalation' },
      cooldownMinutes: 30,
      notificationChannels: ['telegram'],
    },
  });
  console.log(`  Alert rule: ${escalationRule.name}`);

  const authAnomalyRule = await prisma.alertRule.upsert({
    where: { id: '00000000-0000-0000-0000-000000000005' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000005',
      name: 'Suspicious Login Activity Alert',
      alertType: 'auth_anomaly',
      description: 'Triggered when a username hits the failed-login threshold and gets temporarily locked (see login_max_failed_attempts/login_failure_window_minutes/login_lockout_minutes in System Settings)',
      enabled: true,
      condition: { metric: 'failed_login_lockout' },
      cooldownMinutes: 30,
      notificationChannels: ['telegram'],
    },
  });
  console.log(`  Alert rule: ${authAnomalyRule.name}`);

  const noNewImagesRule = await prisma.alertRule.upsert({
    where: { id: '00000000-0000-0000-0000-000000000006' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000006',
      name: 'Camera No New Images Alert',
      alertType: 'camera_no_new_images',
      description: 'Triggered when a camera is still reachable but has stopped producing new images — the gap that let the 2026-08-20 TP27 stoppage go unnoticed for 23h (see camera_no_new_images_* in System Settings)',
      enabled: true,
      condition: { metric: 'minutes_since_last_image' },
      // The monitor already paces its own reminders (camera_no_new_images_repeat_hours),
      // so this only needs to be short enough not to swallow them.
      cooldownMinutes: 30,
      notificationChannels: ['telegram'],
    },
  });
  console.log(`  Alert rule: ${noNewImagesRule.name}`);

  // Storage pressure had no rule at all until 2026-08-22 — provider-metric-collector.ts and
  // storage-pressure-monitor.ts had been faithfully writing "Storage warning: SeaweedFS
  // Storage (78.5%)" alerts into the DB roughly hourly, and every one of them stopped dead
  // at notifyChannels() because no enabled rule matched the type. Visible in the app,
  // invisible in Telegram.
  const storageWarningRule = await prisma.alertRule.upsert({
    where: { id: '00000000-0000-0000-0000-000000000007' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000007',
      name: 'Storage Warning Alert',
      alertType: 'storage_warning',
      description: 'Triggered when a storage provider passes its warning threshold (alert_warning_threshold in System Settings, or the provider\'s own pressureWarningPercent)',
      enabled: true,
      condition: { metric: 'storage_usage_percent' },
      // Disk fills slowly — an hourly ping about the same 78% would just train people to
      // ignore the bot. Six hours is enough to keep it visible without becoming noise.
      cooldownMinutes: 360,
      notificationChannels: ['telegram'],
    },
  });
  console.log(`  Alert rule: ${storageWarningRule.name}`);

  const diskSpaceRule = await prisma.alertRule.upsert({
    where: { id: '00000000-0000-0000-0000-000000000008' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000008',
      name: 'Storage Critical / Disk Space Alert',
      alertType: 'disk_space',
      description: 'Triggered when a storage provider passes its critical or emergency threshold — the escalation of the warning rule above',
      enabled: true,
      condition: { metric: 'storage_usage_percent' },
      // Deliberately tighter than the warning rule: at this point writes are close to failing.
      cooldownMinutes: 60,
      notificationChannels: ['telegram'],
    },
  });
  console.log(`  Alert rule: ${diskSpaceRule.name}`);

  const ingestBufferRule = await prisma.alertRule.upsert({
    where: { id: '00000000-0000-0000-0000-000000000009' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000009',
      name: 'Ingest Buffer Low Alert',
      alertType: 'ingest_lag',
      description: 'Triggered when a camera keeps too few days of images on its own disk before overwriting them — see ingest_buffer_warn_days in System Settings. Anything not fetched inside that window is lost permanently.',
      enabled: true,
      condition: { metric: 'source_buffer_days' },
      cooldownMinutes: 360,
      notificationChannels: ['telegram'],
    },
  });
  console.log(`  Alert rule: ${ingestBufferRule.name}`);

  // Recorder health (device health round): recording stopped and HDD problems go to Telegram. Added 2026-11-09;
  // created only where no rule of the type exists, so a database that already has one is left as it is.
  for (const rule of [
    {
      name: 'Recording Stopped Alert',
      alertType: 'recording_stopped' as const,
      description: 'Triggered when a DVR/NVR channel set to record all the time has no recording in the last 30 minutes, or the recorder holds no recording at all (device health round, device_health_check_minutes). Closes by itself when recording resumes.',
    },
    {
      name: 'Recorder HDD Problem Alert',
      alertType: 'hdd_problem' as const,
      description: 'Triggered when a DVR/NVR reports no disk, a disk fault, a SMART warning or a disk at 60 C or more (device health round). Closes by itself when the disks are well again.',
    },
  ]) {
    const has = await prisma.alertRule.findFirst({ where: { alertType: rule.alertType } });
    if (!has) {
      await prisma.alertRule.create({ data: { ...rule, enabled: true, condition: { metric: 'device_health_round' }, cooldownMinutes: 60, notificationChannels: ['telegram'] } });
    }
    console.log(`  Alert rule: ${rule.name}${has ? ' (exists)' : ''}`);
  }

  const storageProvider = await prisma.storageProvider.upsert({
    where: { id: '00000000-0000-0000-0000-000000000020' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000020',
      name: 'Primary Storage',
      type: 's3',
      config: {
        bucket: process.env.MINIO_BUCKET || 'image-service',
        endpoint: process.env.MINIO_ENDPOINT || 'minio',
        port: parseInt(process.env.MINIO_PORT || '9000', 10),
        useSSL: process.env.MINIO_USE_SSL === 'true',
        accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
        secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
      },
      isDefault: true,
      isActive: true,
      priority: 1,
      description: 'Primary S3-compatible storage (MinIO)',
    },
  });
  console.log(`  Storage provider: ${storageProvider.name} (${storageProvider.type})`);

  const seaweedProvider = await prisma.storageProvider.upsert({
    where: { id: '00000000-0000-0000-0000-000000000021' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000021',
      name: 'SeaweedFS Storage',
      type: 'seaweedfs',
      config: {
        bucket: process.env.SEAWEEDFS_BUCKET || 'image-service',
        endpoint: 'seaweedfs-filer',
        port: 8333,
        useSSL: false,
        accessKey: process.env.SEAWEEDFS_ACCESS_KEY || 'seaweedadmin',
        secretKey: process.env.SEAWEEDFS_SECRET_KEY || 'seaweedadmin',
      },
      isDefault: false,
      isActive: true,
      priority: 2,
      description: 'SeaweedFS distributed storage (S3-compatible)',
    },
  });
  console.log(`  Storage provider: ${seaweedProvider.name} (${seaweedProvider.type})`);

  const localProvider = await prisma.storageProvider.upsert({
    where: { id: '00000000-0000-0000-0000-000000000022' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000022',
      name: 'Local Disk Storage (Example)',
      type: 'local',
      config: {
        basePath: process.env.LOCAL_STORAGE_PATH || '/data/images',
      },
      isDefault: false,
      isActive: true,
      priority: 3,
      description: 'Example local filesystem storage — writes to a disk path inside the image-api container/host',
    },
  });
  console.log(`  Storage provider: ${localProvider.name} (${localProvider.type})`);

  const smbProvider = await prisma.storageProvider.upsert({
    where: { id: '00000000-0000-0000-0000-000000000023' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000023',
      name: 'SMB Share Storage (Example)',
      type: 'smb',
      config: {
        share: '//image-smb-server/share',
        domain: 'WORKGROUP',
        username: 'camera',
        password: 'smbpass',
      },
      isDefault: false,
      isActive: false,
      priority: 4,
      description: 'Example SMB/CIFS network share storage — edit with real server/share/credentials and mount the share before enabling',
    },
  });
  console.log(`  Storage provider: ${smbProvider.name} (${smbProvider.type})`);

  const nfsProvider = await prisma.storageProvider.upsert({
    where: { id: '00000000-0000-0000-0000-000000000024' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000024',
      name: 'NFS Export Storage (Example)',
      type: 'nfs',
      config: {
        server: 'nfs-server.local',
        exportPath: '/export/images',
        mountOptions: 'rw,sync',
      },
      isDefault: false,
      isActive: false,
      priority: 5,
      description: 'Example NFS export storage — edit with a real NFS server/export path and mount it before enabling',
    },
  });
  console.log(`  Storage provider: ${nfsProvider.name} (${nfsProvider.type})`);

  // The "Test Camera (SMB)" seed camera (fixed id ...0010) used to be upserted here on
  // every deploy — since upsert's create-branch fires whenever the row doesn't exist,
  // permanently deleting it in the UI just meant it came back on the next deploy that
  // ran this seed. Removed for good 2026-08-20 per explicit request; do not re-add.
  // The mock SMB server fixture (image-smb-server, docker-compose.yml) it pointed at is
  // untouched — it's harmless to leave running unused, and other cameras can still be
  // pointed at it manually if a test SMB target is ever needed again.

  // Seed Masterdata: camera_status
  console.log('Seeding masterdata (base types)...');
  const baseTypes = [
    // camera_status
    { type: 'camera_status', code: 'active', nameTh: 'ทำงาน', nameEn: 'Active', nameCn: '运行中', nameMm: 'အသက်ဝင်', nameJp: 'アクティブ', sortOrder: 1 },
    { type: 'camera_status', code: 'inactive', nameTh: 'ไม่ทำงาน', nameEn: 'Inactive', nameCn: '未运行', nameMm: 'မလုပ်ဆောင်', nameJp: '非アクティブ', sortOrder: 2 },
    { type: 'camera_status', code: 'maintenance', nameTh: 'ซ่อมบำรุง', nameEn: 'Maintenance', nameCn: '维护中', nameMm: 'ပြုပြင်ထိန်းသိမ်း', nameJp: 'メンテナンス', sortOrder: 3 },
    { type: 'camera_status', code: 'error', nameTh: 'ข้อผิดพลาด', nameEn: 'Error', nameCn: '错误', nameMm: 'အမှား', nameJp: 'エラー', sortOrder: 4 },
  ];

  for (const entry of baseTypes) {
    await prisma.masterdata.upsert({
      where: { type_code: { type: entry.type, code: entry.code } },
      update: { nameTh: entry.nameTh, nameEn: entry.nameEn, nameCn: entry.nameCn, nameMm: entry.nameMm, nameJp: entry.nameJp, sortOrder: entry.sortOrder },
      create: { ...entry, isActive: true },
    });
  }
  console.log(`  Base masterdata: ${baseTypes.length} entries seeded`);

  // Seed Masterdata: incident_reason
  console.log('Seeding masterdata (incident options)...');
  const incidentReasons = [
    { code: 'scheduled_maintenance', nameTh: 'ซ่อมบำรุงตามแผน', nameEn: 'Scheduled Maintenance', nameCn: '计划维护', nameMm: 'စီစဉ်ထားသော ပြုပြင်ထိန်းသိမ်းမှု', nameJp: '定期メンテナンス', sortOrder: 1 },
    { code: 'power_failure', nameTh: 'ไฟฟ้าขัดข้อง', nameEn: 'Power Failure', nameCn: '电源故障', nameMm: 'ပါဝါချို့ယွင်းခြင်း', nameJp: '電源障害', sortOrder: 2 },
    { code: 'network_issue', nameTh: 'ปัญหาเครือข่าย', nameEn: 'Network Issue', nameCn: '网络问题', nameMm: 'ကွန်ရက်ပြဿနာ', nameJp: 'ネットワーク障害', sortOrder: 3 },
    { code: 'lens_cleaning', nameTh: 'ทำความสะอาดเลนส์', nameEn: 'Lens Cleaning', nameCn: '镜头清洁', nameMm: 'မှန်ဘီလူး သန့်ရှင်းရေး', nameJp: 'レンズ清掃', sortOrder: 4 },
    { code: 'firmware_update', nameTh: 'อัปเดต Firmware', nameEn: 'Firmware Update', nameCn: '固件更新', nameMm: 'ဖမ်းဝဲ အပ်ဒိတ်', nameJp: 'ファームウェア更新', sortOrder: 5 },
    { code: 'cable_replacement', nameTh: 'เปลี่ยนสาย', nameEn: 'Cable Replacement', nameCn: '更换电缆', nameMm: 'ကေဘယ်လဲလှယ်ခြင်း', nameJp: 'ケーブル交換', sortOrder: 6 },
    { code: 'camera_malfunction', nameTh: 'กล้องชำรุด', nameEn: 'Camera Malfunction', nameCn: '相机故障', nameMm: 'ကင်မရာ ချို့ယွင်းခြင်း', nameJp: 'カメラ故障', sortOrder: 7 },
    { code: 'rtsp_unreachable', nameTh: 'สตรีม RTSP เชื่อมต่อไม่ได้', nameEn: 'RTSP Stream Unreachable', nameCn: 'RTSP流无法访问', nameMm: 'RTSP stream ချိတ်ဆက်၍မရ', nameJp: 'RTSPストリーム接続不可', sortOrder: 8 },
    { code: 'recorder_offline', nameTh: 'เครื่องบันทึกไม่ตอบ', nameEn: 'Recorder Not Responding', nameCn: '录像机无响应', nameMm: 'Recorder တုံ့ပြန်မှုမရှိ', nameJp: 'レコーダー応答なし', sortOrder: 8 },
    { code: 'disk_full', nameTh: 'ดิสก์เต็ม', nameEn: 'Disk Full', nameCn: '磁盘已满', nameMm: 'ဒစ်ခ် ပြည့်နေသည်', nameJp: 'ディスク容量不足', sortOrder: 9 },
    { code: 'authentication_failed', nameTh: 'ยืนยันตัวตนล้มเหลว', nameEn: 'Authentication Failed', nameCn: '认证失败', nameMm: 'အထောက်အထားစိစစ်ခြင်း မအောင်မြင်', nameJp: '認証失敗', sortOrder: 10 },
    { code: 'media_server_down', nameTh: 'Media Server หยุดทำงาน', nameEn: 'Media Server Down', nameCn: '媒体服务器停止', nameMm: 'Media Server ရပ်တန့်သွားသည်', nameJp: 'メディアサーバー停止', sortOrder: 11 },
    { code: 'human_error', nameTh: 'ความผิดพลาดของบุคคล', nameEn: 'Human Error', nameCn: '人为错误', nameMm: 'လူသားအမှား', nameJp: 'ヒューマンエラー', sortOrder: 12 },
    { code: 'other', nameTh: 'อื่นๆ', nameEn: 'Other', nameCn: '其他', nameMm: 'အခြား', nameJp: 'その他', sortOrder: 99 },
  ];

  for (const entry of incidentReasons) {
    await prisma.masterdata.upsert({
      where: { type_code: { type: 'incident_reason', code: entry.code } },
      update: { nameTh: entry.nameTh, nameEn: entry.nameEn, nameCn: entry.nameCn, nameMm: entry.nameMm, nameJp: entry.nameJp, sortOrder: entry.sortOrder, isActive: true },
      create: { type: 'incident_reason', ...entry, isActive: true },
    });
  }
  console.log(`  incident_reason: ${incidentReasons.length} entries`);

  // Seed Masterdata: incident_root_cause
  const incidentRootCauses = [
    { code: 'power', nameTh: 'ระบบไฟฟ้า', nameEn: 'Power System', nameCn: '电力系统', nameMm: 'ပါဝါစနစ်', nameJp: '電力システム', sortOrder: 1 },
    { code: 'network', nameTh: 'เครือข่าย', nameEn: 'Network', nameCn: '网络', nameMm: 'ကွန်ရက်', nameJp: 'ネットワーク', sortOrder: 2 },
    { code: 'camera_hardware', nameTh: 'ฮาร์ดแวร์กล้อง', nameEn: 'Camera Hardware', nameCn: '相机硬件', nameMm: 'ကင်မရာ ဟာ့ဒ်ဝဲ', nameJp: 'カメラハードウェア', sortOrder: 3 },
    { code: 'storage', nameTh: 'พื้นที่เก็บข้อมูล', nameEn: 'Storage', nameCn: '存储', nameMm: 'သိုလှောင်မှု', nameJp: 'ストレージ', sortOrder: 4 },
    { code: 'rtsp_stream', nameTh: 'สตรีม RTSP', nameEn: 'RTSP Stream', nameCn: 'RTSP流', nameMm: 'RTSP stream', nameJp: 'RTSPストリーム', sortOrder: 5 },
    { code: 'credentials', nameTh: 'รหัสผ่านกล้อง', nameEn: 'Camera Credentials', nameCn: '摄像机凭据', nameMm: 'ကင်မရာ စကားဝှက်', nameJp: 'カメラ認証情報', sortOrder: 5 },
    { code: 'software', nameTh: 'ซอฟต์แวร์/บริการ', nameEn: 'Software/Service', nameCn: '软件/服务', nameMm: 'ဆော့ဖ်ဝဲ/ဝန်ဆောင်မှု', nameJp: 'ソフトウェア/サービス', sortOrder: 6 },
    { code: 'human_error', nameTh: 'ความผิดพลาดของบุคคล', nameEn: 'Human Error', nameCn: '人为错误', nameMm: 'လူသားအမှား', nameJp: 'ヒューマンエラー', sortOrder: 7 },
    { code: 'environment', nameTh: 'สภาพแวดล้อม', nameEn: 'Environment', nameCn: '环境', nameMm: 'ပတ်ဝန်းကျင်', nameJp: '環境', sortOrder: 8 },
    { code: 'unknown', nameTh: 'ไม่ทราบ', nameEn: 'Unknown', nameCn: '未知', nameMm: 'မသိ', nameJp: '不明', sortOrder: 9 },
    { code: 'other', nameTh: 'อื่นๆ', nameEn: 'Other', nameCn: '其他', nameMm: 'အခြား', nameJp: 'その他', sortOrder: 99 },
  ];

  for (const entry of incidentRootCauses) {
    await prisma.masterdata.upsert({
      where: { type_code: { type: 'incident_root_cause', code: entry.code } },
      update: { nameTh: entry.nameTh, nameEn: entry.nameEn, nameCn: entry.nameCn, nameMm: entry.nameMm, nameJp: entry.nameJp, sortOrder: entry.sortOrder, isActive: true },
      create: { type: 'incident_root_cause', ...entry, isActive: true },
    });
  }
  console.log(`  incident_root_cause: ${incidentRootCauses.length} entries`);

  // Seed Masterdata: incident_resolution
  const incidentResolutions = [
    { code: 'completed', nameTh: 'ดำเนินการเสร็จสิ้น', nameEn: 'Completed', nameCn: '已完成', nameMm: 'ပြီးစီးပြီ', nameJp: '完了', sortOrder: 1 },
    { code: 'replaced_cable', nameTh: 'เปลี่ยนสาย', nameEn: 'Replaced Cable', nameCn: '更换电缆', nameMm: 'ကေဘယ်လဲလှယ်ပြီး', nameJp: 'ケーブル交換済', sortOrder: 2 },
    { code: 'restarted', nameTh: 'รีสตาร์ท', nameEn: 'Restarted', nameCn: '已重启', nameMm: 'ပြန်စတင်ပြီး', nameJp: '再起動済', sortOrder: 3 },
    { code: 'power_reset', nameTh: 'รีเซ็ตไฟ', nameEn: 'Power Reset', nameCn: '电源重置', nameMm: 'ပါဝါပြန်ချိန်ပြီး', nameJp: '電源リセット', sortOrder: 4 },
    { code: 'firmware_update', nameTh: 'อัปเดต Firmware', nameEn: 'Firmware Update', nameCn: '固件更新', nameMm: 'ဖမ်းဝဲ အပ်ဒိတ်', nameJp: 'ファームウェア更新', sortOrder: 5 },
    { code: 'cleaned_lens', nameTh: 'ทำความสะอาดเลนส์', nameEn: 'Cleaned Lens', nameCn: '清洁镜头', nameMm: 'မှန်ဘီလူး သန့်ရှင်းပြီး', nameJp: 'レンズ清掃済', sortOrder: 6 },
    { code: 'reconfigured', nameTh: 'ปรับค่าใหม่', nameEn: 'Reconfigured', nameCn: '重新配置', nameMm: 'ပြန်လည်ပြင်ဆင်ပြီး', nameJp: '再設定済', sortOrder: 7 },
    { code: 'replaced_hardware', nameTh: 'เปลี่ยนฮาร์ดแวร์', nameEn: 'Replaced Hardware', nameCn: '更换硬件', nameMm: 'ဟာ့ဒ်ဝဲ လဲလှယ်ပြီး', nameJp: 'ハードウェア交換済', sortOrder: 8 },
    { code: 'other', nameTh: 'อื่นๆ', nameEn: 'Other', nameCn: '其他', nameMm: 'အခြား', nameJp: 'その他', sortOrder: 99 },
  ];

  for (const entry of incidentResolutions) {
    await prisma.masterdata.upsert({
      where: { type_code: { type: 'incident_resolution', code: entry.code } },
      update: { nameTh: entry.nameTh, nameEn: entry.nameEn, nameCn: entry.nameCn, nameMm: entry.nameMm, nameJp: entry.nameJp, sortOrder: entry.sortOrder, isActive: true },
      create: { type: 'incident_resolution', ...entry, isActive: true },
    });
  }
  console.log(`  incident_resolution: ${incidentResolutions.length} entries`);

  console.log('\nDefault credentials:');
  console.log('  admin    / admin123   (full access)');
  console.log('  operator / operator123 (read + write)');
  console.log('  viewer   / viewer123   (read-only)');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
