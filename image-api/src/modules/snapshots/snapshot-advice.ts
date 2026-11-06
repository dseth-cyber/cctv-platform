export interface AdviceInput {
  cameras: number;
  /** Cameras on the busiest single DVR/NVR or host. */
  busiestDeviceCameras: number;
  refreshSeconds: number;
  deviceConcurrency: number;
  globalConcurrency: number;
  /** Measured on this system, or null before anything has been fetched. */
  avgMs: number | null;
  avgBytes: number | null;
  samples: number;
}

// Measured on the one real camera so far (HiLook, 2026-11-06); used only until this system has its own numbers.
const ASSUMED_MS = 400;
const ASSUMED_BYTES = 46 * 1024;
const MIN_SAMPLES = 10;
const REFRESH_CHOICES = [10, 30, 60, 120, 300, 600];

/**
 * What a set of snapshot settings means on this system, worst case: every camera on someone's screen.
 * Purely informative: the scheduler's limits hold whatever is chosen, so a poor choice makes images
 * older but cannot overload anything.
 */
export function computeSnapshotAdvice(input: AdviceInput) {
  const measured = input.samples >= MIN_SAMPLES && input.avgMs !== null && input.avgBytes !== null;
  const seconds = (measured ? input.avgMs! : ASSUMED_MS) / 1000;
  const bytes = measured ? input.avgBytes! : ASSUMED_BYTES;

  const imagesPerSecond = input.cameras / input.refreshSeconds;
  const achievableSeconds = Math.max(
    (input.cameras * seconds) / input.globalConcurrency,
    (input.busiestDeviceCameras * seconds) / input.deviceConcurrency,
  );
  const limitedBy = (input.busiestDeviceCameras * seconds) / input.deviceConcurrency >= (input.cameras * seconds) / input.globalConcurrency
    ? 'device' as const
    : 'global' as const;
  const keepsUp = achievableSeconds <= input.refreshSeconds;
  // Keep a quarter spare, so one slow device does not put every camera behind.
  const recommendedRefreshSeconds = REFRESH_CHOICES.find((c) => c >= achievableSeconds * 1.25) ?? REFRESH_CHOICES[REFRESH_CHOICES.length - 1];

  return {
    source: measured ? 'measured' as const : 'assumed' as const,
    samples: input.samples,
    cameras: input.cameras,
    busiestDeviceCameras: input.busiestDeviceCameras,
    avgMs: Math.round(seconds * 1000),
    avgKb: Math.round(bytes / 1024),
    imagesPerSecond: Math.round(imagesPerSecond * 10) / 10,
    bandwidthMbps: Math.round(((imagesPerSecond * bytes * 8) / 1_000_000) * 10) / 10,
    achievableSeconds: Math.max(1, Math.ceil(achievableSeconds)),
    limitedBy,
    keepsUp,
    recommendedRefreshSeconds,
  };
}
