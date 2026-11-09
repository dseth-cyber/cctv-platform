import { describe, expect, it } from 'vitest';
import { clockDriftParts, compareDeviceInfo, formatCapacity, needsNtp, summarizeDeviceHealth } from './deviceHealth';

const health = (over = {}) => ({ checkedAt: '', reachable: true, loginFailed: false, reportedModel: null, disks: [], clockDriftSeconds: 0, oldestRecording: null, retentionDays: null, notRecording: [], channelsChecked: 0, problems: [], ...over });

describe('summarizeDeviceHealth', () => {
  it('says nothing when never read', () => expect(summarizeDeviceHealth(null)).toBe('unknown'));
  it('says all is well with no problems', () => expect(summarizeDeviceHealth(health())).toBe('ok'));
  it('flags problems', () => expect(summarizeDeviceHealth(health({ problems: ['disk_fault'] }))).toBe('problem'));
  it('marks an old reading rather than calling it healthy', () => expect(summarizeDeviceHealth(health({ reachable: false, problems: ['disk_fault'] }))).toBe('stale'));
});

describe('clockDriftParts', () => {
  it('splits a difference into minutes and seconds', () => {
    expect(clockDriftParts(201)).toEqual({ direction: 'ahead', minutes: 3, seconds: 21 });
    expect(clockDriftParts(-680)).toEqual({ direction: 'behind', minutes: 11, seconds: 20 });
  });
  it('calls a few seconds even', () => expect(clockDriftParts(-3)?.direction).toBe('even'));
  it('knows when there is no reading', () => expect(clockDriftParts(null)).toBeNull());
});

describe('formatCapacity', () => {
  it('reads as the size on the label', () => {
    expect(formatCapacity(1907729)).toBe('2 TB');
    expect(formatCapacity(3815447)).toBe('4 TB');
    expect(formatCapacity(11444224)).toBe('12 TB');
    expect(formatCapacity(476940)).toBe('500 GB');
  });
  it('shows a dash with no reading', () => expect(formatCapacity(null)).toBe('—'));
});

describe('compareDeviceInfo', () => {
  const reading = { brand: 'Hikvision', model: 'DS-7216HQHI-K2', serialNumber: 'S1', macAddress: 'aa:bb', firmwareVersion: 'V4', deviceType: 'dvr' };

  it('fills empty boxes and leaves type and brand to their defaults', () => {
    const { fill, differs } = compareDeviceInfo({ brand: 'Hikvision', deviceType: 'dvr' }, reading);
    expect(fill).toEqual({ model: 'DS-7216HQHI-K2', serialNumber: 'S1', macAddress: 'aa:bb', firmwareVersion: 'V4' });
    expect(differs).toEqual([]);
  });

  it('never writes over what is there, and asks instead', () => {
    const { fill, differs } = compareDeviceInfo({ model: 'DS-7208HQHI-K1', deviceType: 'nvr', brand: 'Hikvision' }, reading);
    expect(fill.model).toBeUndefined();
    expect(differs).toEqual([
      { field: 'deviceType', saved: 'nvr', reported: 'dvr' },
      { field: 'model', saved: 'DS-7208HQHI-K1', reported: 'DS-7216HQHI-K2' },
    ]);
  });

  it('counts the same thing written differently as the same', () => {
    expect(compareDeviceInfo({ macAddress: 'AA:BB ' }, reading).differs).toEqual([]);
  });

  it('treats Hilook and Hikvision as one family', () => {
    expect(compareDeviceInfo({ brand: 'Hilook' }, reading).differs).toEqual([]);
    expect(compareDeviceInfo({ brand: 'Dahua' }, reading).differs).toEqual([{ field: 'brand', saved: 'Dahua', reported: 'Hikvision' }]);
  });

  it('ignores what the device did not say', () => {
    expect(compareDeviceInfo({ model: 'X' }, {}).differs).toEqual([]);
  });
});

describe('needsNtp', () => {
  const on = (clockMode: string | null, problems: string[] = [], reachable = true) => health({ clockMode, problems, reachable }) as any;
  it('offers a Hikvision recorder on hand-set time, or on NTP but still off', () => {
    expect(needsNtp('Hikvision', on('manual'))).toBe(true);
    expect(needsNtp('HiLook', on('NTP', ['clock_drift']))).toBe(true);
  });
  it('leaves alone one already right, one not answering, one not read yet, and other brands', () => {
    expect(needsNtp('Hikvision', on('NTP'))).toBe(false);
    expect(needsNtp('Hikvision', on('manual', [], false))).toBe(false);
    expect(needsNtp('Hikvision', on(null))).toBe(false);
    expect(needsNtp('Hikvision', null)).toBe(false);
    expect(needsNtp('Dahua', on('manual'))).toBe(false);
  });
});
