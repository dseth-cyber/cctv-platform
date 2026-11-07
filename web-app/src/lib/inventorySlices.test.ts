import { describe, expect, it } from 'vitest';
import { buildInventorySlices } from './inventorySlices';

const labels = { none: 'Not specified', other: 'Other' };
const options = [{ value: 'dome', label: 'Dome' }, { value: 'bullet', label: 'Bullet' }];

describe('buildInventorySlices', () => {
  it('counts values, uses the list label and shows what has nothing set', () => {
    const slices = buildInventorySlices(['bullet', 'bullet', 'dome', null, ''], options, labels);
    expect(slices.map((s) => [s.key, s.label, s.count, s.percent, s.kind])).toEqual([
      ['bullet', 'Bullet', 2, 40, 'value'],
      ['dome', 'Dome', 1, 20, 'value'],
      ['none', 'Not specified', 2, 40, 'none'],
    ]);
  });

  it('keeps colours with the list entry, not its rank', () => {
    const [first] = buildInventorySlices(['bullet', 'bullet', 'dome'], options, labels);
    expect(first.key).toBe('bullet');
    expect(first.colorSlot).toBe(1);
  });

  it('counts different spellings of one brand together', () => {
    const slices = buildInventorySlices(['Hikvision', 'hikvision'], [{ value: 'Hikvision', label: 'Hikvision' }], labels);
    expect(slices).toHaveLength(1);
    expect(slices[0]).toMatchObject({ key: 'Hikvision', count: 2, percent: 100 });
  });

  it('shows a value that is no longer in the list instead of losing it', () => {
    expect(buildInventorySlices(['old-brand'], options, labels)[0]).toMatchObject({ key: 'old-brand', label: 'old-brand', kind: 'value' });
  });

  it('folds everything past five values into other', () => {
    const slices = buildInventorySlices(['a', 'a', 'a', 'a', 'a', 'a', 'b', 'b', 'b', 'b', 'b', 'c', 'c', 'c', 'c', 'd', 'd', 'd', 'e', 'e', 'f', 'g'], [], labels);
    expect(slices).toHaveLength(6);
    expect(slices[5]).toMatchObject({ kind: 'other', count: 2 });
  });

  it('returns nothing to draw for nothing', () => {
    expect(buildInventorySlices([], options, labels)).toEqual([]);
  });
});
