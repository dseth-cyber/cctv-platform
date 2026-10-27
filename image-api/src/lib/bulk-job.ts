import { getRedisClient } from './redis.js';

// Generic progress-tracking for long-running bulk operations that must not run inside a
// single HTTP request/response cycle — nginx's proxy_read_timeout (60s, see
// docker-compose/nginx.conf) will cut the client off long before a few-thousand-file
// storage deletion finishes, even though the backend keeps running unseen. See
// incident_2026-08-06: this is what made bulk-delete/empty-trash look like they "hang
// then error" on anything beyond a few hundred files.
//
// The HTTP handler kicks the job off (fire-and-forget) and returns a jobId immediately;
// the frontend polls GET /jobs/:id for progress and renders it in a modal.

export type BulkJobStatus = 'running' | 'completed' | 'failed';

export interface BulkJobState {
  id: string;
  kind: string;
  status: BulkJobStatus;
  total: number;
  done: number;
  deletedBytes: number;
  errors: number;
  startedAt: string;
  finishedAt?: string;
  errorMessage?: string;
  result?: Record<string, unknown>;
}

const JOB_TTL_SECONDS = 3600;

function key(id: string): string {
  return `bulkjob:${id}`;
}

export async function createBulkJob(id: string, kind: string, total: number): Promise<void> {
  const redis = getRedisClient();
  const state: BulkJobState = {
    id,
    kind,
    status: 'running',
    total,
    done: 0,
    deletedBytes: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
  };
  await redis.set(key(id), JSON.stringify(state), 'EX', JOB_TTL_SECONDS);
}

export async function updateBulkJob(id: string, patch: Partial<BulkJobState>): Promise<void> {
  const redis = getRedisClient();
  const raw = await redis.get(key(id));
  if (!raw) return;
  const state = { ...JSON.parse(raw), ...patch };
  await redis.set(key(id), JSON.stringify(state), 'EX', JOB_TTL_SECONDS);
}

export async function failBulkJob(id: string, errorMessage: string): Promise<void> {
  await updateBulkJob(id, { status: 'failed', finishedAt: new Date().toISOString(), errorMessage });
}

export async function getBulkJob(id: string): Promise<BulkJobState | null> {
  const redis = getRedisClient();
  const raw = await redis.get(key(id));
  return raw ? JSON.parse(raw) as BulkJobState : null;
}
