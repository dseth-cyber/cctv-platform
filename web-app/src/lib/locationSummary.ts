import { spareChannels } from './deviceChannels';

export interface LocationStats {
  /** Cameras switched on. */
  inUse: number;
  online: number;
  /** Switched on, and not confirmed online. */
  problem: number;
  /** Channels and cameras switched off. */
  switchedOff: number;
  devices: number;
  /** Recorder channels with no camera in use. */
  spare: number;
}

const empty = (): LocationStats => ({ inUse: 0, online: 0, problem: 0, switchedOff: 0, devices: 0, spare: 0 });

export interface LocationSummary {
  bySite: Map<string, LocationStats>;
  byZone: Map<string, LocationStats>;
  /** Cameras in use in a site but in no zone of it, per site. */
  noZoneBySite: Map<string, number>;
  /** Cameras in use with no site at all. */
  noSite: number;
  /** Cameras in use with no zone, whether or not they have a site. */
  noZone: number;
  inUse: number;
}

/** What is in each place. Cameras switched off are shown apart and never count as a place needing attention. */
export function summarizeLocations(cameras: any[], devices: any[]): LocationSummary {
  const bySite = new Map<string, LocationStats>();
  const byZone = new Map<string, LocationStats>();
  const noZoneBySite = new Map<string, number>();
  const at = (map: Map<string, LocationStats>, key: string) => {
    if (!map.has(key)) map.set(key, empty());
    return map.get(key)!;
  };
  let noSite = 0;
  let noZone = 0;
  let inUse = 0;

  for (const cam of cameras) {
    const stats = [cam.siteId && at(bySite, cam.siteId), cam.zoneId && at(byZone, cam.zoneId)].filter(Boolean) as LocationStats[];
    if (cam.enabled === false) {
      stats.forEach((s) => s.switchedOff++);
      continue;
    }
    inUse++;
    const online = cam.operationalStatus === 'online';
    stats.forEach((s) => {
      s.inUse++;
      if (online) s.online++;
      else s.problem++;
    });
    if (!cam.siteId) noSite++;
    if (!cam.zoneId) {
      noZone++;
      if (cam.siteId) noZoneBySite.set(cam.siteId, (noZoneBySite.get(cam.siteId) ?? 0) + 1);
    }
  }

  for (const device of devices) {
    if (device.siteId) at(bySite, device.siteId).devices++;
    if (device.zoneId) at(byZone, device.zoneId).devices++;
  }
  for (const row of spareChannels(devices)) {
    if (row.device.siteId) at(bySite, row.device.siteId).spare += row.spare.length;
    if (row.device.zoneId) at(byZone, row.device.zoneId).spare += row.spare.length;
  }
  return { bySite, byZone, noZoneBySite, noSite, noZone, inUse };
}
