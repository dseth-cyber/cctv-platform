import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import os from 'os';
import fs from 'fs';
import { getPrisma } from '../../lib/prisma.js';
import { getRedisClient } from '../../lib/redis.js';
import { storageRouter } from '../../lib/storage/storage-router.js';
import { config } from '../../config/index.js';

let httpRequestCount = 0;

async function getMetrics(_request: FastifyRequest, reply: FastifyReply) {
  httpRequestCount++;

  const prisma = getPrisma();
  const redis = getRedisClient();

  const [
    imagesTotal,
    jobsByStatus,
    camerasByStatus,
    cameraDetails,
    queueWait, queueActive, queueFailed, queueDelayed,
    deadLetterCount,
    alertsByseverity,
    dbConnections,
    imageFiles,
  ] = await Promise.all([
    prisma.image.count().catch(() => 0),
    prisma.processingJob.groupBy({ by: ['status'], _count: true }).catch(() => []),
    prisma.camera.groupBy({ by: ['status'], _count: true }).catch(() => []),
    prisma.camera.findMany({ where: { enabled: true }, select: { id: true, name: true, status: true, lastPolledAt: true, totalImagesCount: true } }).catch(() => []),
    redis.llen('bull:image-processing:wait').catch(() => 0),
    redis.llen('bull:image-processing:active').catch(() => 0),
    redis.zcard('bull:image-processing:failed').catch(() => 0),
    redis.zcard('bull:image-processing:delayed').catch(() => 0),
    prisma.processingJob.count({ where: { status: 'dead_letter' } }).catch(() => 0),
    prisma.alert.groupBy({ by: ['severity'], where: { resolvedAt: null }, _count: true }).catch(() => []),
    prisma.$queryRawUnsafe<any[]>('SELECT numbackends FROM pg_stat_database WHERE datname = current_database()').catch(() => []),
    prisma.imageFile.groupBy({ by: ['fileType'], _count: true, _sum: { fileSizeBytes: true } }).catch(() => []),
  ]);

  const providers = storageRouter.getAll();
  const storageStats = await Promise.all(
    providers.map(async (p) => {
      try {
        const start = Date.now();
        const stats = await p.stats();
        const latencyMs = Date.now() - start;
        const dbRecord = await prisma.storageProvider.findUnique({ where: { id: p.id }, select: { capacityBytes: true } });
        const totalBytes = stats.totalBytes || Number(dbRecord?.capacityBytes ?? 0);
        return { name: p.name, type: p.type, usedBytes: stats.usedBytes, totalBytes, freeBytes: totalBytes > 0 ? totalBytes - stats.usedBytes : 0, objectCount: stats.objectCount, latencyMs };
      } catch {
        return { name: p.name, type: p.type, usedBytes: 0, totalBytes: 0, freeBytes: 0, objectCount: 0, latencyMs: 0 };
      }
    }),
  );

  const mem = process.memoryUsage();
  const lines: string[] = [];
  const g = (name: string, help: string, type: string, entries: string[]) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    entries.forEach(e => lines.push(e));
  };

  // ── Images ──
  g('image_service_images_total', 'Total images in the system', 'gauge',
    [`image_service_images_total ${imagesTotal}`]);

  // ── Processing Jobs ──
  g('image_service_processing_jobs_total', 'Processing jobs by status', 'gauge',
    Array.isArray(jobsByStatus) && jobsByStatus.length > 0
      ? jobsByStatus.map((r: any) => `image_service_processing_jobs_total{status="${r.status}"} ${r._count}`)
      : ['image_service_processing_jobs_total{status="none"} 0']);

  // ── Dead Letter Queue ──
  g('image_service_dead_letter_total', 'Dead letter queue count', 'gauge',
    [`image_service_dead_letter_total ${deadLetterCount}`]);

  // ── Queue Depth ──
  g('image_service_queue_depth', 'Queue depth by state', 'gauge', [
    `image_service_queue_depth{state="wait"} ${queueWait}`,
    `image_service_queue_depth{state="active"} ${queueActive}`,
    `image_service_queue_depth{state="failed"} ${queueFailed}`,
    `image_service_queue_depth{state="delayed"} ${queueDelayed}`,
  ]);

  // ── Cameras ──
  g('image_service_cameras_total', 'Cameras by status', 'gauge',
    Array.isArray(camerasByStatus) && camerasByStatus.length > 0
      ? camerasByStatus.map((r: any) => `image_service_cameras_total{status="${r.status}"} ${r._count}`)
      : ['image_service_cameras_total{status="none"} 0']);

  // ── Camera Status (per camera) ──
  const camArr = Array.isArray(cameraDetails) ? cameraDetails : [];
  g('image_service_camera_status', 'Per-camera status (1=active, 0=inactive, -1=error, -2=maintenance)', 'gauge',
    camArr.map((c: any) => {
      const v = c.status === 'active' ? 1 : c.status === 'error' ? -1 : c.status === 'maintenance' ? -2 : 0;
      const name = (c.name || '').replace(/"/g, '');
      return `image_service_camera_status{camera_id="${c.id}",camera_name="${name}",status="${c.status}"} ${v}`;
    }));

  g('image_service_camera_images_total', 'Total images per camera', 'gauge',
    camArr.map((c: any) => {
      const name = (c.name || '').replace(/"/g, '');
      return `image_service_camera_images_total{camera_id="${c.id}",camera_name="${name}"} ${Number(c.totalImagesCount ?? 0)}`;
    }));

  g('image_service_camera_last_poll_seconds', 'Seconds since last poll per camera', 'gauge',
    camArr.map((c: any) => {
      const name = (c.name || '').replace(/"/g, '');
      const ago = c.lastPolledAt ? Math.floor((Date.now() - new Date(c.lastPolledAt).getTime()) / 1000) : -1;
      return `image_service_camera_last_poll_seconds{camera_id="${c.id}",camera_name="${name}"} ${ago}`;
    }));

  // ── Storage Used ──
  g('image_service_storage_used_bytes', 'Storage used bytes per provider', 'gauge',
    storageStats.map(s => `image_service_storage_used_bytes{provider="${s.name}",type="${s.type}"} ${s.usedBytes}`));

  // ── Storage Total ──
  g('image_service_storage_total_bytes', 'Storage total capacity bytes per provider', 'gauge',
    storageStats.map(s => `image_service_storage_total_bytes{provider="${s.name}",type="${s.type}"} ${s.totalBytes}`));

  // ── Storage Latency ──
  g('image_service_storage_latency_ms', 'Storage provider latency in ms', 'gauge',
    storageStats.map(s => `image_service_storage_latency_ms{provider="${s.name}",type="${s.type}"} ${s.latencyMs}`));

  // ── Storage Object Count ──
  g('image_service_storage_objects_total', 'Storage objects per provider', 'gauge',
    storageStats.map(s => `image_service_storage_objects_total{provider="${s.name}",type="${s.type}"} ${s.objectCount}`));

  // ── Files by Type ──
  g('image_service_files_total', 'Image files by type', 'gauge',
    Array.isArray(imageFiles) && imageFiles.length > 0
      ? imageFiles.map((r: any) => `image_service_files_total{file_type="${r.fileType}"} ${r._count}`)
      : ['image_service_files_total{file_type="none"} 0']);

  g('image_service_files_bytes', 'Image file bytes by type', 'gauge',
    Array.isArray(imageFiles) && imageFiles.length > 0
      ? imageFiles.map((r: any) => `image_service_files_bytes{file_type="${r.fileType}"} ${Number(r._sum?.fileSizeBytes ?? 0)}`)
      : ['image_service_files_bytes{file_type="none"} 0']);

  // ── Alerts ──
  g('image_service_alerts_open_total', 'Open alerts by severity', 'gauge',
    Array.isArray(alertsByseverity) && alertsByseverity.length > 0
      ? alertsByseverity.map((r: any) => `image_service_alerts_open_total{severity="${r.severity}"} ${r._count}`)
      : ['image_service_alerts_open_total{severity="none"} 0']);

  // ── DB Connections ──
  g('image_service_postgres_connections_active', 'Active PostgreSQL connections', 'gauge',
    [`image_service_postgres_connections_active ${(imageFiles as any)?.[0]?.numbackends ?? dbConnections?.[0]?.numbackends ?? 0}`]);

  // ── Process Memory ──
  g('image_service_process_memory_bytes', 'Process memory usage', 'gauge', [
    `image_service_process_memory_bytes{type="rss"} ${mem.rss}`,
    `image_service_process_memory_bytes{type="heap_total"} ${mem.heapTotal}`,
    `image_service_process_memory_bytes{type="heap_used"} ${mem.heapUsed}`,
    `image_service_process_memory_bytes{type="external"} ${mem.external}`,
  ]);

  // ── System CPU ──
  const cpus = os.cpus();
  const loadAvg = os.loadavg();
  g('image_service_cpu_cores', 'Number of CPU cores', 'gauge',
    [`image_service_cpu_cores ${cpus.length}`]);
  g('image_service_cpu_load_avg', 'CPU load average', 'gauge', [
    `image_service_cpu_load_avg{period="1m"} ${loadAvg[0].toFixed(2)}`,
    `image_service_cpu_load_avg{period="5m"} ${loadAvg[1].toFixed(2)}`,
    `image_service_cpu_load_avg{period="15m"} ${loadAvg[2].toFixed(2)}`,
  ]);

  // ── System Memory ──
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  g('image_service_system_memory_bytes', 'System memory', 'gauge', [
    `image_service_system_memory_bytes{type="total"} ${totalMem}`,
    `image_service_system_memory_bytes{type="used"} ${totalMem - freeMem}`,
    `image_service_system_memory_bytes{type="free"} ${freeMem}`,
  ]);
  g('image_service_system_memory_usage_percent', 'System memory usage percent', 'gauge',
    [`image_service_system_memory_usage_percent ${(((totalMem - freeMem) / totalMem) * 100).toFixed(1)}`]);

  // ── System Disk ──
  try {
    const diskStat = fs.statfsSync('/');
    const diskTotal = diskStat.bsize * diskStat.blocks;
    const diskFree = diskStat.bsize * diskStat.bavail;
    g('image_service_system_disk_bytes', 'System disk space', 'gauge', [
      `image_service_system_disk_bytes{type="total"} ${diskTotal}`,
      `image_service_system_disk_bytes{type="used"} ${diskTotal - diskFree}`,
      `image_service_system_disk_bytes{type="free"} ${diskFree}`,
    ]);
    g('image_service_system_disk_usage_percent', 'System disk usage percent', 'gauge',
      [`image_service_system_disk_usage_percent ${((( diskTotal - diskFree) / diskTotal) * 100).toFixed(1)}`]);
  } catch { /* skip */ }

  // ── Camera Incidents ──
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [
      incidentsByStatus,
      incidentsByPriorityOpen,
      incidentsByPriorityAll,
      incidentsByRootCause,
      incidentsOpen,
      incidentsCreated24h,
      resolvedIncidents,
      workOrdersByStatus,
    ] = await Promise.all([
      prisma.cameraIncident.groupBy({ by: ['status'], _count: true }).catch(() => []),
      prisma.cameraIncident.groupBy({ by: ['priority'], where: { status: 'open' }, _count: true }).catch(() => []),
      prisma.cameraIncident.groupBy({ by: ['priority'], _count: true }).catch(() => []),
      prisma.cameraIncident.groupBy({ by: ['rootCause'], _count: true }).catch(() => []),
      prisma.cameraIncident.count({ where: { status: 'open' } }).catch(() => 0),
      prisma.cameraIncident.count({ where: { openedAt: { gte: since24h } } }).catch(() => 0),
      prisma.cameraIncident.findMany({ where: { status: 'resolved', closedAt: { not: null } }, select: { openedAt: true, closedAt: true } }).catch(() => []),
      prisma.cameraIncident.groupBy({ by: ['workOrderStatus'], where: { workOrderStatus: { not: null } }, _count: true }).catch(() => []),
    ]);

    const sanitize = (v: string) => v.replace(/[\r\n]/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    // Total incidents by status
    g('image_service_camera_incidents_total', 'Camera incidents by status', 'gauge',
      Array.isArray(incidentsByStatus) && incidentsByStatus.length > 0
        ? incidentsByStatus.map((r: any) => `image_service_camera_incidents_total{status="${sanitize(String(r.status))}"} ${r._count}`)
        : ['image_service_camera_incidents_total{status="none"} 0']);

    // Open incidents by priority
    g('image_service_camera_incidents_by_priority', 'Open camera incidents by priority', 'gauge',
      Array.isArray(incidentsByPriorityOpen) && incidentsByPriorityOpen.length > 0
        ? incidentsByPriorityOpen.map((r: any) => `image_service_camera_incidents_by_priority{priority="${sanitize(String(r.priority))}"} ${r._count}`)
        : ['image_service_camera_incidents_by_priority{priority="none"} 0']);

    // All incidents by priority
    g('image_service_camera_incidents_by_priority_all', 'All camera incidents by priority', 'gauge',
      Array.isArray(incidentsByPriorityAll) && incidentsByPriorityAll.length > 0
        ? incidentsByPriorityAll.map((r: any) => `image_service_camera_incidents_by_priority_all{priority="${sanitize(String(r.priority))}"} ${r._count}`)
        : ['image_service_camera_incidents_by_priority_all{priority="none"} 0']);

    // Incidents by root cause (skip null/empty)
    const rootCauseEntries = (Array.isArray(incidentsByRootCause) ? incidentsByRootCause : [])
      .filter((r: any) => r.rootCause != null && String(r.rootCause).trim() !== '')
      .map((r: any) => `image_service_camera_incidents_by_root_cause{root_cause="${sanitize(String(r.rootCause))}"} ${r._count}`);
    g('image_service_camera_incidents_by_root_cause', 'Camera incidents by root cause', 'gauge',
      rootCauseEntries.length > 0 ? rootCauseEntries : ['image_service_camera_incidents_by_root_cause{root_cause="none"} 0']);

    // Open incidents gauge
    g('image_service_camera_incidents_open', 'Currently open camera incidents', 'gauge',
      [`image_service_camera_incidents_open ${incidentsOpen}`]);

    // Incidents created in last 24h
    g('image_service_camera_incidents_created_24h', 'Camera incidents created in the last 24 hours', 'gauge',
      [`image_service_camera_incidents_created_24h ${incidentsCreated24h}`]);

    // Average MTTR in minutes
    const resolved = Array.isArray(resolvedIncidents) ? resolvedIncidents : [];
    let mttrMinutes = 0;
    if (resolved.length > 0) {
      const totalMinutes = resolved.reduce((acc: number, r: any) => {
        const opened = new Date(r.openedAt).getTime();
        const closed = new Date(r.closedAt).getTime();
        return acc + Math.max(0, (closed - opened) / 60000);
      }, 0);
      mttrMinutes = totalMinutes / resolved.length;
    }
    g('image_service_camera_incident_mttr_minutes', 'Average mean time to resolve (minutes) for resolved incidents', 'gauge',
      [`image_service_camera_incident_mttr_minutes ${mttrMinutes.toFixed(1)}`]);

    // Work orders by status
    g('image_service_camera_work_orders_total', 'Work orders by status', 'gauge',
      Array.isArray(workOrdersByStatus) && workOrdersByStatus.length > 0
        ? workOrdersByStatus.map((r: any) => `image_service_camera_work_orders_total{status="${sanitize(String(r.workOrderStatus))}"} ${r._count}`)
        : ['image_service_camera_work_orders_total{status="none"} 0']);

    // Open work orders gauge
    const openWorkOrders = (Array.isArray(workOrdersByStatus) ? workOrdersByStatus : [])
      .filter((r: any) => r.workOrderStatus === 'open' || r.workOrderStatus === 'in_progress')
      .reduce((acc: number, r: any) => acc + Number(r._count), 0);
    g('image_service_camera_work_orders_open', 'Open or in-progress work orders', 'gauge',
      [`image_service_camera_work_orders_open ${openWorkOrders}`]);
  } catch { /* skip incident metrics on failure */ }

  // ── HTTP Requests ──
  g('image_service_http_requests_total', 'HTTP requests to metrics endpoint', 'counter',
    [`image_service_http_requests_total ${httpRequestCount}`]);

  // ── Uptime ──
  g('image_service_uptime_seconds', 'Process uptime in seconds', 'gauge',
    [`image_service_uptime_seconds ${Math.floor(process.uptime())}`]);

  reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  return reply.status(200).send(lines.join('\n') + '\n');
}

const metricsAuth = async (request: FastifyRequest, reply: FastifyReply) => {
  // Allow access via service API key header
  const serviceKey = request.headers['x-service-api-key'];
  if (serviceKey && config.serviceApiKey && serviceKey === config.serviceApiKey) return;

  // Allow Prometheus scraper access
  const userAgent = request.headers['user-agent'] || '';
  if (userAgent.includes('Prometheus')) return;

  // Fall back to JWT authentication
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
};

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [metricsAuth] }, getMetrics);
}
