import { getPrisma } from '../../lib/prisma.js';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { MediaMtxService } from '../media/mediamtx.service.js';

export interface PreflightCheckItem {
  id: string;
  category: 'isolation' | 'security' | 'storage' | 'streaming' | 'database' | 'acceptance';
  name: string;
  status: 'passed' | 'warning' | 'failed';
  details: string;
  remediation?: string;
}

export interface PreflightReport {
  score: number; // 0 - 100
  overallStatus: 'ready' | 'action_required' | 'blocked';
  environment: string;
  isolationVerified: boolean;
  checkedAt: string;
  items: PreflightCheckItem[];
}

export interface PilotRolloutPlan {
  phase: string;
  targetCameras: number;
  expectedIngressMbps: number;
  expectedStoragePerDayGB: number;
  recommendedNodes: number;
  prerequisites: string[];
  acceptanceCriteria: string[];
}

export interface ReleaseSignoffRecord {
  id: string;
  signedAt: string;
  signedBy: string;
  targetEnvironment: string;
  scope: string;
  checklistPassed: boolean;
  notes: string;
}

// Sign-offs come only from the database; there is no seeded or in-memory record.

/**
 * Audit environment secrets for default/insecure values
 */
function auditSecretHygiene(): PreflightCheckItem[] {
  const items: PreflightCheckItem[] = [];

  // JWT Secret Check
  const jwtDefault = config.jwt.secret === 'change-me' || config.jwt.secret.length < 16;
  items.push({
    id: 'sec-jwt',
    category: 'security',
    name: 'JWT Secret Hardening',
    status: jwtDefault ? (config.nodeEnv === 'production' ? 'failed' : 'warning') : 'passed',
    details: jwtDefault
      ? 'JWT_SECRET is using default placeholder or length is less than 16 chars'
      : 'JWT_SECRET meets minimum entropy requirements (>= 16 chars)',
    remediation: 'Generate a strong 32+ char random string via `openssl rand -base64 32` and set JWT_SECRET.',
  });

  // Encryption Key Check
  const encDefault = config.encryptionKey === 'change-me' || (config.encryptionKey && config.encryptionKey.length < 16);
  items.push({
    id: 'sec-enc',
    category: 'security',
    name: 'Data Encryption Key (AES-256)',
    status: encDefault ? (config.nodeEnv === 'production' ? 'failed' : 'warning') : 'passed',
    details: encDefault
      ? 'ENCRYPTION_KEY is using default placeholder'
      : 'ENCRYPTION_KEY configured properly',
    remediation: 'Set ENCRYPTION_KEY with 32-byte secret in .env before staging/prod release.',
  });

  // Fail-Closed Isolation Check
  // Nothing here can prove network separation, so it only passes when an operator has checked it by hand.
  const isIsolated = process.env.CCTV_ISOLATION_VERIFIED === 'true';
  items.push({
    id: 'iso-fail-closed',
    category: 'isolation',
    name: 'Legacy Image-Service Isolation (Fail-Closed)',
    status: isIsolated ? 'passed' : 'warning',
    details: isIsolated
      ? 'Operator confirmed CCTV_ISOLATION_VERIFIED=true for this host.'
      : 'Network isolation from legacy Image-Service production has not been confirmed on this host.',
    remediation: isIsolated
      ? undefined
      : 'Check that this host cannot reach legacy production, then set CCTV_ISOLATION_VERIFIED=true.',
  });

  return items;
}

/**
 * Check Database and MediaMTX readiness
 */
export async function getPreflightReadiness(): Promise<PreflightReport> {
  const items: PreflightCheckItem[] = [...auditSecretHygiene()];
  const prisma = getPrisma();

  // 1. Database Check
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;
    items.push({
      id: 'db-postgres',
      category: 'database',
      name: 'PostgreSQL Database Connectivity',
      status: latency < 100 ? 'passed' : 'warning',
      details: `Database response time: ${latency}ms, pool connected`,
    });
  } catch (err: any) {
    items.push({
      id: 'db-postgres',
      category: 'database',
      name: 'PostgreSQL Database Connectivity',
      status: 'failed',
      details: `DB connection error: ${err.message}`,
      remediation: 'Ensure PostgreSQL container is running on docker-compose and migrations are applied.',
    });
  }

  // 2. MediaMTX Streaming Node Check
  try {
    const mediamtxApi = config.mediamtx.apiUrl;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await MediaMtxService.apiFetch('/v3/paths/list', { signal: controller.signal }).catch(() => null);
    clearTimeout(timeout);

    if (res && res.ok) {
      items.push({
        id: 'stream-mediamtx',
        category: 'streaming',
        name: 'MediaMTX Core Streaming Engine',
        status: 'passed',
        details: `MediaMTX API reachable at ${mediamtxApi}`,
      });
    } else {
      items.push({
        id: 'stream-mediamtx',
        category: 'streaming',
        name: 'MediaMTX Core Streaming Engine',
        status: 'warning',
        details: `MediaMTX API not responding at ${mediamtxApi}${res ? ` (HTTP ${res.status})` : ''}`,
        remediation: 'Verify mediamtx container status: `docker compose ps mediamtx`.',
      });
    }
  } catch {
    items.push({
      id: 'stream-mediamtx',
      category: 'streaming',
      name: 'MediaMTX Core Streaming Engine',
      status: 'warning',
      details: 'MediaMTX streaming service check timed out',
    });
  }

  // 3. Storage & Recordings Directory
  try {
    const recordingCount = await prisma.cameraRecording.count();
    items.push({
      id: 'store-fmp4',
      category: 'storage',
      name: 'Recording Storage & Database Index',
      status: 'passed',
      details: `Recording index reachable: ${recordingCount} recording records.`,
    });
  } catch {
    items.push({
      id: 'store-fmp4',
      category: 'storage',
      name: 'Recording Storage & Database Index',
      status: 'warning',
      details: 'Recording index query failed',
    });
  }

  // 4. The pilot is signed off by a person, with its checklist passed. Until then the system is not ready to
  // release however well the technical checks go.
  try {
    const signoffs = await prisma.signoffRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    const passed = signoffs.find((r: any) => (r.metadata as any)?.checklistPassed === true);
    items.push(passed
      ? { id: 'pilot-signoff', category: 'acceptance', name: 'Pilot sign-off', status: 'passed', details: `Signed off by ${passed.signoffBy} (${passed.phase}) on ${passed.createdAt.toISOString().slice(0, 10)}` }
      : { id: 'pilot-signoff', category: 'acceptance', name: 'Pilot sign-off', status: 'warning', details: 'No sign-off with a passed checklist yet (Roadmap R4.1 waits for the user).', remediation: 'Run the pilot checklist, then record the sign-off in step 4.' });
  } catch {
    items.push({ id: 'pilot-signoff', category: 'acceptance', name: 'Pilot sign-off', status: 'warning', details: 'Sign-off records could not be read' });
  }

  // Calculate score
  const passedCount = items.filter((i) => i.status === 'passed').length;
  const failedCount = items.filter((i) => i.status === 'failed').length;
  const score = Math.round((passedCount / items.length) * 100);

  // Ready means every check passed; any warning still needs action.
  let overallStatus: 'ready' | 'action_required' | 'blocked' = 'ready';
  if (failedCount > 0) {
    overallStatus = 'blocked';
  } else if (passedCount < items.length) {
    overallStatus = 'action_required';
  }

  return {
    score,
    overallStatus,
    environment: config.deployEnv,
    isolationVerified: items.find((i) => i.id === 'iso-fail-closed')?.status === 'passed',
    checkedAt: new Date().toISOString(),
    items,
  };
}

