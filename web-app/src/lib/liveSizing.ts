/**
 * Sizing for the way this system runs today: recorders (DVR/NVR) keep the footage, the server only passes live video
 * on while someone watches. Load follows how many people watch, not how many cameras there are.
 *
 * CPU is counted in threads (logical CPUs), as Docker measures it: 100% is one thread.
 * Numbers measured on the Dev machine on 2026-11-09 (i5-13400, 103 cameras, Docker Desktop):
 *   idle, nobody watching: ~2.5% of one core in total  -> about 0.00025 core per camera (health checks)
 *   a 4x4 wall (16 streams): MediaMTX ~17% of one core -> about 0.011 core and ~4 MB RAM per stream
 * A clip or H.265 playback converted for the browser is a real transcode; that one was NOT measured: 1.5 cores and
 * 0.5 GB each is an estimate, and the page says so.
 */
export const MEASURED = {
  coresPerCamera: 0.025 / 103,
  coresPerStream: 0.17 / 16,
  ramMbPerStream: 4,
  baseRamGb: 4, // OS, database, services and cache together (the containers alone used ~0.5 GB)
  estimatedCoresPerConversion: 1.5,
  estimatedRamGbPerConversion: 0.5,
  measuredOn: '2026-11-09',
};

/** How much to keep in reserve above the expected use, so a busy moment slows the system down rather than stops it. */
export const HEADROOM = 2;

export interface LiveSizingInput {
  cameras: number;
  /** People watching at the same time. */
  viewers: number;
  /** Tiles each of them has open (a 4x4 wall is 16). */
  streamsPerViewer: number;
  /** Clips or H.265 playbacks being converted at the same moment. */
  conversions: number;
  mainKbps: number;
  subKbps: number;
}

const pickAtLeast = (need: number, steps: number[]) => steps.find((s) => s >= need) ?? steps[steps.length - 1];

export function liveOnlySizing(input: LiveSizingInput) {
  const cameras = Math.max(1, Math.round(input.cameras));
  const viewers = Math.max(0, Math.round(input.viewers));
  const perViewer = Math.max(1, Math.round(input.streamsPerViewer));
  const conversions = Math.max(0, Math.round(input.conversions));
  const sessions = viewers * perViewer;
  // Each person has one camera large (main stream) and the rest as tiles (sub stream).
  const perViewerKbps = input.mainKbps + (perViewer - 1) * input.subKbps;
  const egressMbps = (viewers * perViewerKbps) / 1000;
  // Pulled from the recorders: at most one copy per camera, however many watch it. Worst case, nobody shares.
  const pulled = Math.min(cameras, sessions);
  const ingressMbps = sessions === 0 ? 0 : (pulled * (perViewerKbps / perViewer)) / 1000;

  const cpuMeasured = cameras * MEASURED.coresPerCamera + sessions * MEASURED.coresPerStream;
  const cpuEstimated = conversions * MEASURED.estimatedCoresPerConversion;
  const coresUsed = cpuMeasured + cpuEstimated;
  const ramUsedGb = MEASURED.baseRamGb + (sessions * MEASURED.ramMbPerStream) / 1024 + conversions * MEASURED.estimatedRamGbPerConversion;

  const recommendedThreads = pickAtLeast(Math.max(8, coresUsed * HEADROOM), [8, 16, 32, 64, 128]);
  const recommendedRamGb = pickAtLeast(Math.max(16, ramUsedGb * HEADROOM), [16, 32, 64, 128]);
  const nic = egressMbps > 2000 ? '10 GbE' : egressMbps > 700 ? '2.5 GbE' : '1 GbE';

  const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
  return {
    sessions,
    pulledStreams: pulled,
    ingressMbps: round(ingressMbps),
    egressMbps: round(egressMbps),
    threadsUsed: round(coresUsed, 2),
    threadsFromEstimate: round(cpuEstimated, 2),
    ramUsedGb: round(ramUsedGb),
    recommendedThreads,
    recommendedRamGb,
    nic,
  };
}
