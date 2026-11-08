import { getPrisma } from '../../lib/prisma.js';
import { probeTcpEndpoint } from './camera-probe.service.js';

/**
 * When a whole recorder stops answering, every camera on it goes down at once. That is one fault, so it is
 * raised once, for the recorder, instead of once per channel. A camera that drops while its recorder still
 * answers is its own fault and is raised on its own, as before.
 */
export interface Recorder {
  id: string;
  name: string;
  ipAddress: string;
  cameraCount: number;
}

export interface RecorderDevice {
  id: string;
  name: string;
  ipAddress: string | null;
  httpPort?: number | null;
  rtspPort?: number | null;
}

export interface RecorderCamera {
  id: string;
  status?: string | null;
  streamPath?: string | null;
  device?: RecorderDevice | null;
}

type Probe = (host: string, port: number) => Promise<{ reachable: boolean }>;

// One camera on a recorder is just that camera: nothing to gather up.
const MIN_CAMERAS = 2;
const AT_ONCE = 8;

/** Either port answering is enough: some recorders close one of them. */
export async function recorderAnswers(device: RecorderDevice, probe: Probe = probeTcpEndpoint): Promise<boolean> {
  if (!device.ipAddress) return true;
  const ports = [...new Set([device.rtspPort || 554, device.httpPort || 80])];
  const results = await Promise.all(ports.map((port) => probe(device.ipAddress as string, port).catch(() => ({ reachable: false }))));
  return results.some((r) => r.reachable);
}

/**
 * Which recorders are down right now, and which answer. A recorder sending any picture answers, whatever a port
 * says. A recorder not asked (one camera, no address, all in maintenance) is in neither, so nothing about it changes.
 */
export async function checkRecorders(
  cameras: RecorderCamera[],
  readyPaths: Set<string>,
  probe: Probe = probeTcpEndpoint,
): Promise<{ down: Map<string, Recorder>; answering: Set<string> }> {
  const groups = new Map<string, { device: RecorderDevice; cameras: RecorderCamera[] }>();
  for (const cam of cameras) {
    if (!cam.device?.id || !cam.device.ipAddress || cam.status === 'maintenance') continue;
    const group = groups.get(cam.device.id) ?? { device: cam.device, cameras: [] };
    group.cameras.push(cam);
    groups.set(cam.device.id, group);
  }

  const down = new Map<string, Recorder>();
  const answering = new Set<string>();
  const queue: Array<{ device: RecorderDevice; cameras: RecorderCamera[] }> = [];
  for (const [id, group] of groups) {
    if (group.cameras.length < MIN_CAMERAS) continue;
    const streaming = group.cameras.some((c) => !!c.streamPath && readyPaths.has(c.streamPath.replace(/^\/+/, '')));
    if (streaming) answering.add(id);
    else queue.push(group);
  }

  const worker = async () => {
    for (let group = queue.shift(); group; group = queue.shift()) {
      const { device } = group;
      if (await recorderAnswers(device, probe)) answering.add(device.id);
      else down.set(device.id, { id: device.id, name: device.name, ipAddress: device.ipAddress as string, cameraCount: group.cameras.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, worker));
  return { down, answering };
}

/** For one camera's stream dropping: is it the camera, or the recorder behind it? */
export async function recorderIfDown(deviceId: string, probe: Probe = probeTcpEndpoint): Promise<Recorder | undefined> {
  const prisma = getPrisma();
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true, name: true, ipAddress: true, httpPort: true, rtspPort: true },
  });
  if (!device?.ipAddress) return undefined;
  const cameraCount = await prisma.camera.count({ where: { deviceId, enabled: true, status: { not: 'maintenance' } } });
  if (cameraCount < MIN_CAMERAS) return undefined;
  if (await recorderAnswers(device, probe)) return undefined;
  return { id: device.id, name: device.name, ipAddress: device.ipAddress, cameraCount };
}

const queues = new Map<string, Promise<unknown>>();

/**
 * Every channel of a recorder that dies reports at the same moment. Run one at a time per recorder, so the
 * first opens the incident and the rest find it.
 */
export function withRecorderLock<T>(recorderId: string, task: () => Promise<T>): Promise<T> {
  const before = queues.get(recorderId) ?? Promise.resolve();
  const run = before.then(task, task);
  const settled = run.catch(() => undefined);
  queues.set(recorderId, settled);
  settled.then(() => { if (queues.get(recorderId) === settled) queues.delete(recorderId); });
  return run;
}