/**
 * Get Pilot Rollout Planning criteria (10, 25, 50, 100 cameras)
 */
export function getPilotRolloutPlan(targetCameras = 25): PilotRolloutPlan {
  const perChannelBitrateMbps = 2.0; // 1080p H.264
  const expectedIngressMbps = Math.round(targetCameras * perChannelBitrateMbps);
  // 2 Mbps = 21.6 GB/day
  const expectedStoragePerDayGB = Math.round(targetCameras * 21.6);
  const recommendedNodes = Math.ceil(targetCameras / 100);

  return {
    phase: targetCameras <= 15 ? 'Pilot Wave 1 (Initial Canary)' : targetCameras <= 50 ? 'Pilot Wave 2 (Multi-Zone)' : 'Full Staging Release',
    targetCameras,
    expectedIngressMbps,
    expectedStoragePerDayGB,
    recommendedNodes,
    prerequisites: [
      'Dedicated LAN subnet with isolated VLAN for IP cameras',
      'MediaMTX host configured with >= 1Gbps NIC for ingress',
      'PostgreSQL automated daily backup script tested with restore drill',
      'STUN/TURN ICE credentials configured for external/WFH viewers',
      'All default secrets replaced in .env',
    ],
    acceptanceCriteria: [
      'Sub-500ms WebRTC WHEP live stream playback on 16-channel multi-grid',
      'Continuous 24-hour fMP4 recording segments without missing gaps > 120s',
      'Export clip feature generates MP4 with pre-buffer within < 15 seconds',
      'Telegram Bot alerts fire within 5 seconds upon camera disconnect/tamper',
      'Failover evacuation test successfully migrates streams to secondary node',
    ],
  };
}

/**
 * Record a sign-off approval
 */
export async function recordSignoff(
  signedBy: string,
  targetEnvironment: string,
  scope: string,
  notes: string,
  checklistPassed: boolean
): Promise<ReleaseSignoffRecord> {
  const prisma = getPrisma();
  // A sign-off that was not stored must fail; never report it as recorded.
  const dbRecord = await prisma.signoffRecord.create({
    data: {
      phase: scope,
      role: targetEnvironment,
      signoffBy: signedBy,
      comment: notes,
      metadata: { checklistPassed, targetEnvironment, scope },
    },
  });

  const newRecord: ReleaseSignoffRecord = {
    id: dbRecord.id,
    signedAt: (dbRecord.signedAt ?? dbRecord.createdAt).toISOString(),
    signedBy,
    targetEnvironment,
    scope,
    checklistPassed,
    notes,
  };

  logger.info({ record: newRecord }, 'Pilot & Release signoff recorded');

  // Also log into AuditLog with correct schema fields
  try {
    await prisma.auditLog.create({
      data: {
        action: 'RELEASE_SIGNOFF',
        entity: 'PILOT_RELEASE',
        entityId: newRecord.id,
        description: `Pilot/Release sign-off recorded by ${newRecord.signedBy} for ${scope}`,
        metadata: { checklistPassed, notes, targetEnvironment, scope },
      },
    });
  } catch (err) {
    logger.warn({ err }, 'Failed to write release sign-off audit log');
  }

  return newRecord;
}

export async function listSignoffs(): Promise<ReleaseSignoffRecord[]> {
  const prisma = getPrisma();
  const rows = await prisma.signoffRecord.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return rows.map((r: any) => ({
    id: r.id,
    signedAt: r.signedAt ? r.signedAt.toISOString() : r.createdAt.toISOString(),
    signedBy: r.signoffBy,
    targetEnvironment: r.role,
    scope: r.phase,
    // Older rows without the flag are not assumed to have passed.
    checklistPassed: (r.metadata as any)?.checklistPassed === true,
    notes: r.comment || '',
  }));
}
