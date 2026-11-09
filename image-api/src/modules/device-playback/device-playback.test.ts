import { describe, expect, it } from 'vitest';
import {
  addSeconds,
  clipRanges,
  isHevc,
  mergeRanges,
  parseClock,
  parseSearch,
  playbackUrl,
  secondsBetween,
  toCompact,
} from './hikvision-recorder.js';
import { checkSessionLimits, effectiveTranscodeLimit } from './device-playback.service.js';

describe('recorder times', () => {
  it('reads how far the recorder clock is from the server', () => {
    // As returned by the real DS-7208HQHI-K1: 3 min 20 s ahead.
    const xml = '<Time><timeMode>manual</timeMode><localTime>2026-11-06T10:00:03+07:00</localTime><timeZone>CST-7:00:00</timeZone></Time>';
    const clock = parseClock(xml, new Date('2026-11-06T02:56:43Z').getTime());
    expect(clock).toEqual({ deviceTime: '2026-11-06T10:00:03', driftSeconds: 200, mode: 'manual' });
    expect(parseClock('<Time></Time>', 0)).toBeNull();
  });

  it('keeps the recorder wall clock, whose trailing Z does not mean UTC', () => {
    const xml = '<CMSearchResult><responseStatusStrg>MORE</responseStatusStrg><matchList>'
      + '<searchMatchItem><timeSpan><startTime>2026-11-05T08:00:00Z</startTime><endTime>2026-11-05T08:30:00Z</endTime></timeSpan></searchMatchItem>'
      + '</matchList></CMSearchResult>';
    expect(parseSearch(xml)).toEqual({ items: [{ start: '2026-11-05T08:00:00', end: '2026-11-05T08:30:00' }], more: true });
    expect(parseSearch('<CMSearchResult><responseStatusStrg>NO MATCHES</responseStatusStrg></CMSearchResult>')).toEqual({ items: [], more: false });
    expect(toCompact('2026-11-05T08:00:00')).toBe('20261105T080000Z');
  });

  it('does arithmetic across midnight', () => {
    expect(addSeconds('2026-11-05T23:59:30', 60)).toBe('2026-11-06T00:00:30');
    expect(secondsBetween('2026-11-05T23:59:30', '2026-11-06T00:00:30')).toBe(60);
  });
});

describe('recording blocks', () => {
  it('joins files that touch and keeps a real gap', () => {
    expect(mergeRanges([
      { start: '2026-11-05T09:00:03', end: '2026-11-05T10:00:00' },
      { start: '2026-11-05T08:00:00', end: '2026-11-05T09:00:00' },
      { start: '2026-11-05T12:00:00', end: '2026-11-05T13:00:00' },
    ])).toEqual([
      { start: '2026-11-05T08:00:00', end: '2026-11-05T10:00:00' },
      { start: '2026-11-05T12:00:00', end: '2026-11-05T13:00:00' },
    ]);
  });

  it('cuts blocks to the period asked for and drops the rest', () => {
    expect(clipRanges([
      { start: '2026-11-04T23:00:00', end: '2026-11-05T01:00:00' },
      { start: '2026-11-06T01:00:00', end: '2026-11-06T02:00:00' },
    ], '2026-11-05T00:00:00', '2026-11-05T23:59:59')).toEqual([{ start: '2026-11-05T00:00:00', end: '2026-11-05T01:00:00' }]);
  });
});

describe('playback URL', () => {
  const login = { host: '10.0.0.5', httpPort: 80, rtspPort: 554, username: 'ad min', password: `p@ss'w"o$r(d)!` };

  it('asks for the main-stream track of the channel between the two times', () => {
    expect(playbackUrl(login, 3, '2026-11-05T08:00:00', '2026-11-05T08:30:00'))
      .toMatch(/@10\.0\.0\.5:554\/Streaming\/tracks\/301\?starttime=20261105T080000Z&endtime=20261105T083000Z$/);
  });

  it('leaves nothing a command line could interpret', () => {
    const credentials = playbackUrl(login, 1, '2026-11-05T08:00:00', '2026-11-05T08:30:00').slice('rtsp://'.length).split('@10.0.0.5')[0];
    expect(credentials).not.toMatch(/["'`$\\()!* ]/);
  });

  it('knows the codec names that need H.265 support', () => {
    expect(isHevc('H.265')).toBe(true);
    expect(isHevc('H.265+')).toBe(true);
    expect(isHevc('H.264')).toBe(false);
    expect(isHevc(null)).toBe(false);
  });
});

describe('session limits', () => {
  const limits = { perUser: 2, perDevice: 2, total: 3 };
  const s = (userId: string, deviceId: string) => ({ userId, deviceId, transcoded: false });

  it('lets a session through under every limit', () => {
    expect(checkSessionLimits([s('a', 'x')], { userId: 'b', deviceId: 'x' }, limits)).toBeNull();
  });

  it('refuses at each ceiling, naming which one', () => {
    expect(checkSessionLimits([s('a', 'x'), s('b', 'y'), s('c', 'z')], { userId: 'd', deviceId: 'w' }, limits)).toBe('LIMIT_TOTAL');
    expect(checkSessionLimits([s('a', 'x'), s('b', 'x')], { userId: 'c', deviceId: 'x' }, limits)).toBe('LIMIT_DEVICE');
    expect(checkSessionLimits([s('a', 'x'), s('a', 'y')], { userId: 'a', deviceId: 'z' }, limits)).toBe('LIMIT_USER');
  });

  it('counts a clip being copied against the recorder', () => {
    expect(checkSessionLimits([s('a', 'x')], { userId: 'b', deviceId: 'x' }, limits, 1)).toBe('LIMIT_DEVICE');
  });

  it('holds conversions to what the machine can do, whatever is configured', () => {
    expect(effectiveTranscodeLimit(16, 4)).toBe(2);
    expect(effectiveTranscodeLimit(2, 16)).toBe(2);
    expect(effectiveTranscodeLimit(0, 16)).toBe(0);
    expect(effectiveTranscodeLimit(4, 1)).toBe(1);
  });
});
