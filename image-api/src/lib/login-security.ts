import { getRedisClient } from './redis.js';
import { getAllConfigs } from '../modules/system-config/system-config.service.js';

// Tracked per attempted username (not per IP, and regardless of whether the username
// corresponds to a real account) — a distributed brute force spreads across many IPs to
// dodge the per-IP rate limit on /auth/login, but still has to keep guessing against the
// same username. Tracking by username-that-doesn't-exist too (rather than only real
// accounts) avoids leaking account existence through lockout behavior.
const FAIL_PREFIX = 'login:fail:';
const LOCK_PREFIX = 'login:lock:';

function normalize(username: string): string {
  return username.toLowerCase().trim();
}

export async function isLocked(username: string): Promise<boolean> {
  const redis = getRedisClient();
  return (await redis.get(LOCK_PREFIX + normalize(username))) !== null;
}

interface FailedLoginResult {
  count: number;
  justLocked: boolean;
  maxAttempts: number;
  windowMinutes: number;
  lockoutMinutes: number;
}

/** Call after a failed login. Returns the running count and whether this call is the one that crossed the threshold (so the caller only alerts once per lockout, not on every attempt after). */
export async function recordFailedLogin(username: string): Promise<FailedLoginResult> {
  const redis = getRedisClient();
  const configs = await getAllConfigs();
  const maxAttempts = Number(configs.login_max_failed_attempts?.value ?? 5);
  const windowMinutes = Number(configs.login_failure_window_minutes?.value ?? 10);
  const lockoutMinutes = Number(configs.login_lockout_minutes?.value ?? 15);

  const key = FAIL_PREFIX + normalize(username);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowMinutes * 60);

  let justLocked = false;
  if (count >= maxAttempts) {
    const lockKey = LOCK_PREFIX + normalize(username);
    const alreadyLocked = await redis.get(lockKey);
    if (!alreadyLocked) {
      await redis.set(lockKey, '1', 'EX', lockoutMinutes * 60);
      justLocked = true;
    }
  }
  return { count, justLocked, maxAttempts, windowMinutes, lockoutMinutes };
}

/** Call after a successful login — a real login clears any accumulated failure count. */
export async function clearFailedLogins(username: string): Promise<void> {
  const redis = getRedisClient();
  const key = normalize(username);
  await redis.del(FAIL_PREFIX + key, LOCK_PREFIX + key);
}

/** Admin manual override — clears a lockout (and the failure counter) early. Returns whether the account was actually locked, so the caller can tell the admin "unlocked" vs "wasn't locked to begin with". */
export async function unlockUser(username: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = normalize(username);
  const wasLocked = (await redis.get(LOCK_PREFIX + key)) !== null;
  await redis.del(FAIL_PREFIX + key, LOCK_PREFIX + key);
  return wasLocked;
}
