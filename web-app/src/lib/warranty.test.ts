import { describe, expect, it } from 'vitest';
import { addMonths, assetToForm, daysLeft, emptyAssetForm, formToPayload, formWarrantyEnd } from './warranty';

describe('warranty form', () => {
  it('works out the end like the server', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    const f = { ...emptyAssetForm(), purchaseDate: '2026-01-15', installDate: '2026-02-01', warrantyMonths: '12' };
    expect(formWarrantyEnd(f)).toBe('2027-01-15');
    expect(formWarrantyEnd({ ...f, warrantyFrom: 'install' })).toBe('2027-02-01');
    expect(formWarrantyEnd({ ...f, warrantyMonths: 'custom', customMonths: '18' })).toBe('2027-07-15');
    expect(formWarrantyEnd({ ...f, warrantyMonths: '0' })).toBe('');
    expect(formWarrantyEnd({ ...f, warrantyManual: true, warrantyUntil: '2030-01-01' })).toBe('2030-01-01');
  });
  it('round-trips a saved card, odd months as custom', () => {
    const f = assetToForm({ warrantyMonths: 18, warrantyFrom: 'install', purchasePrice: 12500.5, vendorCode: 'lohakij' });
    expect(f.warrantyMonths).toBe('custom');
    expect(f.customMonths).toBe('18');
    expect(formToPayload(f, true)).toMatchObject({ warrantyMonths: 18, warrantyFrom: 'install', purchasePrice: 12500.5, vendorCode: 'lohakij' });
    expect(formToPayload(f, false)).not.toHaveProperty('purchasePrice');
    expect(formToPayload({ ...f, purchasePrice: '1,200' }, true).purchasePrice).toBe(1200);
  });
  it('counts days left', () => {
    expect(daysLeft('2026-12-20', '2026-11-20')).toBe(30);
    expect(daysLeft('2026-11-19', '2026-11-20')).toBe(-1);
  });
});
