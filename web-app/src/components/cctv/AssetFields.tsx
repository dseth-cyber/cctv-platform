import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { imageServiceApi } from '@/services/imageServiceApi';
import { formWarrantyEnd, MONTH_CHOICES, type AssetForm } from '@/lib/warranty';
import { formatDate } from '@/utils/dateUtils';
import { DatePicker } from '@/components/ui/DatePicker';

export interface AssetOptions { monthChoices: number[]; vendors: Array<{ code: string; name: string; contactName: string | null; phone: string | null; email: string | null }>; canPrice: boolean }

export function useAssetOptions(enabled = true) {
  return useQuery<AssetOptions>({ queryKey: ['asset-options'], queryFn: imageServiceApi.getAssetOptions, staleTime: 60_000, enabled });
}

const input = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500';
const label = 'block text-xs font-medium text-slate-300 mb-1';

/**
 * Purchase, warranty and installation fields (phase 5.5). The warranty end is worked out from the months and the day
 * it counts from, or typed when the warranty card says otherwise.
 */
export function AssetFields({ value, onChange, options }: { value: AssetForm; onChange: (v: AssetForm) => void; options: AssetOptions | undefined }) {
  const { t, i18n } = useTranslation();
  const k = (key: string, o?: Record<string, unknown>) => String(t(`ui.assets.${key}`, o as any));
  const set = (patch: Partial<AssetForm>) => onChange({ ...value, ...patch });
  const end = formWarrantyEnd(value);
  const vendor = options?.vendors.find((v) => v.code === value.vendorCode);
  // A vendor switched off since it was chosen still shows on the cards that use it.
  const vendors = options?.vendors ?? [];
  const missingVendor = value.vendorCode && !vendor;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-asset-fields>
      <div>
        <label className={label}>{k('purchaseDate')}</label>
        <DatePicker name="purchaseDate" value={value.purchaseDate} onChange={(v) => set({ purchaseDate: v })} />
      </div>
      <div>
        <label className={label}>{k('installDate')}</label>
        <DatePicker name="installDate" value={value.installDate} onChange={(v) => set({ installDate: v })} />
      </div>
      <div>
        <label className={label}>{k('warranty')}</label>
        <div className="flex gap-2">
          <select className={input} value={value.warrantyMonths} onChange={(e) => set({ warrantyMonths: e.target.value, warrantyManual: false })} data-asset="warrantyMonths">
            <option value="">{k('notSet')}</option>
            {MONTH_CHOICES.map((m) => <option key={m} value={String(m)}>{m === 0 ? k('noWarranty') : k('months', { count: m })}</option>)}
            <option value="custom">{k('otherMonths')}</option>
          </select>
          {value.warrantyMonths === 'custom' && (
            <input type="number" min={1} max={240} className={`${input} w-24`} value={value.customMonths} placeholder={k('monthsShort')}
              onChange={(e) => set({ customMonths: e.target.value })} data-asset="customMonths" />
          )}
        </div>
      </div>
      <div>
        <label className={label}>{k('countFrom')}</label>
        <select className={input} value={value.warrantyFrom} onChange={(e) => set({ warrantyFrom: e.target.value as AssetForm['warrantyFrom'] })} data-asset="warrantyFrom">
          <option value="purchase">{k('fromPurchase')}</option>
          <option value="install">{k('fromInstall')}</option>
        </select>
      </div>
      <div className="sm:col-span-2 rounded-lg border border-slate-700/70 bg-slate-900/50 p-2.5 text-xs space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-slate-300">
            {k('warrantyEnds')}: <b className="text-white" data-asset-end>{end ? formatDate(end, i18n.language) : '—'}</b>
            {!value.warrantyManual && end && <span className="text-slate-500"> · {k('worked')}</span>}
          </span>
          <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
            <input type="checkbox" checked={value.warrantyManual} onChange={(e) => set({ warrantyManual: e.target.checked, warrantyUntil: e.target.checked ? (value.warrantyUntil || end) : value.warrantyUntil })}
              className="rounded border-slate-700 bg-slate-950 text-cyan-600 focus:ring-0" data-asset="warrantyManual" />
            {k('typeEnd')}
          </label>
        </div>
        {value.warrantyManual && (
          <DatePicker name="warrantyUntil" value={value.warrantyUntil} onChange={(v) => set({ warrantyUntil: v })} />
        )}
      </div>
      <div className="sm:col-span-2">
        <label className={label}>{k('vendor')}</label>
        <select className={input} value={value.vendorCode} onChange={(e) => set({ vendorCode: e.target.value })} data-asset="vendorCode">
          <option value="">{k('notSet')}</option>
          {vendors.map((v) => <option key={v.code} value={v.code}>{v.name}</option>)}
          {missingVendor && <option value={value.vendorCode}>{value.vendorCode}</option>}
        </select>
        {vendor && (vendor.contactName || vendor.phone || vendor.email) && (
          <p className="mt-1 text-[11px] text-slate-400">{[vendor.contactName, vendor.phone, vendor.email].filter(Boolean).join(' · ')}</p>
        )}
        {vendors.length === 0 && <p className="mt-1 text-[11px] text-amber-400">{k('noVendors')}</p>}
      </div>
      <div>
        <label className={label}>{k('installer')}</label>
        <input className={input} maxLength={200} value={value.installer} onChange={(e) => set({ installer: e.target.value })} data-asset="installer" />
      </div>
      <div>
        <label className={label}>{k('poNumber')}</label>
        <input className={input} maxLength={64} value={value.poNumber} onChange={(e) => set({ poNumber: e.target.value })} data-asset="poNumber" />
      </div>
      <div>
        <label className={label}>{k('assetTag')}</label>
        <input className={input} maxLength={64} value={value.assetTag} onChange={(e) => set({ assetTag: e.target.value })} data-asset="assetTag" />
      </div>
      {options?.canPrice && (
        <div>
          <label className={label}>{k('price')}</label>
          <input type="text" inputMode="decimal" className={input} value={value.purchasePrice} onChange={(e) => set({ purchasePrice: e.target.value.replace(/[^\d.,]/g, '') })} data-asset="purchasePrice" />
        </div>
      )}
      <div className="sm:col-span-2">
        <label className={label}>{k('notes')}</label>
        <textarea rows={2} maxLength={2000} className={input} value={value.notes} onChange={(e) => set({ notes: e.target.value })} data-asset="notes" />
      </div>
    </div>
  );
}
