import { getPrisma } from '../../lib/prisma.js';

/**
 * An alert's `source` is an id (camera, recorder, incident, storage provider) or the name of a check inside the
 * system. People need to know what it is about: this turns it into a kind, a name and, where there is one, a page.
 */
export type SourceKind = 'camera' | 'device' | 'incident' | 'provider' | 'system' | 'deleted' | 'unknown';
export interface AlertSourceInfo { kind: SourceKind; name: string | null; link: string | null }

/** Checks inside the system that raise alerts; the page names them in the person's language. */
export const SYSTEM_SOURCES = ['disk_watermark_monitor', 'health_monitor', 'recording_index_audit', 'recorder_hdd', 'system', 'publisher', 'auth'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function describeSources(sources: Array<string | null | undefined>): Promise<Map<string, AlertSourceInfo>> {
  const out = new Map<string, AlertSourceInfo>();
  const ids = [...new Set(sources.filter((s): s is string => !!s && UUID.test(s)))];
  for (const s of new Set(sources)) {
    if (!s || UUID.test(s)) continue;
    out.set(s, { kind: (SYSTEM_SOURCES as readonly string[]).includes(s) ? 'system' : 'unknown', name: s, link: null });
  }
  if (ids.length === 0) return out;
  const prisma = getPrisma();
  const [cameras, devices, incidents, providers] = await Promise.all([
    prisma.camera.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, deletedAt: true } }),
    prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    prisma.cameraIncident.findMany({ where: { id: { in: ids } }, select: { id: true, incidentNumber: true } }),
    prisma.storageProvider.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }).catch(() => [] as Array<{ id: string; name: string }>),
  ]);
  for (const c of cameras) out.set(c.id, { kind: c.deletedAt ? 'deleted' : 'camera', name: c.name, link: c.deletedAt ? null : `/cctv/cameras/${c.id}` });
  for (const d of devices) out.set(d.id, { kind: 'device', name: d.name, link: '/cctv/devices' });
  for (const i of incidents) out.set(i.id, { kind: 'incident', name: i.incidentNumber ?? null, link: i.incidentNumber ? `/cctv/incidents?incident=${encodeURIComponent(i.incidentNumber)}` : '/cctv/incidents' });
  for (const p of providers) out.set(p.id, { kind: 'provider', name: p.name, link: '/cctv/storage-providers' });
  // An id that matches nothing any more: a camera or recorder that was removed for good.
  for (const id of ids) if (!out.has(id)) out.set(id, { kind: 'deleted', name: null, link: null });
  return out;
}

/** The same alerts with `sourceInfo` added. */
export async function withSourceInfo<T extends { source?: string | null }>(alerts: T[]): Promise<Array<T & { sourceInfo: AlertSourceInfo | null }>> {
  const info = await describeSources(alerts.map((a) => a.source));
  return alerts.map((a) => ({ ...a, sourceInfo: a.source ? info.get(a.source) ?? null : null }));
}
