import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { formatDateTime } from '@/utils/dateUtils';
import { Database, HardDrive, RefreshCw, CheckCircle, XCircle, Clock, Play, Shield, FileText } from 'lucide-react';
import { Button } from '@/components/ui';

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

function statusBadge(status: string, themeConfig: any, t: (key: string) => string) {
  const colors: Record<string, string> = {
    completed: 'bg-green-500/20 text-green-400',
    failed: 'bg-red-500/20 text-red-400',
    running: 'bg-blue-500/20 text-blue-400',
    pending: 'bg-gray-500/20 text-gray-400',
  };
  const icons: Record<string, any> = {
    completed: CheckCircle,
    failed: XCircle,
    running: Clock,
    pending: Clock,
  };
  const statusKey: Record<string, string> = {
    completed: 'imageService.backup.statusCompleted',
    failed: 'imageService.backup.statusFailed',
    running: 'imageService.backup.statusRunning',
    pending: 'imageService.backup.statusPending',
  };
  const Icon = icons[status] || Clock;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${colors[status] || colors.pending}`}>
      <Icon size={12} />
      {t(statusKey[status] ?? status)}
    </span>
  );
}

export default function BackupDashboard() {
  const { t, i18n } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ['backup-status'],
    queryFn: () => imageServiceApi.getBackupStatus(),
    refetchInterval: 1000 * 60,
  });

  const dbMutation = useMutation({
    mutationFn: () => imageServiceApi.runDatabaseBackup(),
    onSuccess: (res: any) => {
      toast.success(res.status === 'completed' ? t('imageService.backup.dbBackupCompleted') : t('imageService.backup.dbBackupFailed'));
      queryClient.invalidateQueries({ queryKey: ['backup-status'] });
    },
    onError: (e: any) => { if (!e?._handled) toast.error(t('imageService.backup.dbBackupFailed')); },
  });

  const storageMutation = useMutation({
    mutationFn: () => imageServiceApi.runStorageBackup(),
    onSuccess: (res: any) => {
      toast.success(res.status === 'completed' ? t('imageService.backup.storageBackupCompleted') : t('imageService.backup.storageBackupFailed'));
      queryClient.invalidateQueries({ queryKey: ['backup-status'] });
    },
    onError: (e: any) => { if (!e?._handled) toast.error(t('imageService.backup.storageBackupFailed')); },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.runRestoreTest(id),
    onSuccess: (res: any) => {
      toast.success(res.success ? t('imageService.backup.restoreTestSuccess', { message: res.message }) : t('imageService.backup.restoreTestFailed', { message: res.message }));
    },
    onError: (e: any) => { if (!e?._handled) toast.error(t('imageService.backup.restoreTestError')); },
  });

  const cardClass = `${themeConfig.card} rounded-lg p-5`;
  const labelClass = `text-xs ${themeConfig.text.secondary} mb-1`;
  const valueClass = `text-sm font-semibold ${themeConfig.text.primary}`;

  return (
    <div className="p-6">
      <div className="mb-6">
        <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
          Image Service · {t('imageService.backup.title')}
        </p>
        <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.backup.title')}</h1>
        <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.backup.subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 gap-5 mb-6">
        <div className={cardClass}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Database size={18} className="text-blue-400" />
              <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.backup.databaseBackup')}</h3>
            </div>
            <Button size="sm" variant="ghost" onClick={() => dbMutation.mutate()} disabled={dbMutation.isPending}>
              <Play size={14} className="mr-1" />
              {t('imageService.backup.runNow')}
            </Button>
          </div>

          {status?.database ? (
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className={labelClass}>{t('imageService.backup.status')}</span>
                {statusBadge(status.database.status, themeConfig, t)}
              </div>
              <div className="flex justify-between">
                <span className={labelClass}>{t('imageService.backup.fileSize')}</span>
                <span className={valueClass}>{formatBytes(status.database.fileSize)}</span>
              </div>
              <div className="flex justify-between">
                <span className={labelClass}>{t('imageService.backup.lastBackup')}</span>
                <span className={`text-xs ${themeConfig.text.secondary}`}>
                  {status.database.completedAt ? formatDateTime(status.database.completedAt, i18n.language) : '—'}
                </span>
              </div>
              {status.database.errorMessage && (
                <div className="text-xs text-red-400 mt-2">{status.database.errorMessage}</div>
              )}
            </div>
          ) : (
            <div className={`text-center py-6 text-sm ${themeConfig.text.secondary}`}>{t('imageService.backup.noBackups')}</div>
          )}
        </div>

        <div className={cardClass}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <HardDrive size={18} className="text-purple-400" />
              <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.backup.storageBackup')}</h3>
            </div>
            <Button size="sm" variant="ghost" onClick={() => storageMutation.mutate()} disabled={storageMutation.isPending}>
              <Play size={14} className="mr-1" />
              {t('imageService.backup.runNow')}
            </Button>
          </div>

          {status?.storage ? (
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className={labelClass}>{t('imageService.backup.status')}</span>
                {statusBadge(status.storage.status, themeConfig, t)}
              </div>
              <div className="flex justify-between">
                <span className={labelClass}>{t('imageService.backup.fileSize')}</span>
                <span className={valueClass}>{formatBytes(status.storage.fileSize)}</span>
              </div>
              <div className="flex justify-between">
                <span className={labelClass}>{t('imageService.backup.lastBackup')}</span>
                <span className={`text-xs ${themeConfig.text.secondary}`}>
                  {status.storage.completedAt ? formatDateTime(status.storage.completedAt, i18n.language) : '—'}
                </span>
              </div>
              {status.storage.errorMessage && (
                <div className="text-xs text-red-400 mt-2">{status.storage.errorMessage}</div>
              )}
            </div>
          ) : (
            <div className={`text-center py-6 text-sm ${themeConfig.text.secondary}`}>{t('imageService.backup.noBackups')}</div>
          )}
        </div>
      </div>

      <div className={cardClass}>
        <div className="flex items-center gap-2 mb-4">
          <FileText size={18} className="text-amber-400" />
          <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.backup.recentBackups')}</h3>
        </div>
        <BackupHistoryTable themeConfig={themeConfig} onRestoreTest={(id) => restoreMutation.mutate(id)} />
      </div>
    </div>
  );
}

function BackupHistoryTable({ themeConfig, onRestoreTest }: { themeConfig: any; onRestoreTest: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['backup-records'],
    queryFn: () => imageServiceApi.getBackupRecords({ limit: 20 }),
    refetchInterval: 1000 * 60,
  });

  const records = data?.data ?? [];
  const tableHeaderClass = `text-xs font-medium uppercase tracking-wider ${themeConfig.text.secondary} px-4 py-3 text-left`;
  const tableCellClass = `text-sm px-4 py-2.5 ${themeConfig.text.primary}`;

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className={`border-b ${themeConfig.cardBorder}`}>
            <th className={tableHeaderClass}>{t('imageService.backup.tableType')}</th>
            <th className={tableHeaderClass}>{t('imageService.backup.tableStatus')}</th>
            <th className={tableHeaderClass}>{t('imageService.backup.tableStarted')}</th>
            <th className={tableHeaderClass}>{t('imageService.backup.tableSize')}</th>
            <th className={tableHeaderClass}>{t('imageService.backup.tablePath')}</th>
            <th className={`${tableHeaderClass} text-right`}>{t('imageService.backup.tableActions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {isLoading ? (
            <tr><td colSpan={6} className={`text-center py-6 text-sm ${themeConfig.text.secondary}`}>{t('imageService.backup.loading')}</td></tr>
          ) : records.length === 0 ? (
            <tr><td colSpan={6} className={`text-center py-6 text-sm ${themeConfig.text.secondary}`}>{t('imageService.backup.noRecords')}</td></tr>
          ) : records.map((r: any) => (
            <tr key={r.id} className="hover:bg-white/[0.02] transition-colors">
              <td className={tableCellClass}>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${r.type === 'database' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'}`}>
                  {t(r.type === 'database' ? 'imageService.backup.typeDatabase' : 'imageService.backup.typeStorage')}
                </span>
              </td>
              <td className={tableCellClass}>{statusBadge(r.status, themeConfig, t)}</td>
              <td className={`${tableCellClass} text-xs text-gray-400`}>{formatDateTime(r.startedAt, i18n.language)}</td>
              <td className={`${tableCellClass} text-xs text-gray-400`}>{formatBytes(r.fileSize)}</td>
              <td className={`${tableCellClass} text-xs text-gray-400 max-w-[200px] truncate`}>{r.filePath || '—'}</td>
              <td className={`${tableCellClass} text-right`}>
                {r.status === 'completed' && (
                  <Button size="sm" variant="ghost" onClick={() => onRestoreTest(r.id)} title={t('imageService.backup.testRestore')}>
                    <Shield size={14} />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
