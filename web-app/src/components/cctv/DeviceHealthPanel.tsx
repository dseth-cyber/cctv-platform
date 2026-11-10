import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Clock, HardDrive, Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { formatDateTime } from '@/utils/dateUtils';
import { clockDriftParts, formatCapacity, holdsNoRecordings, needsNtp, summarizeDeviceHealth, type DeviceHealthInfo } from '@/lib/deviceHealth';

/** A small sign on a device's row: all well, or how many things need a look. */
export function DeviceHealthChip({ device }: { device: any }) {
  const { t } = useTranslation();
  const summary = summarizeDeviceHealth(device.healthInfo);
  if (summary === 'unknown') return null;
  const problems = (device.healthInfo as DeviceHealthInfo).problems ?? [];
  const tone = summary === 'problem'
    ? 'bg-rose-950 text-rose-300 border-rose-800/60'
    : summary === 'stale'
      ? 'bg-amber-950 text-amber-300 border-amber-800/60'
      : 'bg-emerald-950 text-emerald-300 border-emerald-800/60';
  return (
    <span data-device-health={summary} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${tone}`}>
      <HardDrive className="w-3 h-3" />
      {summary === 'problem'
        ? t('ui.deviceHealth.problemCount', { n: problems.length })
        : summary === 'stale'
          ? t('ui.deviceHealth.stale')
          : t('ui.deviceHealth.allWell')}
    </span>
  );
}

/** Disks, clock, how far back the recorder keeps, and which channels have stopped recording. */
/**
 * A recorder note someone can acknowledge when it cannot or should not be changed on the recorder: then it is shown
 * greyed with who acknowledged it, instead of as a warning. The server drops the acknowledgement once the recorder no
 * longer shows the condition.
 */
function AckableNote({ data, note, device, canAck, text }: { data: string; note: 'sub_recording' | 'smart_codec'; device: any; canAck: boolean; text: string }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const ack = device.healthNotesAck?.[note] as { by: string; at: string } | undefined;
  const toggle = async () => {
    setBusy(true);
    try {
      await imageServiceApi.setDeviceHealthNoteAck(device.id, note, !ack);
      await queryClient.invalidateQueries({ queryKey: ['devices'] });
      await queryClient.invalidateQueries({ queryKey: ['cctv-devices'] });
    } catch (err: any) {
      if (!err?._handled) toast.error(t('ui.deviceHealth.ack.failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div {...{ [data]: '' }} data-acknowledged={ack ? 'yes' : 'no'} className={`flex items-start gap-1.5 ${ack ? 'text-slate-500' : 'text-amber-300'}`}>
      {ack ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
      <p className="flex-1">
        {text}
        {ack && <span className="block text-[11px]">{t('ui.deviceHealth.ack.by', { name: ack.by, time: new Date(ack.at).toLocaleString(i18n.language === 'th' ? 'th-TH' : undefined) })}</span>}
      </p>
      {canAck && (
        <button type="button" data-ack-toggle={note} disabled={busy} onClick={toggle}
          className={`shrink-0 px-2 py-0.5 rounded border text-[11px] font-medium disabled:opacity-50 ${ack ? 'border-slate-700 text-slate-400 hover:bg-slate-800' : 'border-amber-500/40 text-amber-200 hover:bg-amber-500/10'}`}>
          {t(ack ? 'ui.deviceHealth.ack.undo' : `ui.deviceHealth.ack.${note}`)}
        </button>
      )}
    </div>
  );
}

export function DeviceHealthPanel({ device, canCheck }: { device: any; canCheck: boolean }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [settingClock, setSettingClock] = useState(false);
  const health = device.healthInfo as DeviceHealthInfo | null;

  const checkNow = async () => {
    setChecking(true);
    try {
      await imageServiceApi.checkDeviceHealth(device.id);
      await queryClient.invalidateQueries({ queryKey: ['cctv-devices'] });
    } catch (err: any) {
      if (!err?._handled) toast.error(t('ui.deviceHealth.checkFailed'));
    } finally {
      setChecking(false);
    }
  };

  // Changes a setting on the recorder (its clock source only), so it asks first and says what will happen.
  const takeServerTime = async () => {
    const off = health?.clockDriftSeconds ?? 0;
    const way = t(off > 0 ? 'ui.deviceHealth.ntpBack' : 'ui.deviceHealth.ntpForward');
    if (!window.confirm(t('ui.deviceHealth.ntpConfirm', { name: device.name, min: Math.floor(Math.abs(off) / 60), sec: Math.abs(off) % 60, way }))) return;
    setSettingClock(true);
    try {
      const res = await imageServiceApi.setDeviceClockNtp(device.id);
      toast.success(t('ui.deviceHealth.ntpDone', { server: res.server }));
      await imageServiceApi.checkDeviceHealth(device.id).catch(() => null);
      await queryClient.invalidateQueries({ queryKey: ['cctv-devices'] });
    } catch (err: any) {
      const details = err?.response?.data?.details ?? {};
      if (!err?._handled) toast.error(t(`ui.deviceHealth.ntpError.${details.code}`, { defaultValue: t('ui.deviceHealth.ntpError.failed'), status: details.status ?? '-' }));
    } finally {
      setSettingClock(false);
    }
  };

  const drift = health ? clockDriftParts(health.clockDriftSeconds) : null;
  // The recorder locked its account over wrong logins; until then even the right password is refused.
  const lockedUntil = health?.loginLockedUntil && new Date(health.loginLockedUntil).getTime() > Date.now() ? new Date(health.loginLockedUntil) : null;
  const driftText = !drift ? '—' : drift.direction === 'even'
    ? t('ui.deviceHealth.clockEven')
    : t(drift.direction === 'ahead' ? 'ui.deviceHealth.clockAhead' : 'ui.deviceHealth.clockBehind', { min: drift.minutes, sec: drift.seconds });

  return (
    <div data-device-health-panel className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
          <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
          {t('ui.deviceHealth.title')}
        </h4>
        <div className="flex items-center gap-3">
          {device.healthCheckedAt && <span className="text-slate-500">{t('ui.deviceHealth.checkedAt', { time: formatDateTime(device.healthCheckedAt, i18n.language) })}</span>}
          {canCheck && (
            <button type="button" data-device-health-check onClick={checkNow} disabled={checking} className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 disabled:opacity-50">
              {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {t('ui.deviceHealth.checkNow')}
            </button>
          )}
        </div>
      </div>

      {!health ? (
        <p className="text-slate-500">{t(/hik|hilook/i.test(device.brand ?? '') ? 'ui.deviceHealth.notCheckedYet' : 'ui.deviceHealth.notSupported')}</p>
      ) : (
        <>
          {health.loginFailed && (
            <p data-login-state={lockedUntil ? 'locked' : 'failed'} className="flex items-center gap-1.5 text-rose-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {lockedUntil
                ? t('ui.deviceHealth.loginLocked', { time: lockedUntil.toLocaleTimeString(i18n.language === 'th' ? 'th-TH' : undefined, { hour: '2-digit', minute: '2-digit' }) })
                : t('ui.deviceHealth.loginFailed')}
            </p>
          )}
          {!health.reachable && !health.loginFailed && (
            <p className="flex items-center gap-1.5 text-amber-300"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{t('ui.deviceHealth.unreachable')}</p>
          )}
          {health.notRecording.length > 0 && (
            <p data-not-recording className="flex items-start gap-1.5 text-rose-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {t('ui.deviceHealth.notRecording', { channels: health.notRecording.map((c) => c.channel).join(', ') })}
            </p>
          )}
          {holdsNoRecordings(health) && (
            <p data-no-recordings className="flex items-start gap-1.5 text-rose-300 font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {t('ui.deviceHealth.noRecordingsAtAll')}
            </p>
          )}
          {(health.subRecordingChannels?.length ?? 0) > 0 && (
            <AckableNote data="data-sub-recording" note="sub_recording" device={device} canAck={canCheck}
              text={t('ui.deviceHealth.subRecording', { channels: health.subRecordingChannels!.join(', ') })} />
          )}
          {(health.smartCodecChannels?.length ?? 0) > 0 && (
            <AckableNote data="data-smart-codec" note="smart_codec" device={device} canAck={canCheck}
              text={t('ui.deviceHealth.smartCodec', { channels: health.smartCodecChannels!.length >= (device.totalChannels ?? Infinity) ? t('ui.deviceHealth.allChannels') : t('ui.deviceHealth.channelList', { list: health.smartCodecChannels!.join(', ') }) })} />
          )}

          {health.problems.includes('clock_drift') && (
            <p data-clock-off className="flex items-start gap-1.5 text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {t(health.clockMode?.toUpperCase() === 'NTP' ? 'ui.deviceHealth.clockOffOnNtp' : 'ui.deviceHealth.clockOff')}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="rounded bg-slate-950/60 px-2.5 py-2">
              <div className="text-slate-500">{t('ui.deviceHealth.retention')}</div>
              <div data-retention className="font-semibold text-slate-200">{health.retentionDays === null ? '—' : t('ui.deviceHealth.days', { n: health.retentionDays })}</div>
            </div>
            <div className="rounded bg-slate-950/60 px-2.5 py-2">
              <div className="text-slate-500">{t('ui.deviceHealth.clock')}</div>
              <div className={`font-semibold ${drift && drift.direction !== 'even' ? 'text-amber-300' : 'text-slate-200'}`}>{driftText}</div>
              {health.clockMode && (
                <div data-clock-mode={health.clockMode} className="text-slate-500 mt-0.5">
                  {t(health.clockMode.toUpperCase() === 'NTP' ? 'ui.deviceHealth.clockModeNtp' : 'ui.deviceHealth.clockModeManual')}
                </div>
              )}
              {canCheck && needsNtp(device.brand, health) && (
                <button type="button" data-device-ntp onClick={takeServerTime} disabled={settingClock} className="mt-1 inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 disabled:opacity-50">
                  {settingClock ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
                  {t('ui.deviceHealth.ntpButton')}
                </button>
              )}
            </div>
            <div className="rounded bg-slate-950/60 px-2.5 py-2">
              <div className="text-slate-500">{t('ui.deviceHealth.recording')}</div>
              <div className={`font-semibold flex items-center gap-1 ${health.notRecording.length > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                {health.notRecording.length === 0 && <CheckCircle2 className="w-3.5 h-3.5" />}
                {t('ui.deviceHealth.recordingCount', { ok: health.channelsChecked - health.notRecording.length, total: health.channelsChecked })}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">{t('ui.deviceHealth.disk')}</th>
                  <th className="py-1 pr-3 font-medium">{t('ui.deviceHealth.capacity')}</th>
                  <th className="py-1 pr-3 font-medium">{t('ui.deviceHealth.state')}</th>
                  <th className="py-1 pr-3 font-medium">SMART</th>
                  <th className="py-1 font-medium">{t('ui.deviceHealth.temperature')}</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {health.disks.map((disk) => (
                  <tr key={disk.id} data-disk-row className="border-t border-slate-800/60">
                    <td className="py-1 pr-3">{disk.id}</td>
                    <td className="py-1 pr-3">{formatCapacity(disk.capacityMB)}</td>
                    <td className={`py-1 pr-3 ${disk.state && !['ok', 'idle'].includes(disk.state.toLowerCase()) ? 'text-rose-300 font-semibold' : ''}`}>{disk.state ?? '—'}</td>
                    <td className={`py-1 pr-3 ${disk.smart && disk.smart.toLowerCase() !== 'ok' ? 'text-rose-300 font-semibold' : ''}`}>{disk.smart ?? '—'}</td>
                    <td className="py-1">{disk.temperature === null ? '—' : `${disk.temperature}°C`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {health.reportedModel && device.model && health.reportedModel !== device.model && (
            <p className="text-amber-300">{t('ui.deviceHealth.modelDiffers', { saved: device.model, reported: health.reportedModel })}</p>
          )}
        </>
      )}
    </div>
  );
}
