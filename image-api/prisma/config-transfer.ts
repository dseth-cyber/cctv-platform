/**
 * Move the set-up (not the history) from one installation to another, e.g. Dev -> Production.
 *
 *   export:  npx tsx prisma/config-transfer.ts export <file.json>
 *   import:  npx tsx prisma/config-transfer.ts import <file.json>            (dry run: reports only)
 *            npx tsx prisma/config-transfer.ts import <file.json> --apply    (writes, in one transaction)
 *   options: --skip-camera=<name>[,<name>]  --skip-device=<name>[,<name>]
 *
 * What moves: sites, zones, retention policies, master data, roles (permissions, camera scope, live quota),
 * system settings (except the ones listed in SKIP_CONFIG), alert rules, recorders and their cameras
 * (names, codes, place, type/brand/model, sensitive flag, refresh seconds, recording mode, map position),
 * camera groups and their members.
 *
 * What does not move, on purpose:
 *  - recorder passwords: they are encrypted with the source's ENCRYPTION_KEY and cannot be read by the target.
 *    Every recorder arrives without a password; enter it on the target (Devices > edit). The report lists them.
 *  - users and their sessions, live views, favourites: people sign in fresh on the target.
 *  - history: alerts, incidents, work orders, audit log, events, daily summaries, recordings, clips.
 *  - runtime state: health results, online/offline status, outage marks, stream state.
 *  - cameras in the trash.
 *
 * The import only runs on a target that has no recorders and no cameras yet (a fresh install, after the first
 * migrate with RUN_SEED=true). Ids are kept, so camera-scope rules on roles still point at the right places.
 */
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';

const prisma = new PrismaClient();
const FORMAT = 'cctv-config-transfer';
const VERSION = 1;

// Settings that belong to one installation: its own address, NTP server, secrets and version.
// camera_scope_ready stays behind: on the target it must still run once, to give the seeded users their scope.
// live_permissions_ready moves with the roles: they already carry the live rights, so the target must not add
// them again to a role that had them taken away.
const SKIP_CONFIG = new Set([
  'public_base_url', 'device_ntp_server', 'webhook_secret', 'webhook_url', 'system_version', 'camera_scope_ready', 'storage_local_ready',
]);

const DEVICE_FIELDS = [
  'id', 'name', 'shortCode', 'alertLevel', 'snapshotRefreshSeconds', 'description', 'deviceType', 'brand', 'model',
  'serialNumber', 'macAddress', 'firmwareVersion', 'healthNotesAck', 'ipAddress', 'rtspPort', 'httpPort', 'onvifPort',
  'username', 'totalChannels', 'status', 'enabled', 'siteId', 'zoneId',
] as const;
const CAMERA_FIELDS = [
  'id', 'name', 'description', 'ipAddress', 'status', 'timezone', 'metadata', 'retentionPolicyId', 'enabled', 'deviceId',
  'channelNumber', 'rtspUrl', 'rtspUrlSub', 'streamProfile', 'streamPath', 'cameraType', 'cameraBrand', 'cameraModel',
  'shortCode', 'alertLevel', 'sensitive', 'snapshotRefreshSeconds', 'spec', 'recordingMode', 'siteId', 'zoneId',
  'locationFromDevice', 'latitude', 'longitude', 'onvifProfileToken', 'slaTargetPercent', 'createdBy',
] as const;

