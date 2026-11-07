import { describe, expect, it } from 'vitest';
import { camerasToStream, chooseLiveCameras } from './liveAllocation';

const all = ['a', 'b', 'c', 'd'];
const base = { cameras: all, visible: all, pinned: [], favorites: new Set<string>(), previous: new Set<string>(), unavailable: new Set<string>(), quota: 2 };
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
    const live = chooseLiveCameras({ ...base, pinned: ['d', 'c'], previous: new Set(['a', 'c']), released: new Set(['a', 'b']) });
    expect(sorted(live)).toEqual(['c', 'd']);
  });

  it('keeps the live cameras when they scroll off screen', () => {
    const live = chooseLiveCameras({ ...base, visible: ['c', 'd'], previous: new Set(['a', 'b']) });
    expect(sorted(live)).toEqual(['a', 'b']);
  });

  it('keeps a hand-opened camera live when it scrolls off screen', () => {
    const live = chooseLiveCameras({ ...base, visible: ['a', 'b'], pinned: ['d'], previous: new Set(['d', 'a']) });
    expect(sorted(live)).toEqual(['a', 'd']);
  });

  it('does not give a cancelled place away after scrolling past it', () => {
    const live = chooseLiveCameras({ ...base, visible: ['c', 'd'], previous: new Set(['a', 'b']), released: new Set(['a']) });
    expect(sorted(live)).toEqual(['b']);
  });

  it('uses free places on the new screen after scrolling', () => {
    const live = chooseLiveCameras({ ...base, visible: ['c', 'd'], previous: new Set(['a']) });
    expect(sorted(live)).toEqual(['a', 'c']);
  });

  it('drops what a filter took out of view and fills up again', () => {
    const live = chooseLiveCameras({ ...base, cameras: ['c', 'd'], visible: ['c', 'd'], previous: new Set(['a', 'b']), released: new Set(['a']) });
    expect(sorted(live)).toEqual(['c', 'd']);
  });

  it('gives up a place only for a camera that cannot stream', () => {
    const live = chooseLiveCameras({ ...base, previous: new Set(['a', 'b']), unavailable: new Set(['a']) });
    expect(sorted(live)).toEqual(['b', 'c']);
  });
});

describe('camerasToStream', () => {
  it('streams only live cameras on screen', () => {
    expect(camerasToStream(new Set(['a', 'c']), ['b', 'c'], true)).toEqual(['c']);
  });

  it('streams nothing while the tab is hidden', () => {
    expect(camerasToStream(new Set(['a']), ['a'], false)).toEqual([]);
  });
});
