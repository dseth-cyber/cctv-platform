import { describe, expect, it } from 'vitest';
import { chooseLiveCameras } from './liveAllocation';

const base = { visible: ['a', 'b', 'c', 'd'], pinned: [], favorites: new Set<string>(), previous: new Set<string>(), unavailable: new Set<string>(), quota: 2 };
const sorted = (s: Set<string>) => [...s].sort();

describe('chooseLiveCameras', () => {
  it('fills the quota from what is on screen, starred first', () => {
    expect(sorted(chooseLiveCameras({ ...base, favorites: new Set(['d']) }))).toEqual(['a', 'd']);
  });

  it('does not push out a live camera when another one is starred', () => {
    const live = chooseLiveCameras({ ...base, previous: new Set(['a', 'b']), favorites: new Set(['d']) });
    expect(sorted(live)).toEqual(['a', 'b']);
  });

  it('puts the chosen camera in the place the person cancelled, and only that place', () => {
    const live = chooseLiveCameras({ ...base, pinned: ['c'], previous: new Set(['a', 'b']), released: new Set(['b']) });
    expect(sorted(live)).toEqual(['a', 'c']);
  });

  it('leaves a cancelled place free until the person picks a camera', () => {
    const live = chooseLiveCameras({ ...base, previous: new Set(['a', 'b']), released: new Set(['b']) });
    expect(sorted(live)).toEqual(['a']);
  });

  it('keeps earlier choices when a second camera is swapped in', () => {
    const live = chooseLiveCameras({ ...base, visible: ['a', 'b', 'c', 'd'], pinned: ['d', 'c'], previous: new Set(['a', 'c']), released: new Set(['a', 'b']) });
    expect(sorted(live)).toEqual(['c', 'd']);
  });

  it('still fills the quota for a new screen after scrolling', () => {
    const live = chooseLiveCameras({ ...base, visible: ['c', 'd'], previous: new Set(['a', 'b']), released: new Set(['a']) });
    expect(sorted(live)).toEqual(['c', 'd']);
  });
});
