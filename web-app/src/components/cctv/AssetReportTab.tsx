import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Download, Loader2, Search, Upload } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { hasPermission } from '@/App';
import { imageServiceApi } from '@/services/imageServiceApi';
import { Button, ExportButton, Modal, TableSkeleton } from '@/components/ui';
import { formatDate } from '@/utils/dateUtils';
import { downloadCsv, parseCsv, toCsv } from '@/lib/csv';
import { WarrantyBadge } from './AssetCard';

const STATUSES = ['expiring', 'expired', 'active', 'none'] as const;
const AGES = ['under1', '1to3', '3to5', 'over5', 'unknown'] as const;

/**
 * Purchase and warranty of every recorder and camera within reach (phase 5.5): what ends soon, per vendor, how often
 * each vendor's and model's equipment failed in the past year, and how old it is, for planning replacements.
 */
export function AssetReportTab() {
  const { t, i18n } = useTranslation();
  const k = (key: string, o?: Record<string, unknown>) => String(t(`ui.assets.${key}`, o as any));
  const { themeConfig } = useTheme();
  const { user } = useAuth();
  const canEdit = hasPermission(user, 'cameras:update');
  const { data, isLoading } = useQuery<any>({ queryKey: ['asset-report'], queryFn: imageServiceApi.getAssetReport, staleTime: 30_000 });
  const [status, setStatus] = useState<string>('all');
  const [kind, setKind] = useState<string>('all');
  const [q, setQ] = useState('');
  const [importing, setImporting] = useState(false);
  const rows: any[] = data?.rows ?? [];
  const canPrice = rows.some((r) => r.record && 'purchasePrice' in r.record);
  const fmt = (d?: string | null) => (d ? formatDate(d, i18n.language) : '—');
  const money = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString(i18n.language === 'th' ? 'th-TH' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows
      .filter((r) => (status === 'all' || r.warrantyStatus === status) && (kind === 'all' || r.kind === kind))
      .filter((r) => !term || [r.name, r.deviceName, r.siteName, r.zoneName, r.brand, r.model, r.vendorName, r.record?.assetTag, r.record?.poNumber, r.serialNumber].some((v) => v && String(v).toLowerCase().includes(term)))
      .sort((a, b) => (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999) || String(a.name).localeCompare(String(b.name), 'th'));
  }, [rows, status, kind, q]);

  const kindText = (r: any) => (r.kind === 'device' ? k('kind_device') : k('kind_camera'));
  const exportRows = shown.map((r) => ({
    kind: kindText(r), name: r.name, recorder: r.deviceName ? `${r.deviceName}${r.channel ? ` CH${r.channel}` : ''}` : '', site: [r.siteName, r.zoneName].filter(Boolean).join(' / '),
    brandModel: [r.brand, r.model].filter(Boolean).join(' '), serial: r.serialNumber ?? '', vendor: r.vendorName ?? '', purchase: r.record?.purchaseDate ?? '', install: r.record?.installDate ?? '',
    months: r.record?.warrantyMonths ?? '', until: r.record?.warrantyUntil ?? '', status: k(`status_${r.warrantyStatus}`), daysLeft: r.daysLeft ?? '', age: r.ageYears ?? '',
    installer: r.record?.installer ?? '', po: r.record?.poNumber ?? '', assetTag: r.record?.assetTag ?? '', faults: r.faults12m, inherited: r.inherited ? k('yes') : '',
    ...(canPrice ? { price: r.inherited ? '' : r.record?.purchasePrice ?? '' } : {}),
  }));
  const col = (key: string, label: string) => ({ key, label });

  if (isLoading) return <div className="p-6"><TableSkeleton rows={8} /></div>;
  const s = data ?? { status: {}, ages: {}, byVendor: [], byModel: [], expiringByMonth: [], total: 0, withRecord: 0 };
  const maxMonth = Math.max(1, ...s.expiringByMonth.map((m: any) => m.count));
  const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(i18n.language === 'th' ? 'th-TH' : 'en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="p-6 space-y-5" data-asset-report>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={`text-lg font-semibold ${themeConfig.text.primary}`}>{k('reportTitle')}</h2>
          <p className={`text-xs ${themeConfig.text.secondary}`}>{k('reportHint', { days: data?.soonDays ?? 90, withRecord: s.withRecord, total: s.total })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && <Button variant="secondary" onClick={() => setImporting(true)} data-asset-import-open><Upload size={14} className="mr-1" />{k('importSheet')}</Button>}
          <ExportButton
            filename={`asset_warranty_${data?.day ?? ''}`}
            title={k('reportTitle')}
            sections={[
              { title: k('reportTitle'), columns: [col('kind', k('kind')), col('name', k('name')), col('recorder', k('recorder')), col('site', k('site')), col('brandModel', k('brandModel')), col('serial', 'S/N'), col('vendor', k('vendor')), col('purchase', k('purchaseDate')), col('install', k('installDate')), col('months', k('warrantyMonthsCol')), col('until', k('warrantyEnds')), col('status', k('status')), col('daysLeft', k('daysLeftCol')), col('age', k('ageYearsCol')), col('installer', k('installer')), col('po', k('poNumber')), col('assetTag', k('assetTag')), col('faults', k('faults12m')), col('inherited', k('inheritedCol')), ...(canPrice ? [col('price', k('price'))] : [])], data: exportRows },
              { title: k('byVendor'), columns: [col('vendor', k('vendor')), col('items', k('items')), col('active', k('status_active')), col('expiring', k('status_expiring')), col('expired', k('status_expired')), col('faults', k('faults12m')), col('faultsPerItem', k('faultsPerItem')), ...(canPrice ? [col('price', k('priceTotal'))] : [])], data: s.byVendor },
              { title: k('byModel'), columns: [col('brand', k('brand')), col('model', k('model')), col('items', k('items')), col('faults', k('faults12m')), col('faultsPerItem', k('faultsPerItem'))], data: s.byModel },
              { title: k('byMonth'), columns: [col('month', k('month')), col('count', k('items'))], data: s.expiringByMonth },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {STATUSES.map((st) => (
          <button key={st} type="button" onClick={() => setStatus(status === st ? 'all' : st)} data-asset-tile={st}
            className={`p-3 rounded-xl border text-left ${themeConfig.card} ${status === st ? 'ring-1 ring-cyan-500/60' : ''}`}>
            <div className="mb-1"><WarrantyBadge status={st} daysLeft={st === 'expiring' ? data?.soonDays ?? 90 : null} /></div>
            <div className={`text-2xl font-bold ${themeConfig.text.primary}`}>{s.status[st] ?? 0}</div>
            <div className={`text-[11px] ${themeConfig.text.secondary}`}>{k(`tile_${st}`, { days: data?.soonDays ?? 90 })}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`p-4 rounded-xl border ${themeConfig.card}`}>
          <h3 className={`text-sm font-semibold mb-3 ${themeConfig.text.primary}`}>{k('byMonth')}</h3>
          {s.expiringByMonth.length === 0 ? <p className={`text-sm ${themeConfig.text.secondary}`}>{k('nothingEnds')}</p> : (
            <div className="space-y-1.5">
              {s.expiringByMonth.map((m: any) => (
                <div key={m.month} className="flex items-center gap-2 text-xs">
                  <span className={`w-24 shrink-0 ${themeConfig.text.secondary}`}>{monthName(m.month)}</span>
                  <div className="flex-1 h-3 rounded bg-white/5 overflow-hidden"><div className="h-full bg-amber-500/70" style={{ width: `${(m.count / maxMonth) * 100}%` }} /></div>
                  <span className={`w-8 text-right ${themeConfig.text.primary}`}>{m.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className={`p-4 rounded-xl border ${themeConfig.card}`}>
          <h3 className={`text-sm font-semibold mb-3 ${themeConfig.text.primary}`}>{k('byAge')}</h3>
          <div className="grid grid-cols-5 gap-2 text-center">
            {AGES.map((a) => (
              <div key={a} className="rounded-lg bg-white/5 p-2">
                <div className={`text-lg font-bold ${a === 'over5' && s.ages[a] ? 'text-amber-300' : themeConfig.text.primary}`}>{s.ages[a] ?? 0}</div>
                <div className={`text-[10px] ${themeConfig.text.secondary}`}>{k(`age_${a}`)}</div>
              </div>
            ))}
          </div>
          <p className={`mt-2 text-[11px] ${themeConfig.text.secondary}`}>{k('ageHint')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`p-4 rounded-xl border ${themeConfig.card} overflow-x-auto`}>
          <h3 className={`text-sm font-semibold mb-3 ${themeConfig.text.primary}`}>{k('byVendor')}</h3>
          <table className="w-full text-xs">
            <thead><tr className={themeConfig.text.secondary}><th className="text-left py-1">{k('vendor')}</th><th className="text-right">{k('items')}</th><th className="text-right">{k('status_expiring')}</th><th className="text-right">{k('status_expired')}</th><th className="text-right">{k('faultsPerItem')}</th>{canPrice && <th className="text-right">{k('priceTotal')}</th>}</tr></thead>
            <tbody>{s.byVendor.map((v: any) => (
              <tr key={v.vendor} className={`border-t border-white/5 ${themeConfig.text.primary}`}><td className="py-1">{v.vendor}</td><td className="text-right">{v.items}</td><td className="text-right">{v.expiring}</td><td className="text-right">{v.expired}</td><td className="text-right">{v.faultsPerItem}</td>{canPrice && <td className="text-right">{money(v.price)}</td>}</tr>
            ))}</tbody>
          </table>
        </div>
        <div className={`p-4 rounded-xl border ${themeConfig.card} overflow-x-auto`}>
          <h3 className={`text-sm font-semibold mb-1 ${themeConfig.text.primary}`}>{k('byModel')}</h3>
          <p className={`text-[11px] mb-2 ${themeConfig.text.secondary}`}>{k('byModelHint')}</p>
          <table className="w-full text-xs">
            <thead><tr className={themeConfig.text.secondary}><th className="text-left py-1">{k('brandModel')}</th><th className="text-right">{k('items')}</th><th className="text-right">{k('faults12m')}</th><th className="text-right">{k('faultsPerItem')}</th></tr></thead>
            <tbody>{s.byModel.length === 0 ? <tr><td colSpan={4} className={`py-2 ${themeConfig.text.secondary}`}>—</td></tr> : s.byModel.map((m: any) => (
              <tr key={`${m.brand}|${m.model}`} className={`border-t border-white/5 ${themeConfig.text.primary}`}><td className="py-1">{m.brand} {m.model}</td><td className="text-right">{m.items}</td><td className="text-right">{m.faults}</td><td className="text-right">{m.faultsPerItem}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className={`rounded-xl border ${themeConfig.card}`}>
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-white/5">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={k('search')} className="w-full pl-8 pr-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm text-white" data-asset-search />
          </div>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="py-2 px-2 rounded-md bg-slate-950 border border-slate-700 text-sm text-white">
            <option value="all">{k('allKinds')}</option><option value="device">{k('kind_device')}</option><option value="camera">{k('kind_camera')}</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="py-2 px-2 rounded-md bg-slate-950 border border-slate-700 text-sm text-white" data-asset-status-filter>
            <option value="all">{k('allStatuses')}</option>{STATUSES.map((st) => <option key={st} value={st}>{k(`status_${st}`)}</option>)}
          </select>
          <span className={`text-xs ${themeConfig.text.secondary}`}>{shown.length} / {rows.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={themeConfig.tableHeader}>
              <tr className={themeConfig.text.primary}>
                {[k('name'), k('recorder'), k('vendor'), k('purchaseDate'), k('installDate'), k('warrantyEnds'), k('status'), k('ageYearsCol'), k('faults12m'), ...(canPrice ? [k('price')] : [])].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? <tr><td colSpan={10} className={`px-3 py-6 text-center ${themeConfig.text.secondary}`}>{t('common.noData')}</td></tr> : shown.map((r) => (
                <tr key={`${r.kind}-${r.id}`} className={`border-t border-white/5 ${themeConfig.text.primary}`} data-asset-row={r.id}>
                  <td className="px-3 py-2">
                    <Link to={r.kind === 'camera' ? `/cctv/cameras/${r.id}` : `/cctv/devices?device=${r.id}`} className="hover:text-cyan-300">{r.name}</Link>
                    <div className={`text-[10px] ${themeConfig.text.secondary}`}>{kindText(r)}{r.brand || r.model ? ` · ${[r.brand, r.model].filter(Boolean).join(' ')}` : ''}{r.record?.assetTag ? ` · ${r.record.assetTag}` : ''}</div>
                  </td>
                  <td className={`px-3 py-2 ${themeConfig.text.secondary}`}>{r.deviceName ? `${r.deviceName}${r.channel ? ` CH${r.channel}` : ''}` : '—'}</td>
                  <td className="px-3 py-2">{r.vendorName ?? '—'}{r.inherited && <div className={`text-[10px] ${themeConfig.text.secondary}`}>{k('inheritedShort')}</div>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmt(r.record?.purchaseDate)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmt(r.record?.installDate)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmt(r.record?.warrantyUntil)}</td>
                  <td className="px-3 py-2"><WarrantyBadge status={r.warrantyStatus} daysLeft={r.daysLeft} /></td>
                  <td className="px-3 py-2">{r.ageYears ?? '—'}</td>
                  <td className="px-3 py-2">{r.faults12m}</td>
                  {canPrice && <td className="px-3 py-2 text-right">{r.inherited ? '' : money(r.record?.purchasePrice)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {importing && <AssetImportModal rows={rows} canPrice={canPrice} onClose={() => setImporting(false)} />}
    </div>
  );
}

const SHEET = ['kind', 'id', 'name', 'recorder', 'channel', 'uses_recorder_card', 'purchase_date', 'install_date', 'warranty_months', 'warranty_from', 'warranty_until', 'vendor', 'installer', 'po_number', 'asset_tag', 'purchase_price', 'warranty_end_now'];

/**
 * Fill many cards at once: download the sheet with every recorder and camera listed, fill the columns, upload, see what
 * would change, then apply. An empty cell leaves that field alone; warranty_until only when the card gives a date
 * of its own (otherwise it is worked out from the months). warranty_end_now is for reading only.
 */
function AssetImportModal({ rows, canPrice, onClose }: { rows: any[]; canPrice: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const k = (key: string, o?: Record<string, unknown>) => String(t(`ui.assets.${key}`, o as any));
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<any[] | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const download = () => {
    // A camera that uses its recorder's card is listed empty: filling it gives it a card of its own.
    const data = rows.map((r) => {
      const own = r.inherited ? null : r.record;
      return {
        kind: r.kind, id: r.id, name: r.name, recorder: r.deviceName ?? '', channel: r.channel ?? '', uses_recorder_card: r.inherited ? 'yes' : '',
        purchase_date: own?.purchaseDate ?? '', install_date: own?.installDate ?? '', warranty_months: own?.warrantyMonths ?? '', warranty_from: own ? own.warrantyFrom : '',
        warranty_until: own?.warrantyManual ? own.warrantyUntil ?? '' : '', vendor: own?.vendorCode ?? '', installer: own?.installer ?? '', po_number: own?.poNumber ?? '',
        asset_tag: own?.assetTag ?? '', purchase_price: canPrice ? own?.purchasePrice ?? '' : '', warranty_end_now: r.record?.warrantyUntil ?? '',
      };
    });
    downloadCsv('asset-warranty-sheet.csv', toCsv(SHEET, data));
  };

  const send = (list: any[], dryRun: boolean) => imageServiceApi.importAssets(list, dryRun);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const parsed = parseCsv(await file.text());
      if (!parsed.length || !('id' in parsed[0]) || !('kind' in parsed[0])) { toast.error(k('sheetNoId')); return; }
      const list = parsed.filter((r) => r.id?.trim() && ['device', 'camera'].includes(r.kind?.trim())).map((r) => ({
        kind: r.kind.trim(), id: r.id.trim(), purchaseDate: r.purchase_date ?? '', installDate: r.install_date ?? '', warrantyMonths: r.warranty_months ?? '',
        warrantyFrom: r.warranty_from ?? '', warrantyUntil: r.warranty_until ?? '', vendor: r.vendor ?? '', installer: r.installer ?? '', poNumber: r.po_number ?? '',
        assetTag: r.asset_tag ?? '', purchasePrice: r.purchase_price ?? '',
      }));
      setItems(list);
      setPreview(await send(list, true));
    } catch (err: any) {
      if (!err?._handled) toast.error(err?.response?.status === 403 ? k('sheetNotYours') : err?.response?.data?.message || k('sheetFailed'));
      setItems(null); setPreview(null);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const apply = async () => {
    if (!items) return;
    setBusy(true);
    try {
      const r = await send(items, false);
      toast.success(k('sheetApplied', { count: r.applied }));
      qc.invalidateQueries({ queryKey: ['asset-report'] });
      qc.invalidateQueries({ queryKey: ['asset'] });
      onClose();
    } catch (err: any) {
      if (!err?._handled) toast.error(err?.response?.data?.message || k('sheetFailed'));
    } finally { setBusy(false); }
  };
  const errText = (e: string) => k(`sheetError_${e.split(':')[0]}`, { field: e.split(':')[1] ?? '' });

  return (
    <Modal isOpen onClose={onClose} title={k('importSheet')} size="lg">
      <div className="space-y-4 text-sm text-slate-200" data-asset-import>
        <ol className="list-decimal pl-5 space-y-1 text-xs text-slate-300">
          <li>{k('sheetStep1')}</li><li>{k('sheetStep2')}</li><li>{k('sheetStep3')}</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={download}><Download size={14} className="mr-1" />{k('sheetDownload')}</Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Upload size={14} className="mr-1" />}{k('sheetUpload')}</Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} data-asset-file />
        </div>
        {preview && (
          <div className="space-y-2">
            <p className="flex items-center gap-2" data-asset-preview>
              {preview.counts.error ? <AlertTriangle size={16} className="text-amber-400" /> : <CheckCircle2 size={16} className="text-emerald-400" />}
              {k('sheetCounts', { update: preview.counts.update, same: preview.counts.same, error: preview.counts.error })}
            </p>
            <div className="max-h-64 overflow-y-auto rounded border border-slate-800">
              <table className="w-full text-xs">
                <tbody>{preview.results.filter((r: any) => r.status !== 'same').map((r: any) => (
                  <tr key={`${r.kind}-${r.id}`} className="border-t border-slate-800">
                    <td className="px-2 py-1">{r.name ?? r.id}</td>
                    <td className={`px-2 py-1 ${r.status === 'error' ? 'text-rose-300' : 'text-emerald-300'}`}>{r.status === 'error' ? r.errors.map(errText).join(', ') : r.fields.map((f: string) => k(`field_${f}`)).join(', ')}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {preview.counts.error > 0 && <p className="text-xs text-amber-300">{k('sheetFixFirst')}</p>}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
          <Button onClick={apply} disabled={busy || !preview || preview.counts.error > 0 || preview.counts.update === 0} data-asset-apply>{k('sheetApply', { count: preview?.counts.update ?? 0 })}</Button>
        </div>
      </div>
    </Modal>
  );
}
