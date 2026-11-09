import { describe, expect, it } from 'vitest';
import th from '@/i18n/locales/th.json';
import { translateAlertMessage } from './textUtils';

// The real Thai strings, with {{x}} filled in, so the test reads what a person sees in the bell.
const t = (key: string, opts?: any): string => {
  const value = key.split('.').reduce<any>((o, k) => o?.[k], th);
  if (typeof value !== 'string') return typeof opts === 'string' ? opts : key;
  return value.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts?.[k] ?? ''));
};

describe('translateAlertMessage with a live link', () => {
  it('translates the alert and puts the live link on its own line', () => {
    const out = translateAlertMessage('Camera "cam-1" is back online. Downtime: 2m 5s\nLive: http://192.168.30.77:8090/cctv/live-grid?focus=x', t);
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toContain('Camera "cam-1"');
    expect(lines[1]).toBe('ดูภาพสด: http://192.168.30.77:8090/cctv/live-grid?focus=x');
  });

  it('translates an offline alert that says what the recorder reported (it stayed in English)', () => {
    const out = translateAlertMessage('Camera "MD - Ch 4" is offline. The recorder reports no video signal on this channel. Status: active. Last poll: never', t);
    expect(out).not.toMatch(/^Camera "/);
    expect(out).toContain('MD - Ch 4');
  });
});
