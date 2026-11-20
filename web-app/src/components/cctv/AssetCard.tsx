import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, ShieldAlert, ShieldOff, Shield, Pencil, Undo2 } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { useToast } from '@/contexts/ToastContext';
import { useTheme } from '@/contexts/ThemeContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { formatDate } from '@/utils/dateUtils';
import { assetToForm, formToPayload, type AssetForm } from '@/lib/warranty';
import { AssetFields, useAssetOptions } from './AssetFields';

export const WARRANTY_STYLE: Record<string, { cls: string; Icon: typeof Shield }> = {
  active: { cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', Icon: ShieldCheck },
  expiring: { cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', Icon: ShieldAlert },
  expired: { cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30', Icon: ShieldOff },
  none: { cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30', Icon: Shield },
};

export function WarrantyBadge({ status, daysLeft }: { status: string; daysLeft: number | null }) {
  const { t } = useTranslation();
  const s = WARRANTY_STYLE[status] ?? WARRANTY_STYLE.none;
  const text = status === 'expiring' || status === 'active'
    ? t('ui.assets.daysLeft', { count: daysLeft ?? 0 })
    : status === 'expired' ? t('ui.assets.status_expired') : t('ui.assets.status_none');
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${s.cls}`} data-warranty-status={status}>
      <s.Icon size={12} />{text}
    </span>
  );
}

/**
 * Purchase and warranty of one recorder or camera: shown on its page, changed in a window. A channel camera without a
 * card of its own shows its recorder's; giving it its own card leaves the recorder's alone.
 */
export function AssetCard({ kind, id, canEdit }: { kind: 'device' | 'camera'; id: string; canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  const k = (key: string, o?: Record<string, unknown>) => String(t(`ui.assets.${key}`, o as any));
  const { themeConfig } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['asset', kind, id], queryFn: () => imageServiceApi.getAsset(kind, id) });
  const { data: options } = useAssetOptions();
  const [form, setForm] = useState<AssetForm | null>(null);
  const done = () => { qc.invalidateQueries({ queryKey: ['asset', kind, id] }); qc.invalidateQueries({ queryKey: ['asset-report'] }); };
  const save = useMutation({
    mutationFn: (f: AssetForm) => imageServiceApi.saveAsset(kind, id, formToPayload(f, !!options?.canPrice)),
    onSuccess: () => { done(); setForm(null); toast.success(t('common.saveSuccess')); },
    onError: (e: any) => { if (!e?._handled) toast.error(e?.response?.data?.message || t('common.error')); },
  });
  const revert = useMutation({
    mutationFn: () => imageServiceApi.deleteAsset(kind, id),
    onSuccess: () => { done(); toast.success(k('reverted')); },
    onError: (e: any) => { if (!e?._handled) toast.error(t('common.error')); },
  });

  const rec = data?.effective;
  const fmt = (d?: string | null) => (d ? formatDate(d, i18n.language) : '—');
  const v = data?.vendor;
  const rows: Array<[string, string]> = rec ? [
    [k('purchaseDate'), fmt(rec.purchaseDate)],
    [k('installDate'), fmt(rec.installDate)],
    [k('warranty'), rec.warrantyMonths == null ? '—' : rec.warrantyMonths === 0 ? k('noWarranty') : `${k('months', { count: rec.warrantyMonths })} · ${rec.warrantyFrom === 'install' ? k('fromInstall') : k('fromPurchase')}`],
    [k('warrantyEnds'), fmt(rec.warrantyUntil)],
    [k('vendor'), v ? [v.name, v.contactName, v.phone, v.email].filter(Boolean).join(' · ') : rec.vendorCode || '—'],
    [k('installer'), rec.installer || '—'],
    [k('poNumber'), rec.poNumber || '—'],
    [k('assetTag'), rec.assetTag || '—'],
    ...(data?.canPrice ? [[k('price'), rec.purchasePrice == null ? '—' : Number(rec.purchasePrice).toLocaleString(i18n.language === 'th' ? 'th-TH' : 'en-GB', { minimumFractionDigits: 2 })] as [string, string]] : []),
    [k('age'), data?.ageYears == null ? '—' : k('years', { count: data.ageYears })],
    ...(rec.notes ? [[k('notes'), rec.notes] as [string, string]] : []),
  ] : [];

  return (
    <div className={`p-4 rounded-xl border ${themeConfig.card} mb-6`} data-asset-card={kind}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className={`text-sm font-semibold ${themeConfig.text.primary} flex items-center gap-2`}>
          {k('cardTitle')}
          {data && <WarrantyBadge status={data.warranty.status} daysLeft={data.warranty.daysLeft} />}
        </h3>
        {canEdit && (
          <div className="flex gap-2">
            {kind === 'camera' && data?.own && data?.device && (
              <Button size="sm" variant="secondary" onClick={() => revert.mutate()} disabled={revert.isPending} title={k('revertHint')}>
                <Undo2 size={14} className="mr-1" />{k('revert')}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setForm(assetToForm(data?.own ?? (data?.inherited ? data?.device : null)))} data-asset-edit>
              <Pencil size={14} className="mr-1" />{data?.own ? k('edit') : data?.inherited ? k('ownCard') : k('add')}
            </Button>
          </div>
        )}
      </div>
      {data?.inherited && <p className={`text-xs mb-2 ${themeConfig.text.secondary}`} data-asset-inherited>{k('fromDevice', { name: data.deviceName ?? '' })}</p>}
      {rec ? (
        <dl className="grid grid-cols-[auto,1fr] sm:grid-cols-[auto,1fr,auto,1fr] gap-y-2 gap-x-4 text-sm">
          {rows.map(([a, b]) => (
            <div key={a} className="contents">
              <dt className={themeConfig.text.secondary}>{a}</dt>
              <dd className={`${themeConfig.text.primary} break-words`}>{b}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className={`text-sm ${themeConfig.text.secondary}`}>{k('empty')}</p>
      )}
      {form && (
        <Modal isOpen onClose={() => setForm(null)} title={k('cardTitle')} size="lg">
          <div className="space-y-4 text-slate-200">
            {kind === 'camera' && data?.inherited && !data?.own && <p className="text-xs text-slate-400">{k('ownCardHint', { name: data.deviceName ?? '' })}</p>}
            <AssetFields value={form} onChange={setForm} options={options} />
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <Button variant="secondary" onClick={() => setForm(null)}>{t('common.cancel')}</Button>
              <Button onClick={() => save.mutate(form)} disabled={save.isPending} data-asset-save>{t('common.save')}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * One line on a work order: is the camera (or its recorder) still under warranty, and with whom. `onUseVendor` fills
 * the work order's company and phone from the vendor.
 */
export function WarrantyStrip({ cameraId, onUseVendor }: { cameraId: string; onUseVendor?: (v: { name: string; phone: string | null; contactName: string | null }) => void }) {
  const { t, i18n } = useTranslation();
  const k = (key: string, o?: Record<string, unknown>) => String(t(`ui.assets.${key}`, o as any));
  const { data } = useQuery({ queryKey: ['asset', 'camera', cameraId], queryFn: () => imageServiceApi.getAsset('camera', cameraId), retry: false });
  if (!data?.effective) return null;
  const v = data.vendor;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-900/50 px-3 py-2 text-xs text-slate-300" data-warranty-strip={data.warranty.status}>
      <WarrantyBadge status={data.warranty.status} daysLeft={data.warranty.daysLeft} />
      {data.warranty.until && <span>{k('warrantyEnds')} {formatDate(data.warranty.until, i18n.language)}</span>}
      {data.inherited && <span className="text-slate-500">({k('inheritedShort')})</span>}
      {v && <span>· {[v.name, v.contactName, v.phone].filter(Boolean).join(' · ')}</span>}
      {v && onUseVendor && (data.warranty.status === 'active' || data.warranty.status === 'expiring') && (
        <button type="button" className="ml-auto text-cyan-400 hover:underline" onClick={() => onUseVendor(v)} data-use-vendor>{k('useVendor')}</button>
      )}
    </div>
  );
}
