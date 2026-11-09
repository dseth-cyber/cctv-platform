import { randomUUID } from 'node:crypto';
import { createBulkJob, updateBulkJob } from '../../lib/bulk-job.js';
import { logger } from '../../lib/logger.js';
import { createAuditLog } from '../audit/audit.service.js';
import { checkDeviceHealthNow } from './device-health.service.js';
import { pointRecorderAtNtp, RecorderNtpError, type NtpRefusal } from './recorder-ntp.js';

/** Who pressed, for the audit log. */
export interface NtpActor {
  id?: string;
  username?: string;
  ip?: string;
}

/** Refusals about our own NTP server, not the recorder: every recorder after would be refused the same. */
const SERVER_SIDE: NtpRefusal[] = ['NTP_NOT_SET', 'NTP_SERVER_UNREACHABLE', 'NTP_SERVER_NOT_SYNCED', 'SERVER_CLOCK_OFF'];
/** The recorder syncs within a minute or so; look again then, so the page and its clock warning need not wait for the hourly round. */
const RECHECK_AFTER_MS = 120_000;

const audit = (actor: NtpActor, deviceId: string, description: string, metadata: Record<string, unknown>) => createAuditLog({
  userId: actor.id, action: 'update', entity: 'device', entityId: deviceId, description, metadata, ipAddress: actor.ip,
}).catch(() => {});

/** Points one recorder at the NTP server and puts it on record, done or failed. Null: no such device. */
export async function pointAndRecord(deviceId: string, actor: NtpActor) {
  try {
    const result = await pointRecorderAtNtp(deviceId);
    if (!result) return null;
    await audit(actor, deviceId, `Recorder clock set to take time from ${result.server} by ${actor.username ?? 'unknown'}`, {
      before: result.before, after: result.after, server: result.server, minutes: result.minutes, serverCheck: result.serverCheck,
    });
    return result;
  } catch (err) {
    // A refusal on the recorder may have left half a change; it goes on record too.
    if (err instanceof RecorderNtpError && (err.code === 'RECORDER_REFUSED' || err.code === 'RECORDER_UNREACHABLE')) {
      await audit(actor, deviceId, `Recorder clock change failed (${err.code}) by ${actor.username ?? 'unknown'}`, err.details);
    }
    throw err;
  }
}

export function recheckSoon(deviceIds: string[]) {
  setTimeout(() => {
    void (async () => {
      // One at a time, as the hourly round does, so a hundred recorders are not all asked at once.
      for (const id of deviceIds) await checkDeviceHealthNow(id).catch(() => null);
    })();
  }, RECHECK_AFTER_MS).unref();
}

export interface NtpBatchItem {
  id: string;
  name: string | null;
  ok: boolean;
  /** Why not, when not: a refusal code, NOT_FOUND, or SKIPPED after a server-side refusal. */
  code?: string;
  driftBefore?: number | null;
}

/**
 * One recorder at a time. Stops at a refusal about our own server: the rest are marked as not tried,
 * because sending on would only fail the same way.
 */
export async function runNtpBatch(deviceIds: string[], actor: NtpActor, onEach: (items: NtpBatchItem[]) => Promise<void> = async () => {}) {
  const items: NtpBatchItem[] = [];
  let stopped: string | null = null;
  for (const id of deviceIds) {
    if (stopped) {
      items.push({ id, name: null, ok: false, code: 'SKIPPED' });
      continue;
    }
    try {
      const result = await pointAndRecord(id, actor);
      items.push(result ? { id, name: result.device.name, ok: true } : { id, name: null, ok: false, code: 'NOT_FOUND' });
    } catch (err) {
      const code = err instanceof RecorderNtpError ? err.code : 'FAILED';
      if (!(err instanceof RecorderNtpError)) logger.warn({ deviceId: id, reason: err instanceof Error ? err.message : 'failed' }, 'Recorder NTP change failed');
      items.push({ id, name: null, ok: false, code });
      if (SERVER_SIDE.includes(code as NtpRefusal)) stopped = code;
    }
    await onEach(items);
  }
  return items;
}

let running: string | null = null;

export class NtpBatchBusyError extends Error {
  constructor(readonly jobId: string) {
    super('NTP_BATCH_BUSY');
  }
}

/** Runs the batch after the request returns: a hundred recorders take longer than the proxy waits. */
export async function startNtpBatch(deviceIds: string[], actor: NtpActor): Promise<string> {
  if (running) throw new NtpBatchBusyError(running);
  const jobId = randomUUID();
  running = jobId;
  try {
    await createBulkJob(jobId, 'device-ntp', deviceIds.length);
  } catch (err) {
    running = null;
    throw err;
  }
  void (async () => {
    try {
      const items = await runNtpBatch(deviceIds, actor, (sofar) => updateBulkJob(jobId, {
        done: sofar.length, errors: sofar.filter((i) => !i.ok).length, result: { items: sofar },
      }));
      await updateBulkJob(jobId, { status: 'completed', finishedAt: new Date().toISOString(), result: { items } });
      recheckSoon(items.filter((i) => i.ok).map((i) => i.id));
    } catch (err) {
      await updateBulkJob(jobId, { status: 'failed', finishedAt: new Date().toISOString(), errorMessage: err instanceof Error ? err.message : 'failed' }).catch(() => {});
    } finally {
      running = null;
    }
  })();
  return jobId;
}
