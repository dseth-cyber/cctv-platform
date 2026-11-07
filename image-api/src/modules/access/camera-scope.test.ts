import { describe, expect, it } from 'vitest';
import { mergeCameraScope } from './camera-scope.js';

describe('mergeCameraScope', () => {
  it('gives nothing to someone with no rules at all', () => {
    expect(mergeCameraScope([null, undefined])).toEqual({ all: false, where: { id: { in: [] } } });
  });

  it('gives nothing for rules that name nothing', () => {
    expect(mergeCameraScope([{}, { all: false, siteIds: [] }])).toEqual({ all: false, where: { id: { in: [] } } });
  });

  it('gives everything when either the role or the person has it', () => {
    expect(mergeCameraScope([{ all: true }, { siteIds: ['a'] }])).toEqual({ all: true });
    expect(mergeCameraScope([null, { all: true }])).toEqual({ all: true });
  });

  it('adds the role and the person together', () => {
    const scope = mergeCameraScope([{ siteIds: ['s1'] }, { groupIds: ['g1'] }]);
    expect(scope).toEqual({ all: false, where: { OR: [{ siteId: { in: ['s1'] } }, { groupMemberships: { some: { groupId: { in: ['g1'] } } } }] } });
  });

  it('covers each way of naming cameras, without repeats', () => {
    const scope = mergeCameraScope([{ siteIds: ['s'], zoneIds: ['z'], deviceIds: ['d', 'd'] }, { deviceIds: ['d'] }]);
    expect(scope).toEqual({ all: false, where: { OR: [{ siteId: { in: ['s'] } }, { zoneId: { in: ['z'] } }, { deviceId: { in: ['d'] } }] } });
  });

  it('does not treat all:false as everything', () => {
    expect(mergeCameraScope([{ all: false, deviceIds: ['d'] }])).toMatchObject({ all: false });
  });
});
