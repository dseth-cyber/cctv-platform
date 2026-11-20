import { describe, expect, it } from 'vitest';
import { addMonths, ageBucket, ageYears, daysBetween, effectiveRecord, isDay, noticeDue, parseNoticeDays, today, warrantyEnd, warrantyNoteText, warrantyStatus, type AssetLike } from './asset-logic.js';

const base: AssetLike = { purchaseDate: '2026-01-15', installDate: '2026-02-01', warrantyMonths: 12, warrantyFrom: 'purchase', warrantyUntil: null, warrantyManual: false };

describe('dates', () => {
  it('checks real calendar days', () => {
    expect(isDay('2026-02-28')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-2-3')).toBe(false);
    expect(isDay(null)).toBe(false);
  });
  it('adds months, keeping month ends sensible', () => {
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(daysBetween('2026-11-20', '2026-12-20')).toBe(30);
  });
  it('today follows the time zone, not UTC', () => {
    expect(today(new Date('2026-11-20T18:30:00Z'), 'Asia/Bangkok')).toBe('2026-11-21');
  });
});

describe('warrantyEnd', () => {
  it('counts from purchase or install', () => {
    expect(warrantyEnd(base)).toBe('2027-01-15');
    expect(warrantyEnd({ ...base, warrantyFrom: 'install' })).toBe('2027-02-01');
  });
  it('no start, no months or zero months: no warranty', () => {
    expect(warrantyEnd({ ...base, purchaseDate: null })).toBeNull();
    expect(warrantyEnd({ ...base, warrantyMonths: null })).toBeNull();
    expect(warrantyEnd({ ...base, warrantyMonths: 0 })).toBeNull();
  });
  it('a date typed by a person wins', () => {
    expect(warrantyEnd({ ...base, warrantyManual: true, warrantyUntil: '2028-06-30' })).toBe('2028-06-30');
  });
});

describe('warrantyStatus', () => {
  it('sorts into active, expiring, expired, none', () => {
    expect(warrantyStatus('2027-01-15', '2026-11-20', 90)).toEqual({ status: 'expiring', daysLeft: 56 });
    expect(warrantyStatus('2027-06-01', '2026-11-20', 90).status).toBe('active');
    expect(warrantyStatus('2026-11-19', '2026-11-20', 90)).toEqual({ status: 'expired', daysLeft: -1 });
    expect(warrantyStatus(null, '2026-11-20', 90).status).toBe('none');
  });
});

describe('notices', () => {
  const stages = [90, 30];
  it('reads the days setting', () => {
    expect(parseNoticeDays('30, 90,90')).toEqual([90, 30]);
    expect(parseNoticeDays('')).toEqual([90, 30]);
    expect(parseNoticeDays('7')).toEqual([7]);
  });
  it('raises each stage once, the nearest only', () => {
    expect(noticeDue('2027-03-01', '2026-11-20', stages, null)).toBeNull();
    expect(noticeDue('2027-02-01', '2026-11-20', stages, null)).toEqual({ stage: 90, quiet: false });
    expect(noticeDue('2027-02-01', '2026-11-20', stages, 90)).toBeNull();
    expect(noticeDue('2026-12-10', '2026-11-20', stages, 90)).toEqual({ stage: 30, quiet: false });
    expect(noticeDue('2026-12-10', '2026-11-20', stages, null)).toEqual({ stage: 30, quiet: false });
    expect(noticeDue('2026-12-10', '2026-11-20', stages, 30)).toBeNull();
  });
  it('an end just passed is told; one long past is only recorded', () => {
    expect(noticeDue('2026-11-19', '2026-11-20', stages, 30)).toEqual({ stage: 0, quiet: false });
    expect(noticeDue('2024-01-01', '2026-11-20', stages, null)).toEqual({ stage: 0, quiet: true });
    expect(noticeDue('2026-11-19', '2026-11-20', stages, 0)).toBeNull();
  });
});

describe('age and inheritance', () => {
  it('years from install, else purchase', () => {
    expect(ageYears({ installDate: '2020-11-21', purchaseDate: null }, '2026-11-20')).toBe(5);
    expect(ageYears({ installDate: null, purchaseDate: '2026-01-01' }, '2026-11-20')).toBe(0);
    expect(ageYears({ installDate: null, purchaseDate: null }, '2026-11-20')).toBeNull();
    expect([ageBucket(0), ageBucket(2), ageBucket(4), ageBucket(7), ageBucket(null)]).toEqual(['under1', '1to3', '3to5', 'over5', 'unknown']);
  });
  it('a camera without its own record takes its recorder’s', () => {
    expect(effectiveRecord(null, { a: 1 })).toEqual({ record: { a: 1 }, inherited: true });
    expect(effectiveRecord({ a: 2 }, { a: 1 })).toEqual({ record: { a: 2 }, inherited: false });
    expect(effectiveRecord(null, null)).toEqual({ record: null, inherited: false });
  });
});

describe('warrantyNoteText', () => {
  it('says who to call while covered', () => {
    const t = warrantyNoteText({ until: '2027-01-15', day: '2026-11-20', vendor: { name: 'โลหะกิจ', contactName: 'ทดสอบ ระบบ', phone: '0999999999' } });
    expect(t).toContain('ยังอยู่ในประกันถึง');
    expect(t).toContain('อีก 56 วัน');
    expect(t).toContain('ติดต่อ โลหะกิจ (ทดสอบ ระบบ) โทร 0999999999');
  });
  it('says when it ended, and nothing without a warranty', () => {
    expect(warrantyNoteText({ until: '2026-01-01', day: '2026-11-20' })).toContain('ประกันหมดแล้วเมื่อ');
    expect(warrantyNoteText({ until: null, day: '2026-11-20' })).toBeNull();
  });
});

describe('assetInputSchema', async () => {
  const { assetInputSchema, readDay } = await import('./assets.service.js');
  it('a field left out stays out; an empty text clears it', () => {
    expect(assetInputSchema.parse({ installer: 'ช่างเอ' })).toEqual({ installer: 'ช่างเอ' });
    expect(assetInputSchema.parse({ installer: '  ' })).toEqual({ installer: null });
    expect(() => assetInputSchema.parse({ purchaseDate: '2026-02-30' })).toThrow();
  });
  it('reads sheet dates typed the Thai way', () => {
    expect(readDay('15/01/2569')).toBe('2026-01-15');
    expect(readDay('5/1/2026')).toBe('2026-01-05');
    expect(readDay('2026-01-15')).toBe('2026-01-15');
    expect(readDay('31/02/2026')).toBeNull();
  });
});
