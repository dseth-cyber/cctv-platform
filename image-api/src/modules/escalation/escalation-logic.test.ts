import { describe, expect, it } from 'vitest';
import { ageThai, chatsFor, clampDue, decide, matchRule, parseTargets, type RuleLike, type StepLike } from './escalation-logic.js';

const t0 = new Date('2026-11-20T00:00:00Z');
const at = (min: number) => new Date(t0.getTime() + min * 60_000);

const rule = (id: string, p: Partial<RuleLike>, created = 0): RuleLike => ({
  id, alertType: null, siteId: null, zoneId: null, policyId: `p-${id}`, enabled: true, createdAt: at(created), ...p,
});

describe('matchRule', () => {
  const rules = [
    rule('any', {}),
    rule('offline', { alertType: 'camera_offline' }),
    rule('site', { siteId: 'S1' }),
    rule('zone', { zoneId: 'Z1' }),
    rule('zone-offline', { zoneId: 'Z1', alertType: 'camera_offline' }),
  ];

  it('picks the most specific rule that fits', () => {
    expect(matchRule(rules, { alertType: 'camera_offline', siteId: 'S1', zoneId: 'Z1' })?.id).toBe('zone-offline');
    expect(matchRule(rules, { alertType: 'hdd_problem', siteId: 'S1', zoneId: 'Z1' })?.id).toBe('zone');
    expect(matchRule(rules, { alertType: 'hdd_problem', siteId: 'S1', zoneId: 'Z2' })?.id).toBe('site');
    expect(matchRule(rules, { alertType: 'camera_offline', siteId: 'S2', zoneId: null })?.id).toBe('offline');
    expect(matchRule(rules, { alertType: 'disk_space', siteId: null, zoneId: null })?.id).toBe('any');
  });

  it('skips disabled rules and returns null when nothing fits', () => {
    expect(matchRule([rule('a', { enabled: false })], { alertType: 'x', siteId: null, zoneId: null })).toBeNull();
    expect(matchRule([rule('z', { zoneId: 'Z9' })], { alertType: 'x', siteId: null, zoneId: 'Z1' })).toBeNull();
  });

  it('an equally specific newer rule does not take over', () => {
    const r = matchRule([rule('old', { siteId: 'S1' }, 0), rule('new', { siteId: 'S1' }, 10)], { alertType: 'x', siteId: 'S1', zoneId: null });
    expect(r?.id).toBe('old');
  });
});

describe('decide', () => {
  const three: StepLike[] = [
    { waitMinutes: 60, targets: [{ type: 'default' }] },
    { waitMinutes: 120, targets: [{ type: 'team', id: 'heads' }] },
    { waitMinutes: 999, targets: [{ type: 'team', id: 'execs' }] },
  ];

  it('nobody acknowledged: tells the next step and waits that step out', () => {
    const d = decide(three, 1440, { stepIndex: 0, nextNotifyAt: at(60), dueAt: null }, at(60));
    expect(d).toMatchObject({ notify: true, reason: 'escalate', stepIndex: 1 });
    expect(d.nextNotifyAt).toEqual(at(60 + 120));
  });

  it('the last step repeats every repeatMinutes', () => {
    const d = decide(three, 1440, { stepIndex: 2, nextNotifyAt: at(500), dueAt: null }, at(500));
    expect(d).toMatchObject({ notify: true, reason: 'repeat', stepIndex: 2 });
    expect(d.nextNotifyAt).toEqual(at(500 + 1440));
  });

  it('moving onto the last step waits the repeat, not the step wait', () => {
    const d = decide(three, 1440, { stepIndex: 1, nextNotifyAt: at(180), dueAt: null }, at(180));
    expect(d.stepIndex).toBe(2);
    expect(d.nextNotifyAt).toEqual(at(180 + 1440));
  });

  it('a one-step chain (the default) just repeats', () => {
    const d = decide([{ waitMinutes: 1440, targets: [{ type: 'default' }] }], 1440, { stepIndex: 0, nextNotifyAt: at(1440), dueAt: null }, at(1440));
    expect(d).toMatchObject({ notify: true, reason: 'repeat', stepIndex: 0 });
  });

  it('an acknowledgement pauses until its due time', () => {
    const d = decide(three, 1440, { stepIndex: 0, nextNotifyAt: at(60), dueAt: at(600) }, at(60));
    expect(d).toMatchObject({ notify: false, stepIndex: 0 });
    expect(d.nextNotifyAt).toEqual(at(600));
  });

  it('a snooze pauses too, the later of the two wins', () => {
    const d = decide(three, 1440, { stepIndex: 0, nextNotifyAt: at(60), dueAt: at(300) }, at(60), at(900));
    expect(d.nextNotifyAt).toEqual(at(900));
  });

  it('past the due time: tells the same step again and clears the acknowledgement', () => {
    const d = decide(three, 1440, { stepIndex: 1, nextNotifyAt: at(600), dueAt: at(600) }, at(600));
    expect(d).toMatchObject({ notify: true, reason: 'due_passed', stepIndex: 1, clearDue: true });
    expect(d.nextNotifyAt).toEqual(at(600 + 120));
  });

  it('a chain with no steps sends nothing', () => {
    expect(decide([], 60, { stepIndex: 0, nextNotifyAt: null, dueAt: null }, at(0)).notify).toBe(false);
  });
});

describe('clampDue', () => {
  it('keeps a due time within the limit, defaults to a day, never in the past', () => {
    expect(clampDue(at(60), at(0), 7)).toEqual(at(60));
    expect(clampDue(null, at(0), 7)).toEqual(at(1440));
    expect(clampDue(at(-5), at(0), 7)).toEqual(at(1440));
    expect(clampDue(at(30 * 1440), at(0), 7)).toEqual(at(7 * 1440));
  });
});

describe('ageThai', () => {
  it('reads like a person would say it', () => {
    expect(ageThai(at(0), at(12))).toBe('12 นาที');
    expect(ageThai(at(0), at(190))).toBe('3 ชม. 10 นาที');
    expect(ageThai(at(0), at(2 * 1440 + 300))).toBe('2 วัน 5 ชม.');
    expect(ageThai(at(0), at(1440))).toBe('1 วัน');
  });
});

describe('chatsFor / parseTargets', () => {
  const teams = new Map([
    ['tech', { telegramChatId: '-1001', enabled: true }],
    ['off', { telegramChatId: '-1002', enabled: false }],
    ['nochat', { telegramChatId: null, enabled: true }],
  ]);
  it('each chat once; skips teams without a group or switched off', () => {
    const targets = parseTargets([{ type: 'default' }, { type: 'team', id: 'tech' }, { type: 'team', id: 'off' }, { type: 'team', id: 'nochat' }, { type: 'team', id: 'tech' }, { type: 'bogus' }]);
    expect(chatsFor(targets, '-1009', teams)).toEqual(['-1009', '-1001']);
    expect(chatsFor([{ type: 'default' }], null, teams)).toEqual([]);
  });
});
