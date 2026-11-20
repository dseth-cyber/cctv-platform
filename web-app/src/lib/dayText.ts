/**
 * A calendar day (YYYY-MM-DD) as people here write it: dd/mm/yyyy, with the Buddhist year in Thai.
 * Typing accepts dd/mm/yyyy in either year (above 2400 is taken as Buddhist), d/m/yyyy, dd.mm.yyyy or YYYY-MM-DD.
 */
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isRealDay(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function dayToText(day: string, buddhist: boolean): string {
  const m = ISO.exec(day);
  if (!m) return '';
  const y = buddhist ? +m[1] + 543 : +m[1];
  return `${m[3]}/${m[2]}/${y}`;
}

export function textToDay(text: string): string | null {
  const s = text.trim();
  const iso = ISO.exec(s);
  if (iso) return isRealDay(+iso[1], +iso[2], +iso[3]) ? s : null;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (!m) return null;
  let y = +m[3];
  if (y > 2400) y -= 543;
  const mo = +m[2], d = +m[1];
  if (y < 1900 || y > 2200 || !isRealDay(y, mo, d)) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
