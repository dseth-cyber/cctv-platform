/** Same bounds as the system value `live_snapshot_refresh_seconds`, so no level can ask for more than the system allows. */
export const MIN_REFRESH_SECONDS = 10;
export const MAX_REFRESH_SECONDS = 600;

export type RefreshSource = 'camera' | 'group' | 'device' | 'system';

const usable = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= MIN_REFRESH_SECONDS && v <= MAX_REFRESH_SECONDS;

/**
 * How often a camera's still image is refreshed: the most specific level that sets a value wins
 * (camera, then its groups, then its DVR/NVR, then the system). A camera in several groups takes the
 * shortest of them. The per-device and overall fetch limits still apply on top, so a short value
 * can make images arrive late but never puts more load on a recorder than those limits.
 */
export function resolveRefreshSeconds(levels: {
  camera?: number | null;
  groups?: Array<number | null | undefined>;
  device?: number | null;
  system: number;
}): { seconds: number; source: RefreshSource } {
  if (usable(levels.camera)) return { seconds: levels.camera, source: 'camera' };
  const groups = (levels.groups ?? []).filter(usable);
  if (groups.length > 0) return { seconds: Math.min(...groups), source: 'group' };
  if (usable(levels.device)) return { seconds: levels.device, source: 'device' };
  return { seconds: levels.system, source: 'system' };
}
