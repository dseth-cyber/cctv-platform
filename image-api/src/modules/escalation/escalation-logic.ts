/**
 * Escalation decisions without the database: which chain an alert follows, and what to do with it at a given time.
 * The service (escalation.service.ts) reads rows, asks these functions, and writes the answer back.
 */

export type EscalationTarget = { type: 'default' } | { type: 'team'; id: string };

export interface RuleLike {
  id: string;
  alertType: string | null;
  siteId: string | null;
  zoneId: string | null;
  policyId: string;
  enabled: boolean;
  createdAt: Date;
}

export interface AlertPlace {
  alertType: string;
  siteId: string | null;
  zoneId: string | null;
}

/**
 * The most specific enabled rule that fits: a rule naming a zone, site or type only fits an alert with that zone,
 * site or type; among those that fit, zone beats site beats anywhere, and a named type beats any type. Ties go to
 * the older rule, so adding a rule never silently takes over from one already in use. Null = no rule fits.
 */
export function matchRule<R extends RuleLike>(rules: R[], place: AlertPlace): R | null {
  let best: R | null = null;
  let bestScore = -1;
  for (const r of rules) {
    if (!r.enabled) continue;
    if (r.alertType && r.alertType !== place.alertType) continue;
    if (r.zoneId && r.zoneId !== place.zoneId) continue;
    if (r.siteId && r.siteId !== place.siteId) continue;
    const score = (r.zoneId ? 4 : 0) + (r.siteId ? 2 : 0) + (r.alertType ? 1 : 0);
    if (score > bestScore || (score === bestScore && best && r.createdAt < best.createdAt)) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

export interface StepLike {
  waitMinutes: number;
  targets: EscalationTarget[];
}

export interface StateLike {
  stepIndex: number;
  nextNotifyAt: Date | null;
  dueAt: Date | null;
}

export type EscalationReason = 'escalate' | 'repeat' | 'due_passed';

export interface Decision {
  /** Nothing to send now; only nextNotifyAt may move (e.g. to the end of an acknowledgement). */
  notify: boolean;
  reason?: EscalationReason;
  /** The step whose targets are told. */
  stepIndex: number;
  nextNotifyAt: Date;
  /** The acknowledgement ran out and is cleared. */
  clearDue: boolean;
}

const minutes = (m: number) => Math.max(1, m) * 60_000;

/** When a step's wait ends: the last step waits for the policy's repeat instead of its own wait. */
export function waitAfter(steps: StepLike[], stepIndex: number, repeatMinutes: number, from: Date): Date {
  const last = stepIndex >= steps.length - 1;
  return new Date(from.getTime() + minutes(last ? repeatMinutes : steps[stepIndex].waitMinutes));
}

/**
 * What to do for one open alert at `now`. Called only when nextNotifyAt has come (or is missing).
 * - Paused by an acknowledgement or snooze that has not run out: wait until it does.
 * - An acknowledgement that ran out: tell the same step again ("past its due time") and carry on from there.
 * - Otherwise nobody acknowledged within the step's wait: tell the next step, or repeat the last one.
 */
export function decide(steps: StepLike[], repeatMinutes: number, state: StateLike, now: Date, snoozeUntil: Date | null = null): Decision {
  const stepIndex = Math.min(Math.max(state.stepIndex, 0), Math.max(steps.length - 1, 0));
  const pausedUntil = [state.dueAt, snoozeUntil].filter((d): d is Date => !!d && d > now).sort((a, b) => b.getTime() - a.getTime())[0];
  if (pausedUntil) return { notify: false, stepIndex, nextNotifyAt: pausedUntil, clearDue: false };
  if (steps.length === 0) return { notify: false, stepIndex: 0, nextNotifyAt: new Date(now.getTime() + minutes(repeatMinutes)), clearDue: false };

  if (state.dueAt && state.dueAt <= now) {
    return { notify: true, reason: 'due_passed', stepIndex, nextNotifyAt: waitAfter(steps, stepIndex, repeatMinutes, now), clearDue: true };
  }
  if (stepIndex < steps.length - 1) {
    const next = stepIndex + 1;
    return { notify: true, reason: 'escalate', stepIndex: next, nextNotifyAt: waitAfter(steps, next, repeatMinutes, now), clearDue: false };
  }
  return { notify: true, reason: 'repeat', stepIndex, nextNotifyAt: waitAfter(steps, stepIndex, repeatMinutes, now), clearDue: false };
}

/** The latest an acknowledgement may pause reminders until. */
export function clampDue(requested: Date | null, now: Date, maxDays: number): Date {
  const max = new Date(now.getTime() + Math.max(1, maxDays) * 86_400_000);
  const fallback = new Date(now.getTime() + 86_400_000);
  const due = requested && requested > now ? requested : fallback;
  return due > max ? max : due;
}

/** "2 วัน 5 ชม." / "3 ชม. 10 นาที" / "12 นาที" — how long an alert has been open, in Thai for Telegram. */
export function ageThai(from: Date, now: Date): string {
  const total = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) return h > 0 ? `${d} วัน ${h} ชม.` : `${d} วัน`;
  if (h > 0) return m > 0 ? `${h} ชม. ${m} นาที` : `${h} ชม.`;
  return `${m} นาที`;
}

/**
 * The Telegram chats one step's targets come to (each once). Teams switched off are skipped; a team's own group is
 * used when it has one, and with notifyMembers also each member's private chat (members who linked their Telegram).
 */
export function chatsFor(
  targets: EscalationTarget[],
  defaultChatId: string | null,
  teams: Map<string, { telegramChatId: string | null; enabled: boolean; notifyMembers?: boolean }>,
  memberChats: Map<string, string[]> = new Map(),
): string[] {
  const chats = new Set<string>();
  for (const t of targets) {
    if (t.type === 'default') {
      if (defaultChatId) chats.add(defaultChatId);
    } else if (t.type === 'team') {
      const team = teams.get(t.id);
      if (!team?.enabled) continue;
      if (team.telegramChatId) chats.add(team.telegramChatId);
      if (team.notifyMembers) for (const c of memberChats.get(t.id) ?? []) chats.add(c);
    }
  }
  return [...chats];
}

/** Six digits, for linking a web account to Telegram ("/link 123456" to the bot). */
export function linkCode(random: () => number = Math.random): string {
  return String(Math.floor(random() * 900_000) + 100_000);
}

/** "/link 123456", "link 123456", "เชื่อม 123456" → the code; anything else → null. */
export function parseLinkCommand(text: string): string | null {
  const m = /^\s*(?:\/link|link|เชื่อม)\s+(\d{6})\s*$/i.exec(text ?? '');
  return m ? m[1] : null;
}

/** "ack:<alert id>:<hours>" from an inline button. */
export function parseAckButton(data: string): { alertId: string; hours: number } | null {
  const m = /^ack:([0-9a-f-]{36}):(\d{1,3})$/i.exec(data ?? '');
  if (!m) return null;
  const hours = Number(m[2]);
  return hours >= 1 && hours <= 720 ? { alertId: m[1], hours } : null;
}

export function parseTargets(raw: unknown): EscalationTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: EscalationTarget[] = [];
  for (const t of raw) {
    if (t && typeof t === 'object' && (t as any).type === 'default') out.push({ type: 'default' });
    else if (t && typeof t === 'object' && (t as any).type === 'team' && typeof (t as any).id === 'string') out.push({ type: 'team', id: (t as any).id });
  }
  return out;
}
