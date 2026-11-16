import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarClock, HardDrive, Save } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { hasPermission } from '@/App';
import { imageServiceApi } from '@/services/imageServiceApi';
import { Button, SearchableSelect } from '@/components/ui';

interface BackupSettings { enabled: boolean; time: string; keepDays: number; destination: string }
interface Destination { id: string; hostPath: string; writable: boolean }
interface DiskUse {
  id: 'recordings' | 'backup_internal' | 'backup_external';
  hostPath: string;
  available: boolean;
  totalBytes: number | null;
  freeBytes: number | null;
  usedPercent: number | null;
  contents: { recordingsBytes?: number; clipsBytes?: number; backupBytes?: number; backupFiles?: number };
  sameDiskAs: string[];
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

/** Daily database backup: on/off, time, days kept, and which mounted disk it goes to. */
export function BackupScheduleCard() {
  const { t } = useTranslation();
  const { themeConfig } = useTheme();
  const { data, isLoading } = useQuery({ queryKey: ['backup-settings'], queryFn: () => imageServiceApi.getBackupSettings() });
  const cardClass = `${themeConfig.card} rounded-lg p-5`;
  return (
    <div className={cardClass}>
      <div className="flex items-center gap-2 mb-4">
        <CalendarClock size={18} className="text-emerald-400" />
        <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.backup.scheduleTitle')}</h3>
      </div>
      {isLoading || !data?.settings ? (
        <div className={`text-sm ${themeConfig.text.secondary}`}>{t('imageService.backup.loading')}</div>
      ) : (
        // Keyed on the saved values: the form starts from them again after each save, without an effect.
        <BackupScheduleForm key={JSON.stringify(data.settings)} initial={data.settings} destinations={data.destinations ?? []} timeZone={data.timeZone} />
      )}
    </div>
  );
}

function BackupScheduleForm({ initial, destinations, timeZone }: { initial: BackupSettings; destinations: Destination[]; timeZone: string }) {
  const { t } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = hasPermission(user, 'system-config:update');
  const [form, setForm] = useState<BackupSettings>(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const save = useMutation({
    mutationFn: () => imageServiceApi.saveBackupSettings(form),
    onSuccess: () => {
      toast.success(t('imageService.backup.scheduleSaved'));
      queryClient.invalidateQueries({ queryKey: ['backup-settings'] });
      queryClient.invalidateQueries({ queryKey: ['backup-disks'] });
    },
    onError: (e: any) => {
      if (e?._handled) return;
      const code = e?.response?.data?.details?.code;
      toast.error(code ? t(`imageService.backup.scheduleError.${code}`, { defaultValue: t('imageService.backup.scheduleSaveFailed') }) : t('imageService.backup.scheduleSaveFailed'));
    },
  });

  const labelClass = `block text-xs font-medium mb-1.5 ${themeConfig.text.secondary}`;
  const inputClass = `w-full px-3 py-2 rounded-lg text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none disabled:opacity-50`;
  const destLabel = (d: Destination) =>
    `${t(`imageService.backup.destination.${d.id}`)} — ${d.hostPath}${d.writable ? '' : ` (${t('imageService.backup.destinationNotWritable')})`}`;
  const chosen = destinations.find((d) => d.id === form.destination);

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
      <label className={`flex items-center gap-2 text-sm ${themeConfig.text.primary}`}>
        <input
          type="checkbox"
          data-backup-enabled
          checked={form.enabled}
          disabled={!canEdit}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
        />
        {t('imageService.backup.scheduleEnabled')}
      </label>
      <div>
        <label className={labelClass}>{t('imageService.backup.scheduleTime', { tz: timeZone })}</label>
        <input type="time" data-backup-time value={form.time} disabled={!canEdit || !form.enabled} onChange={(e) => setForm({ ...form, time: e.target.value })} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>{t('imageService.backup.scheduleKeepDays')}</label>
        <input
          type="number" min={1} max={365} data-backup-keep
          value={form.keepDays}
          disabled={!canEdit}
          onChange={(e) => setForm({ ...form, keepDays: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>{t('imageService.backup.scheduleDestination')}</label>
        <SearchableSelect
          value={form.destination}
          onChange={(v) => setForm({ ...form, destination: v })}
          options={destinations.map((d) => ({ value: d.id, label: destLabel(d) }))}
          showSearch={false}
        />
      </div>
      <p className={`md:col-span-3 text-[11px] ${themeConfig.text.secondary}`}>
        {t('imageService.backup.scheduleNote')}
        {destinations.length < 2 && <> {t('imageService.backup.scheduleNoExternal')}</>}
        {chosen && !chosen.writable && <span className="text-red-400"> {t('imageService.backup.destinationNotWritable')}</span>}
      </p>
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending || (chosen && !chosen.writable)}>
            <Save size={14} className="mr-1" />
            {t('imageService.backup.scheduleSave')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Which disk holds what: recordings + clips, and each backup destination. */
export function DiskOverviewCard() {
  const { t } = useTranslation();
  const { themeConfig } = useTheme();
  const { data, isLoading } = useQuery({ queryKey: ['backup-disks'], queryFn: () => imageServiceApi.getBackupDisks(), refetchInterval: 1000 * 60 * 5 });
  const items: DiskUse[] = data?.items ?? [];
  const th = `text-xs font-medium uppercase tracking-wider ${themeConfig.text.secondary} px-4 py-3 text-left`;
  const td = `text-sm px-4 py-2.5 ${themeConfig.text.primary}`;
  const name = (id: string) => t(`imageService.backup.disk.${id}`);

  const contents = (d: DiskUse) => {
    if (d.id === 'recordings') {
      return t('imageService.backup.diskHoldsRecordings', { recordings: formatBytes(d.contents.recordingsBytes), clips: formatBytes(d.contents.clipsBytes) });
    }
    return t('imageService.backup.diskHoldsBackups', { count: d.contents.backupFiles ?? 0, size: formatBytes(d.contents.backupBytes) });
  };

  return (
    <div className={`${themeConfig.card} rounded-lg p-5`}>
      <div className="flex items-center gap-2 mb-4">
        <HardDrive size={18} className="text-cyan-400" />
        <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.backup.disksTitle')}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className={`border-b ${themeConfig.cardBorder}`}>
              <th className={th}>{t('imageService.backup.diskColWhat')}</th>
              <th className={th}>{t('imageService.backup.diskColPath')}</th>
              <th className={th}>{t('imageService.backup.diskColUse')}</th>
              <th className={th}>{t('imageService.backup.diskColFree')}</th>
              <th className={th}>{t('imageService.backup.diskColHolds')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {isLoading ? (
              <tr><td colSpan={5} className={`text-center py-6 text-sm ${themeConfig.text.secondary}`}>{t('imageService.backup.loading')}</td></tr>
            ) : items.map((d) => {
              const pct = d.usedPercent ?? 0;
              const bar = pct >= 92 ? 'bg-red-500' : pct >= 85 ? 'bg-amber-500' : 'bg-emerald-500';
              return (
                <tr key={d.id} data-disk={d.id}>
                  <td className={td}>
                    <div className="font-medium">{name(d.id)}</div>
                    {d.sameDiskAs.length > 0 && (
                      <div className={`text-[11px] ${themeConfig.text.secondary}`}>
                        {t('imageService.backup.diskSameAs', { names: d.sameDiskAs.map(name).join(', ') })}
                      </div>
                    )}
                  </td>
                  <td className={`${td} text-xs font-mono ${themeConfig.text.secondary}`}>{d.hostPath}</td>
                  <td className={td}>
                    {d.available && d.totalBytes ? (
                      <div className="min-w-[140px]">
                        <div className={`h-2 rounded-full overflow-hidden ${themeConfig.inputBg}`}>
                          <div className={`h-full ${bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                        <div className={`text-[11px] mt-1 ${themeConfig.text.secondary}`}>{pct}% · {formatBytes(d.totalBytes)}</div>
                      </div>
                    ) : (
                      <span className="text-xs text-red-400">{t('imageService.backup.diskUnavailable')}</span>
                    )}
                  </td>
                  <td className={`${td} text-xs`}>{d.available ? formatBytes(d.freeBytes) : '—'}</td>
                  <td className={`${td} text-xs ${themeConfig.text.secondary}`}>{contents(d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
