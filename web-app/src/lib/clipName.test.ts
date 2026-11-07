import { describe, expect, it } from 'vitest';
import { cleanShortCode, defaultClipTitle } from './clipName';

const date = '2026-11-01';
const time = '091127';

describe('defaultClipTitle', () => {
  it('takes the recorder code and the channel', () => {
    expect(defaultClipTitle({ channelNumber: 5, device: { shortCode: 'STR' } }, date, time)).toBe('STR-Ch5-2026-11-01_091127');
  });

  it('prefers the camera code over the recorder code', () => {
    expect(defaultClipTitle({ shortCode: 'GATE', channelNumber: 5, device: { shortCode: 'STR' } }, date, time)).toBe('GATE-Ch5-2026-11-01_091127');
  });

  it('leaves out the channel for a camera without one', () => {
    expect(defaultClipTitle({ shortCode: 'SRV', channelNumber: null }, date, time)).toBe('SRV-2026-11-01_091127');
  });

  it('keeps the old name when no code is set', () => {
    expect(defaultClipTitle({ channelNumber: 5, device: { shortCode: ' ' } }, date, time)).toBe('Clip_2026-11-01_091127');
    expect(defaultClipTitle(undefined, date, time)).toBe('Clip_2026-11-01_091127');
  });
});

describe('cleanShortCode', () => {
  it('keeps letters, Thai, digits, dash and underscore', () => {
    expect(cleanShortCode('สโตร์ A-1_b!/ .')).toBe('สโตร์A-1_b');
  });

  it('stops at 20 characters', () => {
    expect(cleanShortCode('a'.repeat(30))).toHaveLength(20);
  });
});
