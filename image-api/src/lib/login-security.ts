import { getRedisClient } from './redis.js';
import { getAllConfigs } from '../modules/system-config/system-config.service.js';

// Failed sign-ins are counted at two levels (whether or not the username is a real account, so the lockout does not
// reveal which accounts exist):
//
// - per username + client address: login_max_failed_attempts (default 5) in the window locks that username FROM
//   THAT ADDRESS only. Since the site is reachable from the internet (Cloudflare tunnel, 2026-11-17), a lock on the
//   username alone let anyone lock any account (admin included) for everyone with five wrong passwords.
// - per username, all addresses together: GLOBAL_FACTOR times as many (default 20) locks the username everywhere.
//   That still stops a guessing run spread over many addresses, which has to keep trying the same username.
//
// The address must be the real client's (Fastify request.ip behind nginx's real_ip; never a raw X-Forwarded-For).
const FAIL_PREFIX = 'login:fail:';
const LOCK_PREFIX = 'login:lock:';
const GLOBAL_FACTOR = 4;

function normalize(username: string): string {
  return username.toLowerCase().trim();
}

/** Redis glob characters in a username must not widen a SCAN pattern to other accounts. */
function globEscape(value: string): string {
  return value.replace(/[*?[\]\\]/g, (c) => '\\' + c);
}

function addressOf(ip?: string): string {
  return (ip ?? '').trim() || 'unknown';
}

/** Redis keys for one username: the per-address pair and the all-addresses total. */
export function loginKeys(username: string, ip?: string) {
  const user = normalize(username);
  const pair = `${user}|${addressOf(ip)}`;
  return {
    pairFail: FAIL_PREFIX + 'ip:' + pair,
    pairLock: LOCK_PREFIX + 'ip:' + pair,
    userFail: FAIL_PREFIX + 'user:' + user,
    userLock: LOCK_PREFIX + 'user:' + user,
    pairLockPattern: LOCK_PREFIX + 'ip:' + globEscape(user) + '|*',
    pairFailPattern: FAIL_PREFIX + 'ip:' + globEscape(user) + '|*',
  };
}

async function scanKeys(pattern: string): Promise<string[]> {
  const redis = getRedisClient();
  const found: string[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = next;
    found.push(...keys);
  } while (cursor !== '0');
  return found;
}

/**
 * Is this username locked for this address? With no address (the users page asking "is this account locked at
 * all"), true when it is locked everywhere or from any address.
 */
export async function isLocked(username: string, ip?: string): Promise<boolean> {
  const redis = getRedisClient();
  const k = loginKeys(username, ip);
  if ((await redis.get(k.userLock)) !== null) return true;
  if (ip !== undefined) return (await redis.get(k.pairLock)) !== null;
  return (await scanKeys(k.pairLockPattern)).length > 0;
}

interface FailedLoginResult {
  /** Failures of this username from this address in the window. */
  count: number;
  /** Failures of this username from all addresses in the window. */
  totalCount: number;
  /** This call is the one that locked something (alert once per lockout, not on every attempt after). */
  justLocked: boolean;
  /** What got locked by this call. */
  lockedScope: 'address' | 'everywhere' | null;
  maxAttempts: number;
  maxAttemptsTotal: number;
  windowMinutes: number;
  lockoutMinutes: number;
}

/** Call after a failed login, with the client's real address. */
export async function recordFailedLogin(username: string, ip?: string): Promise<FailedLoginResult> {
  const redis = getRedisClient();
  const configs = await getAllConfigs();
  const maxAttempts = Number(configs.login_max_failed_attempts?.value ?? 5);
  const windowMinutes = Number(configs.login_failure_window_minutes?.value ?? 10);
  const lockoutMinutes = Number(configs.login_lockout_minutes?.value ?? 15);
  const maxAttemptsTotal = maxAttempts * GLOBAL_FACTOR;
  const k = loginKeys(username, ip);

  const count = await redis.incr(k.pairFail);
  if (count === 1) await redis.expire(k.pairFail, windowMinutes * 60);
  const totalCount = await redis.incr(k.userFail);
  if (totalCount === 1) await redis.expire(k.userFail, windowMinutes * 60);

  let lockedScope: FailedLoginResult['lockedScope'] = null;
  // SET NX: only the call that creates the lock reports it.
  if (totalCount >= maxAttemptsTotal && (await redis.set(k.userLock, '1', 'EX', lockoutMinutes * 60, 'NX')) === 'OK') {
    lockedScope = 'everywhere';
  } else if (count >= maxAttempts && (await redis.set(k.pairLock, '1', 'EX', lockoutMinutes * 60, 'NX')) === 'OK') {
    lockedScope = 'address';
  }
  return { count, totalCount, justLocked: lockedScope !== null, lockedScope, maxAttempts, maxAttemptsTotal, windowMinutes, lockoutMinutes };
}

/**
 * Call after a successful login: clears this address's failures for the username. The all-addresses count is left
 * to expire, so a correct password from one place does not wipe out a guessing run from elsewhere.
 */
export async function clearFailedLogins(username: string, ip?: string): Promise<void> {
  const redis = getRedisClient();
  const k = loginKeys(username, ip);
  await redis.del(k.pairFail, k.pairLock);
}

/** Admin manual override — clears every lock and counter of the username. Returns whether anything was locked. */
export async function unlockUser(username: string): Promise<boolean> {
  const redis = getRedisClient();
  const k = loginKeys(username);
  const pairLocks = await scanKeys(k.pairLockPattern);
  const pairFails = await scanKeys(k.pairFailPattern);
  const wasLocked = pairLocks.length > 0 || (await redis.get(k.userLock)) !== null;
  await redis.del(k.userFail, k.userLock, ...pairLocks, ...pairFails);
  return wasLocked;
}
