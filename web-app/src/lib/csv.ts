/**
 * CSV that opens correctly in Excel (Thai included) and comes back in unchanged.
 * A cell starting with = + - @ would run as a formula in Excel, so it is written behind an apostrophe.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  return [headers.join(','), ...rows.map((row) => headers.map((h) => cell(row[h])).join(','))].join('\r\n');
}

/** Rows as objects keyed by the header in lower case. Handles quotes, commas and line breaks inside cells. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const source = text.replace(/^﻿/, '');
  const table: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        value += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        value += ch;
      }
    } else if (ch === '"' && value === '') {
      quoted = true;
    } else if (ch === ',') {
      row.push(value);
      value = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(value);
      value = '';
      table.push(row);
      row = [];
    } else {
      value += ch;
    }
  }
  if (value !== '' || row.length > 0) {
    row.push(value);
    table.push(row);
  }
  const rows = table.filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim().replace(/^'(?=[=+\-@])/, '')])));
}

/** "1;3;5" as written in a cell. Empty means not specified. */
export function parseChannelList(text: string | undefined): number[] | undefined {
  const parts = (text ?? '').split(/[;\s]+/).filter(Boolean).map(Number);
  return parts.length > 0 && parts.every((n) => Number.isInteger(n) && n > 0) ? parts : undefined;
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
