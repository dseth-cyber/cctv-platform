import { getPrisma } from '../../lib/prisma.js';

/**
 * Switching a camera on or off, wherever it is done from: the camera form or a recorder's channel list.
 * Off means not watched, no alerts and not in the live room. On starts it fresh, for the health check to judge.
 */
export function enabledCameraFields(enabled: boolean, hasSource: boolean) {
  return {
    enabled,
    status: enabled && hasSource ? ('active' as const) : ('inactive' as const),
    operationalStatus: 'unknown' as const,
    operationalReason: null,
    operationalSince: new Date(),
  };
}

/** An alert about a camera switched off on purpose has nothing left to report. */
export async function closeOfflineAlerts(cameraId: string) {
  await getPrisma().alert.updateMany({
    where: { source: cameraId, alertType: 'camera_offline', resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
}
