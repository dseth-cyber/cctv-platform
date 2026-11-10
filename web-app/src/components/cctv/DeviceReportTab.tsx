import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DeviceWebLink } from '@/components/cctv/DeviceWebLink';
import { ChevronDown, ChevronsUpDown, ChevronUp, FileSpreadsheet, Search } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { ExportButton, SearchableSelect, TableSkeleton } from '@/components/ui';
import { formatDateTime } from '@/utils/dateUtils';
import { clockDriftParts, formatCapacity } from '@/lib/deviceHealth';
import { useMasterdataOptions } from '@/hooks/useMasterdataOptions';

const PERIODS = [7, 30, 90];

/** One row per DVR/NVR: what it is, how it is now, and how its cameras did over the period. */
export function DeviceReportTab() {
  const { t, i18n } = useTranslation();
  const { themeConfig } = useTheme();
  const { options: deviceTypes } = useMasterdataOptions('device_type');
  const [days, setDays] = useState(30);
  const [q, setQ] = useState('');
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ['device-report', days],
    queryFn: () => imageServiceApi.getDeviceReport(days),
    staleTime: 30_000,
  });

  const notKnown = '—';
  const label = (key: string) => t(`ui.deviceReport.${key}`);
  const driftText = (seconds: number | null) => {
    const drift = clockDriftParts(seconds);
    if (!drift) return notKnown;
    if (drift.direction === 'even') return t('ui.deviceHealth.clockEven');
    return t(drift.direction === 'ahead' ? 'ui.deviceHealth.clockAhead' : 'ui.deviceHealth.clockBehind', { min: drift.minutes, sec: drift.seconds });
  };
  const disksText = (row: any) => (row.disks.length === 0 ? notKnown : row.disks.map((d: any) => formatCapacity(d.capacityMB)).join(' + '));
  const diskState = (row: any) => {
    if (row.disks.length === 0) return notKnown;
    if (row.diskProblems.length > 0) return t('ui.deviceReport.diskProblem');
    return row.reachable === false ? t('ui.deviceHealth.stale') : t('ui.deviceHealth.allWell');
  };

  const columns: Array<{ key: string; label: string; text: (row: any) => string; sort?: (row: any) => string | number; tone?: (row: any) => string; /** What the cell shows when it is more than its text (search and export still use `text`). */ node?: (row: any) => React.ReactNode }> = [
    { key: 'name', label: label('name'), text: (r) => r.name },
    { key: 'deviceType', label: label('type'), text: (r) => deviceTypes.find((o) => o.value === r.deviceType)?.label ?? r.deviceType ?? notKnown },
    { key: 'model', label: label('model'), text: (r) => r.model ?? notKnown },
    { key: 'ipAddress', label: label('ip'), text: (r) => r.ipAddress, node: (r) => <DeviceWebLink ip={r.ipAddress} port={r.httpPort} /> },
    { key: 'siteName', label: label('site'), text: (r) => [r.siteName, r.zoneName].filter(Boolean).join(' / ') || notKnown },
    { key: 'channelsInUse', label: label('channels'), text: (r) => `${r.channelsInUse} / ${r.totalChannels}`, sort: (r) => r.channelsInUse },
    { key: 'online', label: label('online'), text: (r) => String(r.online), sort: (r) => r.online },
    { key: 'offline', label: label('offline'), text: (r) => String(r.offline), sort: (r) => r.offline, tone: (r) => (r.offline > 0 ? 'text-rose-300' : '') },
    { key: 'availability', label: label('availability'), text: (r) => (r.availability === null ? notKnown : `${r.availability}%`), sort: (r) => r.availability ?? -1 },
    { key: 'offlineEvents', label: label('offlineEvents'), text: (r) => String(r.offlineEvents), sort: (r) => r.offlineEvents },
    { key: 'incidents', label: label('incidents'), text: (r) => (r.openIncidents > 0 ? `${r.incidents} (${t('ui.deviceReport.openCount', { n: r.openIncidents })})` : String(r.incidents)), sort: (r) => r.incidents },
    { key: 'disks', label: label('disks'), text: disksText, sort: (r) => r.disks.reduce((sum: number, d: any) => sum + (d.capacityMB ?? 0), 0) },
    { key: 'diskState', label: label('diskState'), text: diskState, tone: (r) => (r.diskProblems.length > 0 ? 'text-rose-300 font-semibold' : '') },
    { key: 'retentionDays', label: label('retention'), text: (r) => (r.retentionDays === null ? notKnown : t('ui.deviceHealth.days', { n: r.retentionDays })), sort: (r) => r.retentionDays ?? -1 },
    { key: 'notRecording', label: label('notRecording'), text: (r) => r.noRecordingsAtAll ? t('ui.deviceReport.nothingRecorded') : (r.notRecording.length === 0 ? (r.disks.length === 0 ? notKnown : '0') : r.notRecording.map((c: any) => c.channel).join(', ')), sort: (r) => r.notRecording.length, tone: (r) => (r.notRecording.length > 0 ? 'text-rose-300 font-semibold' : '') },
    { key: 'smartCodec', label: label('smartCodec'), text: (r) => (r.smartCodecChannels === null ? notKnown : r.smartCodecChannels.length === 0 ? t('ui.deviceReport.off') : t('ui.deviceReport.onChannels', { n: r.smartCodecChannels.length }) + (r.healthNotesAck?.smart_codec ? ` (${t('ui.deviceReport.acknowledged')})` : '')), sort: (r) => r.smartCodecChannels?.length ?? -1, tone: (r) => ((r.smartCodecChannels?.length ?? 0) > 0 ? (r.healthNotesAck?.smart_codec ? 'text-slate-500' : 'text-amber-300') : '') },
    { key: 'subRecording', label: label('subRecording'), text: (r) => (r.subRecordingChannels === null ? notKnown : r.subRecordingChannels.length > 0 ? t('ui.deviceReport.yesDuplicate') + (r.healthNotesAck?.sub_recording ? ` (${t('ui.deviceReport.acknowledged')})` : '') : t('ui.deviceReport.no')), sort: (r) => r.subRecordingChannels?.length ?? -1, tone: (r) => ((r.subRecordingChannels?.length ?? 0) > 0 ? (r.healthNotesAck?.sub_recording ? 'text-slate-500' : 'text-amber-300') : '') },
    { key: 'clockDriftSeconds', label: label('clock'), text: (r) => driftText(r.clockDriftSeconds), sort: (r) => Math.abs(r.clockDriftSeconds ?? 0) },
    { key: 'macAddress', label: label('mac'), text: (r) => r.macAddress ?? notKnown },
    { key: 'serialNumber', label: label('serial'), text: (r) => r.serialNumber ?? notKnown },
    { key: 'firmwareVersion', label: label('firmware'), text: (r) => r.firmwareVersion ?? notKnown },
    { key: 'healthCheckedAt', label: label('checkedAt'), text: (r) => (r.healthCheckedAt ? formatDateTime(r.healthCheckedAt, i18n.language) : notKnown), sort: (r) => r.healthCheckedAt ?? '' },
  ];

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const column = columns.find((c) => c.key === sortCol);
    const value = (row: any) => (column?.sort ? column.sort(row) : column?.text(row) ?? '');
    return rows
      .filter((row) => !term || columns.some((c) => c.text(row).toLowerCase().includes(term)))
      .sort((a, b) => {
        const [x, y] = [value(a), value(b)];
        const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
        return sortDir === 'asc' ? order : -order;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sortCol, sortDir, deviceTypes, i18n.language]);

  const sortBy = (key: string) => {
    if (sortCol === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortCol(key);
      setSortDir('asc');
    }
  };

  return (
    <div data-device-report className="pt-2 px-6 pb-2.5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div>
          <h2 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('ui.deviceReport.title')}</h2>
          <p className={`text-sm ${themeConfig.text.secondary}`}>{t('ui.deviceReport.subtitle')}</p>
        </div>
        <ExportButton
          filename={`device_report_${new Date().toISOString().slice(0, 10)}`}
          title={t('ui.deviceReport.title')}
          sections={[{
            title: t('ui.deviceReport.title'),
            columns: columns.map((c) => ({ key: c.key, label: c.label })),
            data: shown.map((row) => Object.fromEntries(columns.map((c) => [c.key, c.text(row)]))),
          }]}
        />
      </div>

      <div className={`${themeConfig.card} rounded-xl p-4 mb-4 border ${themeConfig.cardBorder}`}>
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ui.deviceReport.search')}
              className={`w-full pl-9 pr-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary}`} />
          </div>
          <div className="w-44">
            <SearchableSelect value={String(days)} onChange={(v) => setDays(Number(v))} showSearch={false}
              options={PERIODS.map((n) => ({ value: String(n), label: t('ui.deviceReport.lastDays', { n }) }))} />
          </div>
        </div>
      </div>

      <div className={`${themeConfig.card} rounded-xl p-4 border ${themeConfig.cardBorder}`}>
        {isLoading ? (
          <TableSkeleton rows={4} cols={8} />
        ) : shown.length === 0 ? (
          <div className="text-center py-16">
            <FileSpreadsheet size={40} className="mx-auto text-gray-600 mb-2" />
            <p className={`text-sm ${themeConfig.text.secondary}`}>{t('common.noData')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-white/5 rounded-lg">
            <table className="w-full text-xs text-left border-collapse">
              <thead className={`${themeConfig.tableHeader} sticky top-0 z-10`}>
                <tr className={`border-b ${themeConfig.cardBorder}`}>
                  {columns.map((c) => (
                    <th key={c.key} onClick={() => sortBy(c.key)} className={`px-3 py-3 font-semibold whitespace-nowrap cursor-pointer select-none ${themeConfig.text.secondary}`}>
                      <div className="flex items-center gap-1">
                        {c.label}
                        {sortCol === c.key
                          ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" />
                          : <ChevronsUpDown size={11} className="opacity-25" />}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={themeConfig.tableDivide}>
                {shown.map((row) => (
                  <tr key={row.id} data-report-row={row.id} className={`${themeConfig.tableRow} border-b border-white/5`}>
                    {columns.map((c) => (
                      <td key={c.key} data-col={c.key} className={`px-3 py-2.5 whitespace-nowrap ${c.tone?.(row) || themeConfig.text.primary}`}>{c.node ? c.node(row) : c.text(row)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className={`mt-2 text-[11px] ${themeConfig.text.secondary}`}>{t('ui.deviceReport.note')}</p>
    </div>
  );
}
