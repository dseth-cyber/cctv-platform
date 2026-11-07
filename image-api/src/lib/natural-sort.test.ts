import { describe, expect, it } from 'vitest';
import { sortByName } from './natural-sort.js';

describe('sortByName', () => {
  it('puts channels in number order', () => {
    const names = ['MD - Ch 1', 'MD - Ch 10', 'MD - Ch 12', 'MD - Ch 2', 'MD - Ch 16', 'MD - Ch 3'];
    expect(sortByName(names.map((name) => ({ name }))).map((r) => r.name)).toEqual(['MD - Ch 1', 'MD - Ch 2', 'MD - Ch 3', 'MD - Ch 10', 'MD - Ch 12', 'MD - Ch 16']);
  });

  it('keeps Thai names together, and copes with no name', () => {
    const rows = [{ name: 'แผนกบุคคล - Ch 10' }, { name: null }, { name: 'แผนกบุคคล - Ch 9' }];
    expect(sortByName(rows).map((r) => r.name)).toEqual([null, 'แผนกบุคคล - Ch 9', 'แผนกบุคคล - Ch 10']);
  });

  it('leaves the list it was given alone', () => {
    const rows = [{ name: 'b' }, { name: 'a' }];
    sortByName(rows);
    expect(rows[0].name).toBe('b');
  });
});
