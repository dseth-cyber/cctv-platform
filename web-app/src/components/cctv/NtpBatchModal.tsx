import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { clockDriftParts, needsNtp, type DeviceHealthInfo } from '@/lib/deviceHealth';

interface BatchItem {
  id: string;
  ok: boolean;
  code?: string;
}

/**
 * Points many recorders at the NTP server in one go. The server does them one at a time in the background;
 * this window follows along and shows what happened to each.
 */
export function NtpBatchModal({ isOpen, onClose, devices }: { isOpen: boolean; onClose: () => void; devices: any[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const candidates = useMemo(() => devices.filter((d) => needsNtp(d.brand, d.healthInfo as DeviceHealthInfo | null)), [devices]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<any>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (isOpen && !jobId) setPicked(new Set(candidates.map((d) => d.id)));
  }, [isOpen, jobId, candidates]);

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const poll = async () => {
      try {
        const state = await imageServiceApi.getDeviceClockNtpBatch(jobId);
        if (stop) return;
        setJob(state);
        if (state.status !== 'running') {
          await queryClient.invalidateQueries({ queryKey: ['cctv-devices'] });
          return;
        }
      } catch {
        if (stop) return;
      }
      setTimeout(poll, 2000);
    };
    void poll();
    return () => { stop = true; };
  }, [jobId, queryClient]);

  const close = () => {
    if (job?.status === 'running') return;
    setJobId(null);
    setJob(null);
    onClose();
  };

  const start = async () => {
    setStarting(true);
    try {
      const ids = candidates.filter((d) => picked.has(d.id)).map((d) => d.id);
      const res = await imageServiceApi.startDeviceClockNtpBatch(ids);
      setJob({ status: 'running', total: ids.length, done: 0, result: { items: [] } });
      setJobId(res.jobId);
    } catch (err: any) {
      const code = err?.response?.data?.details?.code;
      if (!err?._handled) toast.error(t(code === 'NTP_BATCH_BUSY' ? 'ui.deviceHealth.batch.busy' : 'ui.deviceHealth.ntpError.failed'));
    } finally {
      setStarting(false);
    }
  };

  const nameOf = (id: string) => devices.find((d) => d.id === id)?.name ?? id;
  const driftText = (seconds: number | null | undefined) => {
    const drift = clockDriftParts(seconds);
    if (!drift) return '—';
    if (drift.direction === 'even') return t('ui.deviceHealth.clockEven');
    return t(drift.direction === 'ahead' ? 'ui.deviceHealth.clockAhead' : 'ui.deviceHealth.clockBehind', { min: drift.minutes, sec: drift.seconds });
  };
  const items: BatchItem[] = job?.result?.items ?? [];
  const reason = (code?: string) => t(`ui.deviceHealth.ntpError.${code}`, { defaultValue: t(`ui.deviceHealth.batch.code.${code}`, t('ui.deviceHealth.ntpError.failed')), status: '-' });

  return (
    <Modal isOpen={isOpen} onClose={close} title={t('ui.deviceHealth.batch.title')} size="3xl">
      <div data-ntp-batch className="space-y-4 text-sm text-slate-200">
        {!job && candidates.length === 0 && <p data-ntp-batch-none className="text-slate-400">{t('ui.deviceHealth.batch.none')}</p>}

        {!job && candidates.length > 0 && (
          <>
            <p className="text-slate-400">{t('ui.deviceHealth.batch.intro')}</p>
            <div className="flex items-center gap-3 text-xs">
              <button type="button" className="text-cyan-400 hover:text-cyan-300" onClick={() => setPicked(new Set(candidates.map((d) => d.id)))}>{t('ui.deviceHealth.batch.all')}</button>
              <button type="button" className="text-cyan-400 hover:text-cyan-300" onClick={() => setPicked(new Set())}>{t('ui.deviceHealth.batch.nothing')}</button>
            </div>
            <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-slate-500 sticky top-0">
                  <tr>
                    <th className="p-2 w-8" />
                    <th className="p-2">{t('ui.deviceHealth.batch.recorder')}</th>
                    <th className="p-2">{t('ui.deviceHealth.batch.mode')}</th>
                    <th className="p-2">{t('ui.deviceHealth.clock')}</th>
                    <th className="p-2">{t('ui.deviceHealth.batch.effect')}</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((d) => {
                    const health = d.healthInfo as DeviceHealthInfo;
                    const off = health.clockDriftSeconds ?? 0;
                    return (
                      <tr key={d.id} data-ntp-candidate={d.name} className="border-t border-slate-800">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            checked={picked.has(d.id)}
                            onChange={(e) => setPicked((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(d.id); else next.delete(d.id);
                              return next;
                            })}
                          />
                        </td>
                        <td className="p-2"><div className="font-medium">{d.name}</div><div className="text-slate-500 font-mono">{d.ipAddress}</div></td>
                        <td className="p-2">{health.clockMode ?? '—'}</td>
                        <td className="p-2 text-amber-300">{driftText(health.clockDriftSeconds)}</td>
                        <td className="p-2 text-slate-400">{Math.abs(off) <= 5 ? '—' : t(off > 0 ? 'ui.deviceHealth.batch.repeats' : 'ui.deviceHealth.batch.gap', { min: Math.max(1, Math.round(Math.abs(off) / 60)) })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-amber-300/90">{t('ui.deviceHealth.batch.whenQuiet')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={close}>{t('common.cancel')}</Button>
              <Button data-ntp-batch-start onClick={start} disabled={picked.size === 0 || starting} className="flex items-center gap-1.5">
                {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                {t('ui.deviceHealth.batch.start', { n: picked.size })}
              </Button>
            </div>
          </>
        )}

        {job && (
          <>
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span data-ntp-batch-status={job.status}>{t(job.status === 'running' ? 'ui.deviceHealth.batch.running' : 'ui.deviceHealth.batch.finished', { ok: items.filter((i) => i.ok).length, total: job.total })}</span>
                <span>{job.done ?? 0} / {job.total}</span>
              </div>
              <div className="h-2 rounded bg-slate-800 overflow-hidden">
                <div className="h-full bg-cyan-500 transition-all" style={{ width: `${job.total ? Math.round(((job.done ?? 0) / job.total) * 100) : 0}%` }} />
              </div>
            </div>
            <ul className="max-h-80 overflow-y-auto space-y-1 text-xs">
              {items.map((item) => (
                <li key={item.id} data-ntp-result={item.ok ? 'ok' : item.code} className="flex items-start gap-2">
                  {item.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <XCircle className="w-4 h-4 text-rose-400 shrink-0" />}
                  <span className="font-medium">{nameOf(item.id)}</span>
                  <span className="text-slate-400">{item.ok ? t('ui.deviceHealth.batch.done') : reason(item.code)}</span>
                </li>
              ))}
            </ul>
            {job.status === 'failed' && <p className="text-rose-300 text-xs">{t('ui.deviceHealth.ntpError.failed')}</p>}
            {job.status !== 'running' && (
              <>
                <p className="text-xs text-slate-400">{t('ui.deviceHealth.batch.after')}</p>
                <div className="flex justify-end"><Button onClick={close}>{t('common.close')}</Button></div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
