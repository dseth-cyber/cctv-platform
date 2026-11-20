/**
 * The purchase and warranty card in a form (phase 5.5). The end date shown while typing is worked out the same way
 * as on the server (image-api/src/modules/assets/asset-logic.ts), which has the final say.
 */

export const MONTH_CHOICES = [0, 6, 12, 24, 36, 60];

export interface AssetForm {
  purchaseDate: string;
  installDate: string;
  /** One of MONTH_CHOICES as text, '' for not set, 'custom' for a number typed in customMonths. */
  warrantyMonths: string;
  customMonths: string;
  warrantyFrom: 'purchase' | 'install';
  warrantyManual: boolean;
  warrantyUntil: string;
  vendorCode: string;
  installer: string;
  poNumber: string;
  assetTag: string;
  purchasePrice: string;
  notes: string;
}

export const emptyAssetForm = (): AssetForm => ({
  purchaseDate: '', installDate: '', warrantyMonths: '', customMonths: '', warrantyFrom: 'purchase', warrantyManual: false,
  warrantyUntil: '', vendorCode: '', installer: '', poNumber: '', assetTag: '', purchasePrice: '', notes: '',
});

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function addMonths(day: string, months: number): string {
  const m = DAY.exec(day);
  if (!m) return '';
  const y = +m[1], mo = +m[2] - 1 + months, d = +m[3];
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, mo, Math.min(d, last))).toISOString().slice(0, 10);
}

export function monthsOf(f: AssetForm): number | null {
  const raw = f.warrantyMonths === 'custom' ? f.customMonths : f.warrantyMonths;
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 240 ? n : null;
}

/** The end as it will be saved: the typed date, else start + months; '' for no warranty. */
export function formWarrantyEnd(f: AssetForm): string {
  if (f.warrantyManual) return f.warrantyUntil;
  const start = f.warrantyFrom === 'install' ? f.installDate : f.purchaseDate;
  const months = monthsOf(f);
  if (!start || !months) return '';
  return addMonths(start, months);
}

export function assetToForm(dto: any | null | undefined): AssetForm {
  if (!dto) return emptyAssetForm();
  const months = dto.warrantyMonths;
  const known = months != null && MONTH_CHOICES.includes(months);
  return {
    purchaseDate: dto.purchaseDate ?? '',
    installDate: dto.installDate ?? '',
    warrantyMonths: months == null ? '' : known ? String(months) : 'custom',
    customMonths: months != null && !known ? String(months) : '',
    warrantyFrom: dto.warrantyFrom === 'install' ? 'install' : 'purchase',
    warrantyManual: !!dto.warrantyManual,
    warrantyUntil: dto.warrantyUntil ?? '',
    vendorCode: dto.vendorCode ?? '',
    installer: dto.installer ?? '',
    poNumber: dto.poNumber ?? '',
    assetTag: dto.assetTag ?? '',
    purchasePrice: dto.purchasePrice == null ? '' : String(dto.purchasePrice),
    notes: dto.notes ?? '',
  };
}

/** What the API takes. The price goes only when the person may see it. */
export function formToPayload(f: AssetForm, canPrice: boolean): Record<string, unknown> {
  const s = (v: string) => (v.trim() ? v.trim() : null);
  const price = f.purchasePrice.replace(/,/g, '').trim();
  return {
    purchaseDate: f.purchaseDate || null,
    installDate: f.installDate || null,
    warrantyMonths: monthsOf(f),
    warrantyFrom: f.warrantyFrom,
    warrantyManual: f.warrantyManual,
    warrantyUntil: f.warrantyManual ? f.warrantyUntil || null : null,
    vendorCode: f.vendorCode || null,
    installer: s(f.installer),
    poNumber: s(f.poNumber),
    assetTag: s(f.assetTag),
    notes: s(f.notes),
    ...(canPrice ? { purchasePrice: price === '' ? null : Number(price) } : {}),
  };
}

export const sameForm = (a: AssetForm, b: AssetForm) => JSON.stringify(a) === JSON.stringify(b);

/** Days from today (YYYY-MM-DD) to the end; negative once ended. */
export function daysLeft(until: string, today: string): number {
  return Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
