import { getRedisClient } from '../../lib/redis.js';
import { getPrisma } from '../../lib/prisma.js';

export type PressureState = 'normal' | 'warning' | 'pressure' | 'critical' | 'emergency';

export interface PressureThresholds {
  pressureWarningPercent: number;
  pressureStartPercent: number;
  pressureStopPercent: number;
  pressureCriticalPercent: number;
  pressureEmergencyPercent: number;
}

const STATE_ORDER: PressureState[] = ['normal', 'warning', 'pressure', 'critical', 'emergency'];

function stateKey(providerId: string): string {
  return `storage:pressure:${providerId}:state`;
}

function candidateKey(providerId: string): string {
  return `storage:pressure:${providerId}:candidate`;
}

// Determines the raw (un-debounced) pressure state for a given usage percentage.
// Hysteresis only applies to the pressure<->normal boundary (start/stop are different
// values); the other boundaries are single thresholds since they only ever get more
// severe as usage climbs, and dropping back down naturally falls through to a lower
// state on its own once usage recedes below its own threshold.
export function computeRawState(percentUsed: number, t: PressureThresholds, currentState: PressureState): PressureState {
  if (percentUsed >= t.pressureEmergencyPercent) return 'emergency';
  if (percentUsed >= t.pressureCriticalPercent) return 'critical';

  if (percentUsed >= t.pressureStartPercent) return 'pressure';
  // Hysteresis: once cleanup has started (state is pressure/critical/emergency), stay in
  // "pressure" until usage drops all the way to the stop percent, not just below start.
  if ((currentState === 'pressure' || currentState === 'critical' || currentState === 'emergency') && percentUsed >= t.pressureStopPercent) {
    return 'pressure';
  }

  if (percentUsed >= t.pressureWarningPercent) return 'warning';
  return 'normal';
}

export function isMoreSevere(a: PressureState, b: PressureState): boolean {
  return STATE_ORDER.indexOf(a) > STATE_ORDER.indexOf(b);
}

interface StoredState {
  state: PressureState;
  percent: number;
  checkedAt: string;
}

export async function readPressureState(providerId: string): Promise<StoredState | null> {
  const redis = getRedisClient();
  const raw = await redis.get(stateKey(providerId));
  if (raw) {
    try {
      return JSON.parse(raw) as StoredState;
    } catch {
      // fall through to DB fallback
    }
  }

  const prisma = getPrisma();
  const provider = await prisma.storageProvider.findUnique({
    where: { id: providerId },
    select: { currentPressureState: true, currentPressureSince: true },
  });
  if (!provider) return null;
  return {
    state: provider.currentPressureState as PressureState,
    percent: 0,
    checkedAt: provider.currentPressureSince?.toISOString() ?? new Date().toISOString(),
  };
}

export async function writePressureState(providerId: string, state: PressureState, percent: number): Promise<void> {
  const redis = getRedisClient();
  const payload: StoredState = { state, percent, checkedAt: new Date().toISOString() };
  await redis.set(stateKey(providerId), JSON.stringify(payload));
}

// Debounce: a raw state must be observed for `requiredTicks` consecutive checks before
// it's confirmed as the new state. Prevents rapid flapping when usage hovers near a
// threshold boundary (same problem P35's camera-health-monitor solves for online/offline).
export async function debounceState(
  providerId: string,
  rawState: PressureState,
  confirmedState: PressureState,
  requiredTicks: number,
): Promise<PressureState> {
  if (rawState === confirmedState) {
    const redis = getRedisClient();
    await redis.del(candidateKey(providerId));
    return confirmedState;
  }

  const redis = getRedisClient();
  const raw = await redis.get(candidateKey(providerId));
  let candidate: { state: PressureState; count: number } = { state: rawState, count: 0 };
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.state === rawState) candidate = parsed;
    } catch {
      // ignore, start fresh
    }
  }

  candidate.count += 1;

  if (candidate.count >= requiredTicks) {
    await redis.del(candidateKey(providerId));
    return rawState;
  }

  await redis.set(candidateKey(providerId), JSON.stringify(candidate));
  return confirmedState;
}
