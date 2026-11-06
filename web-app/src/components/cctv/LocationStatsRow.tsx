import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, ClipboardList, List, Radio, Server } from 'lucide-react';
import type { LocationStats } from '@/lib/locationSummary';

/** The counts, wherever they are shown. */
export function LocationStatsLine({ stats, query }: { stats?: LocationStats; query?: string }) {
  const { t } = useTranslation();
  const s = stats ?? { inUse: 0, online: 0, problem: 0, switchedOff: 0, devices: 0, spare: 0 };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]" data-location-stats>
      <span className="text-slate-200 font-semibold">{t('ui.location.statCameras', { n: s.inUse })}</span>
      {s.online > 0 && <span className="text-emerald-400">{t('ui.location.statOnline', { n: s.online })}</span>}
      {s.problem > 0 && (query
        ? <Link to={`/cctv/cameras?${query}&state=problem`} className="text-rose-400 underline decoration-dotted hover:text-rose-300">{t('ui.location.statProblem', { n: s.problem })}</Link>
        : <span className="text-rose-400">{t('ui.location.statProblem', { n: s.problem })}</span>)}
      {s.switchedOff > 0 && (query
        ? <Link to={`/cctv/cameras?${query}&state=off`} className="text-slate-400 underline decoration-dotted hover:text-slate-200">{t('ui.location.statOff', { n: s.switchedOff })}</Link>
        : <span className="text-slate-400">{t('ui.location.statOff', { n: s.switchedOff })}</span>)}
      {s.devices > 0 && <span className="text-slate-400">{t('ui.location.statDevices', { n: s.devices })}</span>}
      {s.spare > 0 && <span className="text-slate-400">{t('ui.location.statSpare', { n: s.spare })}</span>}
    </div>
  );
}

/** What is in a place and where to go from here. `query` picks the place, e.g. "site=…&zone=…". */
export function LocationStatsRow({ stats, query }: { stats?: LocationStats; query: string }) {
  const { t } = useTranslation();
  const s = stats ?? { inUse: 0, online: 0, problem: 0, switchedOff: 0, devices: 0, spare: 0 };
  return (
    <div className="space-y-2">
      <LocationStatsLine stats={stats} query={query} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Link
          to={`/cctv/live-grid?${query}`}
          aria-disabled={s.inUse === 0}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition ${s.inUse > 0 ? 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20' : 'border-slate-800 text-slate-600 pointer-events-none'}`}
        >
          <Radio className="w-3 h-3" />
          {t('ui.location.openLive')}
        </Link>
        <Link to={`/cctv/incidents?${query}`} title={t('ui.location.openIncidents')} aria-label={t('ui.location.openIncidents')} className="inline-flex items-center justify-center w-7 h-[26px] rounded-md border border-slate-700 text-slate-300 hover:border-cyan-500 hover:text-cyan-300 transition">
          <ClipboardList className="w-3.5 h-3.5" />
        </Link>
        <Link to={`/cctv/alerts?${query}`} title={t('ui.location.openAlerts')} aria-label={t('ui.location.openAlerts')} className="inline-flex items-center justify-center w-7 h-[26px] rounded-md border border-slate-700 text-slate-300 hover:border-cyan-500 hover:text-cyan-300 transition">
          <Bell className="w-3.5 h-3.5" />
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Link to={`/cctv/cameras?${query}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-slate-700 text-slate-300 hover:border-cyan-500 hover:text-cyan-300 transition">
          <List className="w-3 h-3" />
          {t('ui.location.openCameras')}
        </Link>
        <Link to={`/cctv/devices?${query}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-slate-700 text-slate-300 hover:border-cyan-500 hover:text-cyan-300 transition">
          <Server className="w-3 h-3" />
          {t('ui.location.openDevices')}
        </Link>
      </div>
    </div>
  );
}
