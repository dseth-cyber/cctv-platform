import { describe, expect, it } from 'vitest';
import { resolveRefreshSeconds } from './refresh-tiers.js';

describe('resolveRefreshSeconds', () => {
  it('the most specific level wins', () => {
    expect(resolveRefreshSeconds({ camera: 15, groups: [60], device: 120, system: 30 })).toEqual({ seconds: 15, source: 'camera' });
    expect(resolveRefreshSeconds({ camera: null, groups: [60], device: 120, system: 30 })).toEqual({ seconds: 60, source: 'group' });
    expect(resolveRefreshSeconds({ groups: [], device: 120, system: 30 })).toEqual({ seconds: 120, source: 'device' });
    expect(resolveRefreshSeconds({ system: 30 })).toEqual({ seconds: 30, source: 'system' });
  });

  it('a camera in several groups takes the shortest; groups without a value do not count', () => {
    expect(resolveRefreshSeconds({ groups: [120, null, 20, 60], system: 30 })).toEqual({ seconds: 20, source: 'group' });
    expect(resolveRefreshSeconds({ groups: [null, undefined], device: 90, system: 30 })).toEqual({ seconds: 90, source: 'device' });
  });

  it('a value outside 10-600 seconds is ignored rather than trusted', () => {
    expect(resolveRefreshSeconds({ camera: 2, device: 5000, system: 30 })).toEqual({ seconds: 30, source: 'system' });
  });
});
