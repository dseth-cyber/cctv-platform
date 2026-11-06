import { describe, expect, it } from 'vitest';
import { summarizeLocations } from './locationSummary';

const cam = (over: object) => ({ enabled: true, operationalStatus: 'online', siteId: 's', zoneId: 'z', ...over });

describe('summarizeLocations', () => {
  const cameras = [
    cam({}),
    cam({ operationalStatus: 'offline' }),
    cam({ enabled: false }),
    cam({ zoneId: null }),
    cam({ siteId: null, zoneId: null }),
    cam({ enabled: false, siteId: null, zoneId: null }), // an old test camera, switched off
  ];
  const devices = [{ siteId: 's', zoneId: 'z', totalChannels: 8, enabledChannels: [1, 2, 3] }, { siteId: null, zoneId: null, totalChannels: 4, enabledChannels: [] }];
  const out = summarizeLocations(cameras, devices);

  it('counts what is in a zone', () => {
    expect(out.byZone.get('z')).toEqual({ inUse: 2, online: 1, problem: 1, switchedOff: 1, devices: 1, spare: 5 });
  });

  it('counts a camera with no zone in its site', () => {
    expect(out.bySite.get('s')).toEqual({ inUse: 3, online: 2, problem: 1, switchedOff: 1, devices: 1, spare: 5 });
    expect(out.noZoneBySite.get('s')).toBe(1);
  });

  it('asks about cameras in use only', () => {
    expect([out.noSite, out.noZone, out.inUse]).toEqual([1, 2, 4]);
  });

  it('leaves spare channels of a recorder with no place out of every place', () => {
    expect([...out.bySite.keys()]).toEqual(['s']);
  });
});
