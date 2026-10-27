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
      name: 'การจัดเก็บเริ่มต้น (Default)',
      description: 'Standard retention policy for production cameras',
      rawRetentionDays: 7,
      processedRetentionDays: 90,
      thumbnailRetentionDays: 365,
      archiveEnabled: false,
      coldStorageClass: 'cold',
      isDefault: true,
    },
  });
  console.log(`  Default retention policy: ${defaultPolicy.name}`);

  const longTermPolicy = await prisma.retentionPolicy.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'การจัดเก็บระยะยาว (Long-Term)',
      description: 'Extended retention for quality inspection cameras',
      rawRetentionDays: 30,
      processedRetentionDays: 365,
      thumbnailRetentionDays: 730,
      archiveEnabled: true,
      archiveRawDays: 25,
      coldStorageClass: 'cold',
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
      acceptedExtensions: ['tif', 'tiff', 'ptif', 'ptiff'],
      convertToPng: true,
      keepSmaller: true,
      generateThumbnail: true,
      thumbnailSize: 512,
      compressionQuality: 85,
      pollIntervalSeconds: 30,
      captureMode: 'periodic',
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

  // Seed Masterdata: camera_type, image_category, defect_type, inspection_type
  console.log('Seeding masterdata (base types)...');
  const baseTypes = [
    // camera_type
    { type: 'camera_type', code: 'line_scan', nameTh: 'กล้อง Line Scan', nameEn: 'Line Scan Camera', nameCn: '线扫描相机', nameMm: 'Line Scan ကင်မရာ', nameJp: 'ラインスキャンカメラ', sortOrder: 1 },
    { type: 'camera_type', code: 'area_scan', nameTh: 'กล้อง Area Scan', nameEn: 'Area Scan Camera', nameCn: '面扫描相机', nameMm: 'Area Scan ကင်မရာ', nameJp: 'エリアスキャンカメラ', sortOrder: 2 },
    { type: 'camera_type', code: 'ccd', nameTh: 'กล้อง CCD', nameEn: 'CCD Camera', nameCn: 'CCD相机', nameMm: 'CCD ကင်မရာ', nameJp: 'CCDカメラ', sortOrder: 3 },
    { type: 'camera_type', code: 'cmos', nameTh: 'กล้อง CMOS', nameEn: 'CMOS Camera', nameCn: 'CMOS相机', nameMm: 'CMOS ကင်မရာ', nameJp: 'CMOSカメラ', sortOrder: 4 },
    { type: 'camera_type', code: 'infrared', nameTh: 'กล้องอินฟราเรด', nameEn: 'Infrared Camera', nameCn: '红外相机', nameMm: 'အနီအောက်ရောင်ခြည်ကင်မရာ', nameJp: '赤外線カメラ', sortOrder: 5 },
    { type: 'camera_type', code: '3d_camera', nameTh: 'กล้อง 3D', nameEn: '3D Camera', nameCn: '3D相机', nameMm: '3D ကင်မရာ', nameJp: '3Dカメラ', sortOrder: 6 },
    { type: 'camera_type', code: 'ip_camera', nameTh: 'กล้อง IP', nameEn: 'IP Camera', nameCn: 'IP摄像机', nameMm: 'IP ကင်မရာ', nameJp: 'IPカメラ', sortOrder: 7 },
    { type: 'camera_type', code: 'other', nameTh: 'อื่นๆ', nameEn: 'Other', nameCn: '其他', nameMm: 'အခြား', nameJp: 'その他', sortOrder: 99 },
    // camera_status
    { type: 'camera_status', code: 'active', nameTh: 'ทำงาน', nameEn: 'Active', nameCn: '运行中', nameMm: 'အသက်ဝင်', nameJp: 'アクティブ', sortOrder: 1 },
    { type: 'camera_status', code: 'inactive', nameTh: 'ไม่ทำงาน', nameEn: 'Inactive', nameCn: '未运行', nameMm: 'မလုပ်ဆောင်', nameJp: '非アクティブ', sortOrder: 2 },
    { type: 'camera_status', code: 'maintenance', nameTh: 'ซ่อมบำรุง', nameEn: 'Maintenance', nameCn: '维护中', nameMm: 'ပြုပြင်ထိန်းသိမ်း', nameJp: 'メンテナンス', sortOrder: 3 },
    { type: 'camera_status', code: 'error', nameTh: 'ข้อผิดพลาด', nameEn: 'Error', nameCn: '错误', nameMm: 'အမှား', nameJp: 'エラー', sortOrder: 4 },
    // capture_mode
    { type: 'capture_mode', code: 'periodic', nameTh: 'ตามระยะเวลา', nameEn: 'Periodic', nameCn: '定时', nameMm: 'အချိန်ကာလအလိုက်', nameJp: '定期', sortOrder: 1 },
    { type: 'capture_mode', code: 'on_demand', nameTh: 'ตามคำสั่ง', nameEn: 'On Demand', nameCn: '按需', nameMm: 'လိုအပ်သလို', nameJp: 'オンデマンド', sortOrder: 2 },
    { type: 'capture_mode', code: 'continuous', nameTh: 'ต่อเนื่อง', nameEn: 'Continuous', nameCn: '连续', nameMm: 'ဆက်တိုက်', nameJp: '連続', sortOrder: 3 },
    // image_category
    { type: 'image_category', code: 'quality_inspection', nameTh: 'ตรวจสอบคุณภาพ', nameEn: 'Quality Inspection', nameCn: '质量检查', nameMm: 'အရည်အသွေးစစ်ဆေးခြင်း', nameJp: '品質検査', sortOrder: 1 },
    { type: 'image_category', code: 'label_verification', nameTh: 'ตรวจสอบฉลาก', nameEn: 'Label Verification', nameCn: '标签验证', nameMm: 'တံဆိပ်စစ်ဆေးခြင်း', nameJp: 'ラベル検証', sortOrder: 2 },
    { type: 'image_category', code: 'packaging', nameTh: 'บรรจุภัณฑ์', nameEn: 'Packaging', nameCn: '包装', nameMm: 'ထုပ်ပိုးခြင်း', nameJp: 'パッケージング', sortOrder: 3 },
    { type: 'image_category', code: 'dimension_check', nameTh: 'ตรวจสอบขนาด', nameEn: 'Dimension Check', nameCn: '尺寸检查', nameMm: 'အတိုင်းအတာစစ်ဆေးခြင်း', nameJp: '寸法検査', sortOrder: 4 },
    { type: 'image_category', code: 'surface_inspection', nameTh: 'ตรวจสอบพื้นผิว', nameEn: 'Surface Inspection', nameCn: '表面检查', nameMm: 'မျက်နှာပြင်စစ်ဆေးခြင်း', nameJp: '表面検査', sortOrder: 5 },
    { type: 'image_category', code: 'color_check', nameTh: 'ตรวจสอบสี', nameEn: 'Color Check', nameCn: '颜色检查', nameMm: 'အရောင်စစ်ဆေးခြင်း', nameJp: '色検査', sortOrder: 6 },
    { type: 'image_category', code: 'barcode_ocr', nameTh: 'บาร์โค้ด/OCR', nameEn: 'Barcode/OCR', nameCn: '条码/OCR', nameMm: 'ဘားကုဒ်/OCR', nameJp: 'バーコード/OCR', sortOrder: 7 },
    { type: 'image_category', code: 'other', nameTh: 'อื่นๆ', nameEn: 'Other', nameCn: '其他', nameMm: 'အခြား', nameJp: 'その他', sortOrder: 99 },
    // defect_type
    { type: 'defect_type', code: 'scratch', nameTh: 'รอยขีดข่วน', nameEn: 'Scratch', nameCn: '划痕', nameMm: 'ခြစ်ရာ', nameJp: '傷', sortOrder: 1 },
    { type: 'defect_type', code: 'dent', nameTh: 'รอยบุบ', nameEn: 'Dent', nameCn: '凹痕', nameMm: 'ချိုင့်ဝင်ရာ', nameJp: 'へこみ', sortOrder: 2 },
    { type: 'defect_type', code: 'stain', nameTh: 'คราบสกปรก', nameEn: 'Stain', nameCn: '污渍', nameMm: 'အညစ်အကြေး', nameJp: '汚れ', sortOrder: 3 },
    { type: 'defect_type', code: 'misalignment', nameTh: 'เยื้องศูนย์', nameEn: 'Misalignment', nameCn: '错位', nameMm: 'ချိန်ညှိမှုလွဲ', nameJp: '位置ずれ', sortOrder: 4 },
    { type: 'defect_type', code: 'crack', nameTh: 'รอยแตก', nameEn: 'Crack', nameCn: '裂纹', nameMm: 'အက်ကွဲခြင်း', nameJp: 'ひび割れ', sortOrder: 5 },
    { type: 'defect_type', code: 'color_deviation', nameTh: 'สีเพี้ยน', nameEn: 'Color Deviation', nameCn: '色差', nameMm: 'အရောင်လွဲခြင်း', nameJp: '色ずれ', sortOrder: 6 },
    { type: 'defect_type', code: 'missing_part', nameTh: 'ชิ้นส่วนขาด', nameEn: 'Missing Part', nameCn: '缺件', nameMm: 'အစိတ်အပိုင်းပျောက်', nameJp: '部品欠落', sortOrder: 7 },
    { type: 'defect_type', code: 'deformation', nameTh: 'ผิดรูป', nameEn: 'Deformation', nameCn: '变形', nameMm: 'ပုံသဏ္ဍာန်ပျက်', nameJp: '変形', sortOrder: 8 },
    { type: 'defect_type', code: 'other', nameTh: 'อื่นๆ', nameEn: 'Other', nameCn: '其他', nameMm: 'အခြား', nameJp: 'その他', sortOrder: 99 },
    // inspection_type
    { type: 'inspection_type', code: 'incoming', nameTh: 'ตรวจรับวัตถุดิบ', nameEn: 'Incoming Inspection', nameCn: '来料检验', nameMm: 'ဝင်လာစစ်ဆေးခြင်း', nameJp: '受入検査', sortOrder: 1 },
    { type: 'inspection_type', code: 'in_process', nameTh: 'ตรวจระหว่างผลิต', nameEn: 'In-Process Inspection', nameCn: '过程检验', nameMm: 'လုပ်ငန်းစဉ်စစ်ဆေးခြင်း', nameJp: '工程内検査', sortOrder: 2 },
    { type: 'inspection_type', code: 'final', nameTh: 'ตรวจขั้นสุดท้าย', nameEn: 'Final Inspection', nameCn: '最终检验', nameMm: 'နောက်ဆုံးစစ်ဆေးခြင်း', nameJp: '最終検査', sortOrder: 3 },
    { type: 'inspection_type', code: 'outgoing', nameTh: 'ตรวจก่อนส่งมอบ', nameEn: 'Outgoing Inspection', nameCn: '出货检验', nameMm: 'ထွက်ခွာစစ်ဆေးခြင်း', nameJp: '出荷検査', sortOrder: 4 },
    { type: 'inspection_type', code: 'periodic', nameTh: 'ตรวจตามรอบ', nameEn: 'Periodic Inspection', nameCn: '定期检验', nameMm: 'အချိန်ကာလအလိုက်စစ်ဆေးခြင်း', nameJp: '定期検査', sortOrder: 5 },
    { type: 'inspection_type', code: 'special', nameTh: 'ตรวจพิเศษ', nameEn: 'Special Inspection', nameCn: '特殊检验', nameMm: 'အထူးစစ်ဆေးခြင်း', nameJp: '特別検査', sortOrder: 6 },
    { type: 'inspection_type', code: 'other', nameTh: 'อื่นๆ', nameEn: 'Other', nameCn: '其他', nameMm: 'အခြား', nameJp: 'その他', sortOrder: 99 },
    // image_viewpoint (มุมมองภาพ) — angle the camera captures the part from
    { type: 'image_viewpoint', code: 'top', nameTh: 'บน', nameEn: 'Top', nameCn: '顶部', nameMm: 'အပေါ်', nameJp: '上', sortOrder: 1 },
    { type: 'image_viewpoint', code: 'side', nameTh: 'ข้าง', nameEn: 'Side', nameCn: '侧面', nameMm: 'ဘေး', nameJp: '横', sortOrder: 2 },
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
    { code: 'smb_unreachable', nameTh: 'SMB ไม่สามารถเข้าถึง', nameEn: 'SMB Unreachable', nameCn: 'SMB无法访问', nameMm: 'SMB ချိတ်ဆက်၍မရ', nameJp: 'SMB接続不可', sortOrder: 8 },
    { code: 'disk_full', nameTh: 'ดิสก์เต็ม', nameEn: 'Disk Full', nameCn: '磁盘已满', nameMm: 'ဒစ်ခ် ပြည့်နေသည်', nameJp: 'ディスク容量不足', sortOrder: 9 },
    { code: 'authentication_failed', nameTh: 'ยืนยันตัวตนล้มเหลว', nameEn: 'Authentication Failed', nameCn: '认证失败', nameMm: 'အထောက်အထားစိစစ်ခြင်း မအောင်မြင်', nameJp: '認証失敗', sortOrder: 10 },
    { code: 'worker_down', nameTh: 'Worker หยุดทำงาน', nameEn: 'Worker Down', nameCn: 'Worker停止工作', nameMm: 'Worker ရပ်တန့်သွားသည်', nameJp: 'Worker停止', sortOrder: 11 },
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
    { code: 'smb', nameTh: 'SMB/แชร์ไฟล์', nameEn: 'SMB/File Share', nameCn: 'SMB/文件共享', nameMm: 'SMB/ဖိုင်မျှဝေ', nameJp: 'SMB/ファイル共有', sortOrder: 5 },
    { code: 'worker', nameTh: 'Worker/ซอฟต์แวร์', nameEn: 'Worker/Software', nameCn: 'Worker/软件', nameMm: 'Worker/ဆော့ဖ်ဝဲ', nameJp: 'Worker/ソフトウェア', sortOrder: 6 },
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