type Row = Record<string, unknown>;
const pick = (row: Row, fields: readonly string[]): Row => Object.fromEntries(fields.map((f) => [f, row[f] ?? null]));
const strip = (row: Row): Row => { const { createdAt: _c, updatedAt: _u, ...rest } = row; return rest; };
const listArg = (name: string) => (process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

async function exportTo(file: string) {
  const [sites, zones, retentionPolicies, masterdata, roles, systemConfigs, alertRules, devices, cameras, groups] = await Promise.all([
    prisma.site.findMany({ orderBy: { name: 'asc' } }),
    prisma.zone.findMany({ orderBy: { name: 'asc' } }),
    prisma.retentionPolicy.findMany(),
    prisma.masterdata.findMany({ orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }] }),
    prisma.customRole.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.systemConfig.findMany({ orderBy: { key: 'asc' } }),
    prisma.alertRule.findMany(),
    prisma.device.findMany({ orderBy: { name: 'asc' } }),
    prisma.camera.findMany({ where: { deletedAt: null }, orderBy: [{ deviceId: 'asc' }, { channelNumber: 'asc' }] }),
    prisma.cameraGroup.findMany({ include: { members: { select: { cameraId: true } } } }),
  ]);
  const out = {
    format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), sourceEnv: process.env.DEPLOY_ENV ?? 'dev',
    sites: sites.map(strip), zones: zones.map(strip), retentionPolicies: retentionPolicies.map(strip),
    masterdata: masterdata.map((m) => { const { id: _id, ...r } = strip(m as Row); return r; }),
    roles: roles.map((r) => { const { id: _id, ...rest } = strip(r as Row); return rest; }),
    systemConfigs: systemConfigs.filter((c) => !SKIP_CONFIG.has(c.key)).map(strip),
    alertRules: alertRules.map(strip),
    devices: devices.map((d) => pick(d as Row, DEVICE_FIELDS)),
    cameras: cameras.map((c) => pick(c as Row, CAMERA_FIELDS)),
    cameraGroups: groups.map((g) => ({ id: g.id, name: g.name, description: g.description, snapshotRefreshSeconds: g.snapshotRefreshSeconds, cameraIds: g.members.map((m) => m.cameraId) })),
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`exported to ${file}: ${out.devices.length} recorders, ${out.cameras.length} cameras, ${out.sites.length} sites, ${out.zones.length} zones, ` +
    `${out.cameraGroups.length} groups, ${out.roles.length} roles, ${out.masterdata.length} master data, ${out.systemConfigs.length} settings, ${out.alertRules.length} alert rules`);
  console.log('recorder passwords are not in the file; enter them again on the target.');
}

