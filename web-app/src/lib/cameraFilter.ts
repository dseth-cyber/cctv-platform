// Search and grouping behind the Live Room camera filter. Kept free of React so it can be exercised
// with hundreds of cameras on its own.

/** Everything an operator may type to find a camera. Stream URLs are left out on purpose. */
export function cameraSearchText(cam: any, statusLabel = ''): string {
  return [
    cam.name,
    cam.description,
    cam.ipAddress,
    cam.streamPath,
    cam.channelNumber != null ? `ch${cam.channelNumber}` : '',
    cam.device?.name,
    cam.device?.brand,
    cam.device?.deviceType,
    cam.device?.ipAddress,
    cam.metadata?.connection?.brand,
    cam.cameraType,
    cam.cameraBrand,
    cam.cameraModel,
    cam.site?.name,
    cam.site?.code,
    cam.zone?.name,
    cam.zone?.code,
    cam.template?.name,
    ...(cam.groups ?? []).map((g: any) => g.name),
    cam.operationalStatus,
    statusLabel,
  ]
    .filter(Boolean)
    .join(' ')
    .normalize('NFC')
    .toLocaleLowerCase();
}

/**
 * Every space-separated word must appear somewhere: more words narrow the result, they do not widen it.
 * A one-letter word next to others has to match a whole word, so "อาคาร C" means building C and not
 * every camera with a "c" in it. Typed on its own, one letter still searches as you type.
 */
export function matchesCameraQuery(searchText: string, query: string): boolean {
  const terms = query.normalize('NFC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const words = terms.length > 1 ? searchText.split(/\s+/) : [];
  return terms.every((term) => (terms.length > 1 && term.length === 1 ? words.includes(term) : searchText.includes(term)));
}

/** Channel order: 1, 2, 10 rather than 1, 10, 2. */
export function sortCamerasNaturally(cameras: any[]): any[] {
  return [...cameras].sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
}

export interface CameraGroup {
  /** Device id, or null for cameras that are not a DVR/NVR channel. */
  id: string | null;
  name: string | null;
  /** The recorder itself, for its address and channel count. */
  device?: any;
  cameras: any[];
}

/** DVR/NVRs by name, then the standalone cameras. Cameras keep their incoming order. */
export function groupCamerasByDevice(cameras: any[]): CameraGroup[] {
  const groups = new Map<string, CameraGroup>();
  const standalone: any[] = [];
  for (const cam of sortCamerasNaturally(cameras)) {
    if (!cam.deviceId) {
      standalone.push(cam);
      continue;
    }
    const group: CameraGroup = groups.get(cam.deviceId) ?? { device: cam.device, id: cam.deviceId, name: cam.device?.name ?? cam.deviceId, cameras: [] };
    group.cameras.push(cam);
    groups.set(cam.deviceId, group);
  }
  const sorted = [...groups.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return standalone.length > 0 ? [...sorted, { id: null, name: null, cameras: standalone }] : sorted;
}

/** Every group that has at least one of these cameras, by name. */
export function groupsOfCameras(cameras: any[]): { id: string; name: string; cameraIds: string[] }[] {
  const groups = new Map<string, { id: string; name: string; cameraIds: string[] }>();
  for (const cam of cameras) {
    for (const g of cam.groups ?? []) {
      const group: { id: string; name: string; cameraIds: string[] } = groups.get(g.id) ?? { id: g.id, name: g.name, cameraIds: [] };
      group.cameraIds.push(cam.id);
      groups.set(g.id, group);
    }
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** An empty selection means every camera. */
export function applyCameraSelection(cameras: any[], selectedIds: string[], onlyOffline: boolean): any[] {
  const selected = new Set(selectedIds);
  return sortCamerasNaturally(cameras).filter(
    (cam) => (selected.size === 0 || selected.has(cam.id)) && (!onlyOffline || cam.operationalStatus !== 'online'),
  );
}

/** Starred cameras first, in their existing order, then the rest: the same order in every live view. */
export function favoritesFirst<T extends { id: string }>(cameras: T[], favorites: Set<string>): T[] {
  return [...cameras.filter((c) => favorites.has(c.id)), ...cameras.filter((c) => !favorites.has(c.id))];
}

/** Which cameras go into the empty slots of a layout: next in order, leaving out those already on screen. */
export function camerasForEmptySlots<T extends { id: string }>(ordered: T[], onScreen: Array<string | null>): T[] {
  const taken = new Set(onScreen.filter((id): id is string => !!id));
  const empty = onScreen.filter((id) => !id).length;
  return ordered.filter((c) => !taken.has(c.id)).slice(0, empty);
}

/** Stands for "no site" or "no zone" in the location filter: cameras nobody has placed yet. */
export const NO_LOCATION = '__none__';

/** Empty lists mean no restriction. */
export function applyLocationFilter<T extends { siteId?: string | null; zoneId?: string | null }>(cameras: T[], sites: string[], zones: string[]): T[] {
  const matches = (chosen: string[], value: string | null | undefined) => chosen.length === 0 || chosen.includes(value ?? NO_LOCATION);
  return cameras.filter((c) => matches(sites, c.siteId) && matches(zones, c.zoneId));
}
