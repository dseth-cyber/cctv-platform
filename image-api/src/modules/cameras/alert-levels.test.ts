import { describe, expect, it } from 'vitest';
import { isDelayOver, offlineThresholdMs, outageElapsedMs, resolveAlertLevel, type AlertLevel } from './alert-levels.js';

const critical: AlertLevel = { code: 'critical', alertDelayMinutes: 1, incidentDelayMinutes: 0 };
const normal: AlertLevel = { code: 'normal', alertDelayMinutes: 5, incidentDelayMinutes: 15, isDefault: true };
const silent: AlertLevel = { code: 'silent', alertDelayMinutes: null, incidentDelayMinutes: null };
const levels = [critical, normal, silent];

describe('resolveAlertLevel', () => {
  it('prefers the camera over its device', () => {
    expect(resolveAlertLevel('silent', 'critical', levels).code).toBe('silent');
  });

  it('follows the device when the camera has none', () => {
    expect(resolveAlertLevel(null, 'critical', levels).code).toBe('critical');
  });

  it('uses the default when neither has one', () => {
    expect(resolveAlertLevel(null, null, levels).code).toBe('normal');
  });

  it('treats a level no longer in the list as not set', () => {
    expect(resolveAlertLevel('gone', 'critical', levels).code).toBe('critical');
    expect(resolveAlertLevel('gone', 'gone', levels).code).toBe('normal');
  });

  it('still alerts when the whole list is gone', () => {
    expect(resolveAlertLevel(null, null, [])).toMatchObject({ alertDelayMinutes: 5, incidentDelayMinutes: 15 });
  });
});

describe('offlineThresholdMs', () => {
  it('shortens the threshold for a level that alerts sooner', () => {
    expect(offlineThresholdMs(120_000, critical)).toBe(60_000);
  });

  it('leaves it alone for a level that alerts later or never', () => {
    expect(offlineThresholdMs(120_000, normal)).toBe(120_000);
    expect(offlineThresholdMs(120_000, silent)).toBe(120_000);
  });
});

describe('outageElapsedMs', () => {
  const now = Date.parse('2026-11-07T10:00:00Z');

  it('counts from the last answer when that is earlier', () => {
    expect(outageElapsedMs({ lastPolledAt: '2026-11-07T09:50:00Z', operationalSince: '2026-11-07T09:52:00Z' }, now)).toBe(600_000);
  });

  it('counts from going offline for a channel whose recorder still answers', () => {
    expect(outageElapsedMs({ lastPolledAt: '2026-11-07T09:59:50Z', operationalSince: '2026-11-07T09:50:00Z' }, now)).toBe(600_000);
  });

  it('is zero with nothing to count from', () => {
    expect(outageElapsedMs({}, now)).toBe(0);
  });
});

describe('isDelayOver', () => {
  it('is never over for a level that does not raise this', () => {
    expect(isDelayOver(null, 10 ** 9)).toBe(false);
  });

  it('allows for the check not running exactly on the minute', () => {
    expect(isDelayOver(5, 299_000)).toBe(true);
    expect(isDelayOver(5, 290_000)).toBe(false);
  });

  it('is over at once for a delay of zero', () => {
    expect(isDelayOver(0, 0)).toBe(true);
  });
});