async function importFrom(file: string, apply: boolean) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.format !== FORMAT || data.version !== VERSION) throw new Error(`${file} is not a ${FORMAT} v${VERSION} file`);

  const [deviceCount, cameraCount] = await Promise.all([prisma.device.count(), prisma.camera.count()]);
  if (deviceCount > 0 || cameraCount > 0) {
    throw new Error(`the target already has ${deviceCount} recorders and ${cameraCount} cameras; import runs only on a fresh install`);
  }

  const skipDevices = new Set(listArg('skip-device'));
  const skipCameras = new Set(listArg('skip-camera'));
  const devices = (data.devices as Row[]).filter((d) => !skipDevices.has(String(d.name)));
  const keptDeviceIds = new Set(devices.map((d) => d.id));
  const cameras = (data.cameras as Row[]).filter((c) => !skipCameras.has(String(c.name)) && (!c.deviceId || keptDeviceIds.has(c.deviceId)));
  const keptCameraIds = new Set(cameras.map((c) => c.id));

  const policyIds = new Set((data.retentionPolicies as Row[]).map((p) => p.id));
  const existingConfigKeys = new Set((await prisma.systemConfig.findMany({ select: { key: true } })).map((c) => c.key));
  const existingRoleCodes = new Set((await prisma.customRole.findMany({ select: { code: true } })).map((r) => r.code));

  console.log(`${apply ? 'IMPORT' : 'DRY RUN (nothing is written; add --apply to write)'} from ${file} (exported ${data.exportedAt} on ${data.sourceEnv})`);
  console.log(`  sites ${data.sites.length}, zones ${data.zones.length}, retention policies ${data.retentionPolicies.length}, master data ${data.masterdata.length}`);
  console.log(`  roles ${data.roles.length} (${data.roles.filter((r: Row) => existingRoleCodes.has(String(r.code))).length} replace the seeded ones), ` +
    `settings ${data.systemConfigs.length} (${data.systemConfigs.filter((c: Row) => existingConfigKeys.has(String(c.key))).length} replace the seeded value), alert rules ${data.alertRules.length}`);
  console.log(`  recorders ${devices.length}${skipDevices.size ? ` (skipped: ${[...skipDevices].join(', ')})` : ''}, cameras ${cameras.length}` +
    `${data.cameras.length !== cameras.length ? ` (${data.cameras.length - cameras.length} skipped)` : ''}, camera groups ${data.cameraGroups.length}`);
  const standalone = cameras.filter((c) => !c.deviceId).map((c) => c.name);
  if (standalone.length) console.log(`  cameras not on a recorder (check they belong in production): ${standalone.join(', ')}`);
  console.log('  recorders that need their password entered after the import:');
  for (const d of devices) console.log(`    - ${d.name} (${d.ipAddress}${d.username ? `, user ${d.username}` : ''})`);
  console.log(`  not imported: ${[...SKIP_CONFIG].join(', ')} (set them on the target)`);
  if (!apply) return;

  await prisma.$transaction(async (tx) => {
    for (const s of data.sites as Row[]) await tx.site.upsert({ where: { id: String(s.id) }, update: s, create: s as any });
    for (const z of data.zones as Row[]) await tx.zone.upsert({ where: { id: String(z.id) }, update: z, create: z as any });
    for (const p of data.retentionPolicies as Row[]) await tx.retentionPolicy.upsert({ where: { id: String(p.id) }, update: p, create: p as any });
    for (const m of data.masterdata as Row[]) {
      await tx.masterdata.upsert({ where: { type_code: { type: String(m.type), code: String(m.code) } }, update: m, create: m as any });
    }
    for (const r of data.roles as Row[]) await tx.customRole.upsert({ where: { code: String(r.code) }, update: r, create: r as any });
    for (const c of data.systemConfigs as Row[]) await tx.systemConfig.upsert({ where: { key: String(c.key) }, update: c, create: c as any });
    for (const a of data.alertRules as Row[]) await tx.alertRule.upsert({ where: { id: String(a.id) }, update: a, create: a as any });
    for (const d of devices) await tx.device.create({ data: { ...d, passwordEncrypted: null } as any });
    for (const c of cameras) {
      await tx.camera.create({
        data: {
          ...c,
          retentionPolicyId: c.retentionPolicyId && policyIds.has(c.retentionPolicyId) ? c.retentionPolicyId : null,
          // No fixed media node, as on Dev: the cameras use the target's default MediaMTX.
          mediaNodeId: null,
        } as any,
      });
    }
    for (const g of data.cameraGroups as Row[]) {
      const ids = (g.cameraIds as string[]).filter((id) => keptCameraIds.has(id));
      await tx.cameraGroup.create({
        data: { id: String(g.id), name: String(g.name), description: (g.description as string) ?? null, snapshotRefreshSeconds: (g.snapshotRefreshSeconds as number) ?? null,
          members: { create: ids.map((cameraId) => ({ cameraId })) } },
      });
    }
  }, { timeout: 120_000 });
  console.log('import done. Next: enter each recorder password (Devices > edit), set the settings listed as not imported, then run the smoke test.');
}

const [mode, file] = process.argv.slice(2);
const run = mode === 'export' && file ? exportTo(file)
  : mode === 'import' && file ? importFrom(file, process.argv.includes('--apply'))
  : Promise.reject(new Error('usage: config-transfer.ts export <file> | import <file> [--apply] [--skip-device=a,b] [--skip-camera=a,b]'));
run.then(() => prisma.$disconnect()).catch(async (err) => {
  console.error(`config-transfer failed: ${err instanceof Error ? err.message : err}`);
  await prisma.$disconnect();
  process.exit(1);
});
