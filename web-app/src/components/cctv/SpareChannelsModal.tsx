import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { downloadCsv, toCsv } from '@/lib/csv';
import { countSpareBy, formatChannelRanges, spareChannels } from '@/lib/deviceChannels';

const TYPE_LABEL: Record<string, string> = { dvr: 'DVR', nvr: 'NVR', ip_camera: 'IP Camera', other: 'Other' };

/**
 * Where there is room for more cameras, to weigh moving a camera or recorder against buying one. Grouped by
 * recorder type first, because an analog DVR channel and an NVR channel are not interchangeable.
 */
export function SpareChannelsModal({ devices, onClose }: { devices: any[]; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const rows = useMemo(() => spareChannels(devices), [devices]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(({ device: d }) => [d.name, d.ipAddress, d.brand, d.model, d.site?.name, d.zone?.name, TYPE_LABEL[d.deviceType]].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [rows, query]);
  const place = (d: any) => [d.site?.name, d.zone?.name].filter(Boolean).join(' / ');
  const noPlace = t('ui.location.none');

  const handleExport = () => {
    const headers = ['device', 'type', 'brand', 'model', 'ipAddress', 'site', 'zone', 'totalChannels', 'inUse', 'spare', 'spareChannels'];
    downloadCsv('spare-channels.csv', toCsv(headers, shown.map(({ device: d, total, inUse, spare }) => ({
      device: d.name,
      type: TYPE_LABEL[d.deviceType] ?? d.deviceType,
      brand: d.brand ?? '',
      model: d.model ?? '',
      ipAddress: d.ipAddress,
      site: d.site?.name ?? '',
      zone: d.zone?.name ?? '',
      totalChannels: total,
      inUse,
      spare: spare.length,
      spareChannels: formatChannelRanges(spare),
    }))));
  };

  return (
    <Modal isOpen onClose={onClose} title={t('ui.spareChannels.title')} size="5xl">
      <div className="space-y-4 text-slate-200">
        <p className="text-xs text-slate-400">{t('ui.spareChannels.hint')}</p>

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">{t('ui.spareChannels.none')}</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <div className="text-slate-400 mb-1.5">{t('ui.spareChannels.byType')}</div>
                {countSpareBy(rows, (r) => r.device.deviceType).map(([type, n]) => (
                  <div key={type} className="flex justify-between py-0.5"><span>{TYPE_LABEL[type] ?? type}</span><b>{n}</b></div>
                ))}
              </div>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <div className="text-slate-400 mb-1.5">{t('ui.spareChannels.bySite')}</div>
                {countSpareBy(rows, (r) => r.device.site?.name ?? noPlace).map(([site, n]) => (
                  <div key={site} className="flex justify-between py-0.5"><span className="truncate pr-3">{site}</span><b>{n}</b></div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('ui.spareChannels.search')}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              />
              <Button variant="secondary" onClick={handleExport} className="flex items-center gap-1.5 text-xs">
                <Download className="w-3.5 h-3.5" />
                {t('ui.deviceManagement.exportCsv')}
              </Button>
            </div>

            <div className="overflow-auto max-h-[45vh] rounded-lg border border-slate-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-900 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('imageService.cameras.columnDevice')}</th>
                    <th className="px-3 py-2 text-left">{t('ui.spareChannels.type')}</th>
                    <th className="px-3 py-2 text-left">{t('ui.location.site')} / {t('ui.location.zone')}</th>
                    <th className="px-3 py-2 text-right">{t('ui.spareChannels.inUse')}</th>
                    <th className="px-3 py-2 text-right">{t('ui.spareChannels.spare')}</th>
                    <th className="px-3 py-2 text-left">{t('ui.spareChannels.spareList')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {shown.map(({ device: d, total, inUse, spare }) => (
                    <tr key={d.id} onClick={() => navigate('/cctv/devices')} className="cursor-pointer hover:bg-slate-800/50" title={t('ui.spareChannels.openDevices')}>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-100">{d.name}</div>
                        <div className="text-[10px] font-mono text-slate-500">{d.ipAddress}{d.model ? ` · ${d.model}` : ''}</div>
                      </td>
                      <td className="px-3 py-2">{TYPE_LABEL[d.deviceType] ?? d.deviceType}</td>
                      <td className="px-3 py-2">{place(d) || <span className="text-slate-500">{noPlace}</span>}</td>
                      <td className="px-3 py-2 text-right font-mono">{inUse}/{total}</td>
                      <td className="px-3 py-2 text-right font-bold text-emerald-400">{spare.length}</td>
                      <td className="px-3 py-2 font-mono text-slate-300">{formatChannelRanges(spare)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="text-[11px] text-amber-300">{t('ui.spareChannels.caution')}</p>
      </div>
    </Modal>
  );
}
