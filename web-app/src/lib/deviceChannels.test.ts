import { describe, expect, it } from 'vitest';
import { cloneIpPlaceholder, countSpareBy, formatChannelRanges, isValidIPv4, spareChannels, uniqueCopyName } from './deviceChannels';
import { applyLocationFilter, NO_LOCATION } from './cameraFilter';

describe('addresses', () => {
  it('accepts an IPv4 address and nothing else', () => {
    for (const good of ['192.168.30.203', '10.0.0.1', '0.0.0.0', '255.255.255.255']) expect(isValidIPv4(good)).toBe(true);
    for (const bad of ['192.168.30.xxx', '192.168.30', '192.168.30.256', '192.168.030.1', '1.2.3.4.5', 'dvr.local', '', '192.168.30.1 x']) expect(isValidIPv4(bad)).toBe(false);
  });

  it('a clone cannot keep its source address', () => {
    expect(cloneIpPlaceholder('192.168.30.203')).toBe('192.168.30.xxx');
    expect(isValidIPv4(cloneIpPlaceholder('192.168.30.203'))).toBe(false);
  });
});

describe('clone name', () => {
  it('adds Copy, then a number', () => {
    expect(uniqueCopyName('DVR A', ['DVR A'])).toBe('DVR A Copy');
    expect(uniqueCopyName('DVR A', ['DVR A', 'dvr a copy'])).toBe('DVR A Copy 2');
    expect(uniqueCopyName('DVR A', ['DVR A Copy', 'DVR A Copy 2'])).toBe('DVR A Copy 3');
  });
});

describe('spare channels', () => {
  const devices = [
    { name: 'full', totalChannels: 4, enabledChannels: [1, 2, 3, 4], deviceType: 'dvr' },
    { name: 'some', totalChannels: 8, enabledChannels: [1, 2, 3], deviceType: 'nvr' },
    { name: 'one', totalChannels: 8, enabledChannels: [1, 2, 3, 4, 5, 6, 7], deviceType: 'dvr' },
    { name: 'new', totalChannels: 2, deviceType: 'dvr' },
  ];

  it('lists only recorders with room, most room first', () => {
    const rows = spareChannels(devices);
    expect(rows.map((r) => [r.device.name, r.spare])).toEqual([['some', [4, 5, 6, 7, 8]], ['new', [1, 2]], ['one', [8]]]);
  });

  it('ignores a channel number past the end of the recorder', () => {
    expect(spareChannels([{ totalChannels: 2, enabledChannels: [1, 5] }])[0]).toMatchObject({ inUse: 1, spare: [2] });
  });

  it('counts by what can actually be swapped', () => {
    expect(countSpareBy(spareChannels(devices), (r) => r.device.deviceType)).toEqual([['nvr', 5], ['dvr', 3]]);
  });

  it('reads as ranges', () => {
    expect(formatChannelRanges([5, 1, 2, 3, 8])).toBe('1-3, 5, 8');
    expect(formatChannelRanges([4])).toBe('4');
    expect(formatChannelRanges([])).toBe('');
  });
});

describe('location filter', () => {
  const cams = [
    { id: 'a', siteId: 's1', zoneId: 'z1' },
    { id: 'b', siteId: 's1', zoneId: 'z2' },
    { id: 'c', siteId: 's2', zoneId: null },
    { id: 'd', siteId: null, zoneId: null },
  ];
  const ids = (sites: string[], zones: string[]) => applyLocationFilter(cams, sites, zones).map((c) => c.id);

  it('shows everything when nothing is chosen', () => expect(ids([], [])).toEqual(['a', 'b', 'c', 'd']));
  it('narrows by site', () => expect(ids(['s1'], [])).toEqual(['a', 'b']));
  it('narrows by zone within the site', () => expect(ids(['s1'], ['z2'])).toEqual(['b']));
  it('finds cameras with no place yet', () => {
    expect(ids([NO_LOCATION], [])).toEqual(['d']);
    expect(ids([], [NO_LOCATION])).toEqual(['c', 'd']);
  });
});
