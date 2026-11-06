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
    cam.site?.name,
    cam.site?.code,
    cam.zone?.name,
    cam.zone?.code,
    cam.template?.name,
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
    const group: CameraGroup = groups.get(cam.deviceId) ?? { id: cam.deviceId, name: cam.device?.name ?? cam.deviceId, cameras: [] };
    group.cameras.push(cam);
    groups.set(cam.deviceId, group);
  }
  const sorted = [...groups.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return standalone.length > 0 ? [...sorted, { id: null, name: null, cameras: standalone }] : sorted;
}

/** An empty selection means every camera. */
export function applyCameraSelection(cameras: any[], selectedIds: string[], onlyOffline: boolean): any[] {
  const selected = new Set(selectedIds);
  return sortCamerasNaturally(cameras).filter(
    (cam) => (selected.size === 0 || selected.has(cam.id)) && (!onlyOffline || cam.operationalStatus !== 'online'),
  );
}
