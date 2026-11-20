import { describe, expect, it } from 'vitest';
import { dayToText, textToDay } from './dayText';

describe('day text', () => {
  it('shows dd/mm/yyyy, Buddhist year in Thai', () => {
    expect(dayToText('2026-01-15', true)).toBe('15/01/2569');
    expect(dayToText('2026-01-15', false)).toBe('15/01/2026');
    expect(dayToText('', true)).toBe('');
  });
  it('reads what people type', () => {
    expect(textToDay('15/01/2569')).toBe('2026-01-15');
    expect(textToDay('5/1/2026')).toBe('2026-01-05');
    expect(textToDay('15.01.2026')).toBe('2026-01-15');
    expect(textToDay('2026-01-15')).toBe('2026-01-15');
    expect(textToDay('31/02/2026')).toBeNull();
    expect(textToDay('01/15/2026')).toBeNull();
    expect(textToDay('abc')).toBeNull();
  });
});
