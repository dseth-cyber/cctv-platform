import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, HardDrive, Info, MemoryStick, Network } from 'lucide-react';
import { HEADROOM, liveOnlySizing, MEASURED } from '@/lib/liveSizing';

/** Sizing for recording kept on the DVR/NVRs (the system as it runs): load follows who watches, not camera count. */
export function LiveOnlySizing({ cameras, onCamerasChange, mainKbps, subKbps }: { cameras: number; onCamerasChange: (n: number) => void; mainKbps: number; subKbps: number }) {
  const { t } = useTranslation();
  const k = (key: string, opts?: Record<string, unknown>) => String(t(`ui.liveSizing.${key}`, opts as any));
  const [viewers, setViewers] = useState(10);
  const [perViewer, setPerViewer] = useState(16);
  const [conversions, setConversions] = useState(2);
  const r = useMemo(() => liveOnlySizing({ cameras, viewers, streamsPerViewer: perViewer, conversions, mainKbps, subKbps }), [cameras, viewers, perViewer, conversions, mainKbps, subKbps]);

  const slider = (label: string, value: number, set: (n: number) => void, min: number, max: number, suffix: string) => (
    <div className="space-y-2 bg-slate-950 p-4 rounded-xl border border-slate-800">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400 font-medium">{label}</span>
        <span className="font-mono font-bold text-cyan-400">{value} {suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => set(Number(e.target.value))} className="w-full accent-cyan-400 cursor-pointer" />
    </div>
  );
  const row = (label: string, value: string, strong = false) => (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className={`font-mono ${strong ? 'font-bold text-amber-300' : 'text-white'}`}>{value}</span>
    </div>
  );

  return (
    <div data-live-sizing className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        {slider(k('cameras'), cameras, onCamerasChange, 1, 1200, k('cams'))}
        {slider(k('viewers'), viewers, setViewers, 0, 50, k('people'))}
        <div className="space-y-2 bg-slate-950 p-4 rounded-xl border border-slate-800">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400 font-medium">{k('perViewer')}</span>
            <span className="font-mono font-bold text-cyan-400">{perViewer} {k('tiles')}</span>
          </div>
          <div className="flex gap-1.5">
            {[1, 4, 9, 16].map((n) => (
              <button key={n} type="button" onClick={() => setPerViewer(n)} className={`flex-1 px-2 py-1 rounded-lg text-xs font-semibold ${perViewer === n ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                {n === 1 ? '1x1' : n === 4 ? '2x2' : n === 9 ? '3x3' : '4x4'}
              </button>
            ))}
          </div>
        </div>
        {slider(k('conversions'), conversions, setConversions, 0, 8, k('jobs'))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-slate-950 p-5 rounded-2xl border border-cyan-500/20 space-y-3">
          <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm"><Network size={16} /><span>{k('network')}</span></div>
          {row(k('sessions'), `${r.sessions}`)}
          {row(k('fromRecorders'), `${r.ingressMbps} Mbps (${r.pulledStreams} ${k('streams')})`)}
          {row(k('toViewers'), `${r.egressMbps} Mbps`)}
          {row(k('nic'), r.nic, true)}
        </div>
        <div className="bg-slate-950 p-5 rounded-2xl border border-cyan-500/20 space-y-3">
          <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm"><Cpu size={16} /><span>{k('compute')}</span></div>
          {row(k('cpuUsed'), `${r.threadsUsed} ${k('threads')}`)}
          {r.threadsFromEstimate > 0 && row(k('cpuFromEstimate'), `${r.threadsFromEstimate} ${k('threads')}`)}
          {row(k('cpuRecommended'), k('threadsRecommended', { n: r.recommendedThreads, cores: r.recommendedThreads / 2 }), true)}
          <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm pt-1"><MemoryStick size={16} /><span>RAM</span></div>
          {row(k('ramUsed'), `${r.ramUsedGb} GB`)}
          {row(k('ramRecommended'), `${r.recommendedRamGb} GB`, true)}
        </div>
        <div className="bg-slate-950 p-5 rounded-2xl border border-cyan-500/20 space-y-3">
          <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm"><HardDrive size={16} /><span>{k('storage')}</span></div>
          <p className="text-xs text-slate-300">{k('storageNote')}</p>
        </div>
      </div>

      <div data-live-sizing-basis className="flex gap-2 p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400">
        <Info className="w-4 h-4 shrink-0 text-cyan-400 mt-0.5" />
        <div className="space-y-1">
          <p>{k('basisMeasured', { date: MEASURED.measuredOn })}</p>
          <p className="text-amber-300/90">{k('basisEstimate', { cpu: MEASURED.estimatedCoresPerConversion, ram: MEASURED.estimatedRamGbPerConversion })}</p>
          <p>{k('basisHeadroom', { x: HEADROOM })}</p>
        </div>
      </div>
    </div>
  );
}
