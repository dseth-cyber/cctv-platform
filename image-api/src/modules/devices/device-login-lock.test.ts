import { describe, expect, it } from 'vitest';
import { parseLoginLock } from '../device-playback/hikvision-recorder.js';
import { loginOnHold } from './device-health.service.js';

describe('parseLoginLock', () => {
  it('reads how long a locked account stays shut, as a real recorder answered', () => {
    const body = '<userCheck><statusValue>401</statusValue><statusString>Unauthorized</statusString><lockStatus>lock</lockStatus><unlockTime>1405</unlockTime><retryLoginTime>0</retryLoginTime></userCheck>';
    expect(parseLoginLock(body)).toBe(1405);
  });

  it('says not locked for a plain wrong password or an empty answer', () => {
    expect(parseLoginLock('<userCheck><statusValue>401</statusValue><lockStatus>unlock</lockStatus><retryLoginTime>4</retryLoginTime></userCheck>')).toBeNull();
    expect(parseLoginLock('')).toBeNull();
  });
});

describe('loginOnHold', () => {
  const now = 1_000_000;
  it('waits on a wrong password until it changes', () => {
    expect(loginOnHold({ password: 'enc-a', retryAt: null }, 'enc-a', now)).toBe(true);
    expect(loginOnHold({ password: 'enc-a', retryAt: null }, 'enc-b', now)).toBe(false);
  });

  it('waits out a lock, then tries again', () => {
    expect(loginOnHold({ password: 'enc-a', retryAt: now + 1 }, 'enc-a', now)).toBe(true);
    expect(loginOnHold({ password: 'enc-a', retryAt: now }, 'enc-a', now)).toBe(false);
  });

  it('has nothing to wait for when nothing failed', () => {
    expect(loginOnHold(undefined, 'enc-a', now)).toBe(false);
  });
});
