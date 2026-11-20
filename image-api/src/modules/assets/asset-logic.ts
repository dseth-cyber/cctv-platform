/**
 * Purchase and warranty of recorders and cameras, as plain functions (tested on their own).
 * Dates are calendar days written YYYY-MM-DD; nothing here depends on the server's time zone.
 */

export type WarrantyFrom = 'purchase' | 'install';
export type WarrantyStatus = 'none' | 'active' | 'expiring' | 'expired';

export interface AssetLike {
  purchaseDate: string | null;
  installDate: string | null;
  warrantyMonths: number | null;
  warrantyFrom: WarrantyFrom;
  warrantyUntil: string | null;
  warrantyManual: boolean;
}

/** Months offered in the form; any other whole number of months can be typed. */
export const WARRANTY_MONTH_CHOICES = [0, 6, 12, 24, 36, 60] as const;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDay(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DAY.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const toUtc = (day: string) => { const m = DAY.exec(day)!; return Date.UTC(+m[1], +m[2] - 1, +m[3]); };
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The same day `months` later; the 31st becomes the last day of a shorter month (31 Jan + 1 = 28/29 Feb). */
export function addMonths(day: string, months: number): string {
  const m = DAY.exec(day)!;
  const y = +m[1], mo = +m[2] - 1 + months, d = +m[3];
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(y, mo, Math.min(d, last)));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/** Today as a calendar day in the given time zone. */
export function today(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * The warranty end: what a person typed (manual), else the start (purchase or install day) plus the months.
 * Zero months means no warranty.
 */
export function warrantyEnd(a: AssetLike): string | null {
  if (a.warrantyManual) return a.warrantyUntil;
  const start = a.warrantyFrom === 'install' ? a.installDate : a.purchaseDate;
  if (!start || a.warrantyMonths == null || a.warrantyMonths <= 0) return null;
  return addMonths(start, a.warrantyMonths);
}

export function warrantyStatus(until: string | null, day: string, soonDays: number): { status: WarrantyStatus; daysLeft: number | null } {
  if (!until) return { status: 'none', daysLeft: null };
  const left = daysBetween(day, until);
  if (left < 0) return { status: 'expired', daysLeft: left };
  return { status: left <= soonDays ? 'expiring' : 'active', daysLeft: left };
}

/** "90,30" → [90, 30]: whole days from 1 to 730, largest first, each once. Nothing valid → [90, 30]. */
export function parseNoticeDays(value: unknown): number[] {
  const list = String(value ?? '').split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 730);
  const out = [...new Set(list)].sort((a, b) => b - a);
  return out.length ? out : [90, 30];
}

/** How long after the end an "ended" notice is still worth sending; older ones are only marked as seen. */
export const ENDED_NOTICE_WINDOW_DAYS = 30;

/**
 * Which warranty notice is due now: one of the `stages` (days before the end) or 0 for "ended".
 * Only the nearest one that applies, and only if it is closer than the last notice already raised, so an item
 * entered 20 days before its end gets the 30-day notice, not the 90-day one too.
 * `quiet` marks a notice that should be recorded without telling anyone (an end long past when it was entered).
 */
export function noticeDue(until: string | null, day: string, stages: number[], already: number | null): { stage: number; quiet: boolean } | null {
  if (!until) return null;
  const left = daysBetween(day, until);
  if (left < 0) {
    if (already === 0) return null;
    return { stage: 0, quiet: -left > ENDED_NOTICE_WINDOW_DAYS };
  }
  const fitting = stages.filter((s) => left <= s);
  if (!fitting.length) return null;
  const stage = Math.min(...fitting);
  if (already != null && already <= stage) return null;
  return { stage, quiet: false };
}

/** Years of service from installation (or purchase when not installed yet), in whole years. */
export function ageYears(a: { installDate: string | null; purchaseDate: string | null }, day: string): number | null {
  const start = a.installDate ?? a.purchaseDate;
  if (!start) return null;
  return Math.max(0, Math.floor(daysBetween(start, day) / 365.25));
}

export type AgeBucket = 'under1' | '1to3' | '3to5' | 'over5' | 'unknown';
export function ageBucket(years: number | null): AgeBucket {
  if (years == null) return 'unknown';
  if (years < 1) return 'under1';
  if (years < 3) return '1to3';
  if (years < 5) return '3to5';
  return 'over5';
}

/** A channel camera without its own record uses its recorder's. */
export function effectiveRecord<T>(own: T | null | undefined, device: T | null | undefined): { record: T | null; inherited: boolean } {
  if (own) return { record: own, inherited: false };
  if (device) return { record: device, inherited: true };
  return { record: null, inherited: false };
}

/** Thai calendar date for messages, e.g. 15 ม.ค. 2570. */
export function thaiDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('th-TH', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
}

/** The line added to a fault alert: still covered (with whom to call) or already ended. */
export function warrantyNoteText(opts: { until: string | null; day: string; vendor?: { name: string; contactName?: string | null; phone?: string | null } | null }): string | null {
  if (!opts.until) return null;
  const left = daysBetween(opts.day, opts.until);
  if (left < 0) return `🛡 ประกันหมดแล้วเมื่อ ${thaiDay(opts.until)}`;
  const v = opts.vendor;
  const who = v ? ` · ติดต่อ ${v.name}${v.contactName ? ` (${v.contactName})` : ''}${v.phone ? ` โทร ${v.phone}` : ''}` : '';
  return `🛡 ยังอยู่ในประกันถึง ${thaiDay(opts.until)} (อีก ${left} วัน)${who}`;
}

/** Alert types about a fault in the equipment itself, where the warranty is worth knowing. */
export const FAULT_ALERT_TYPES = new Set(['camera_offline', 'hdd_problem', 'recording_stopped', 'incident_escalation']);
