import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { hasPermission } from '@/App';
import { imageServiceApi } from '@/services/imageServiceApi';
import { formatDateTime } from '@/utils/dateUtils';
import {
  Search, ChevronUp, ChevronDown, ChevronsUpDown, RotateCcw,
  AlertCircle, CheckCircle, Clock, XCircle, Loader, Activity, Trash2, AlertTriangle,
} from 'lucide-react';
import { Modal, Button, SearchableSelect, TableSkeleton } from '@/components/ui';

const JOB_STATUS_STYLES: Record<string, string> = {
  completed: 'bg-green-500/20 text-green-400',
  running: 'bg-blue-500/20 text-blue-400',
  queued: 'bg-cyan-500/20 text-cyan-400',
  failed: 'bg-red-500/20 text-red-400',
  retrying: 'bg-yellow-500/20 text-yellow-400',
  dead_letter: 'bg-gray-500/20 text-gray-400',
};

const JOB_TYPE_ICONS: Record<string, any> = {
  sync: 'Activity',
  convert: 'Activity',
  thumbnail: 'Activity',
  checksum: 'Activity',
  archive: 'Activity',
  delete: 'Activity',
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 rounded-lg border border-white/20 bg-slate-900/90 backdrop-blur-md text-xs shadow-xl">
      <p className="text-gray-300 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-semibold">
          {p.name}: {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </p>
      ))}
    </div>
  );
};

export default function ImageServiceProcessingLogs() {
  const { t, i18n } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortCol, setSortCol] = useState('queuedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteDays, setBulkDeleteDays] = useState(30);
  const [bulkDeletePreview, setBulkDeletePreview] = useState<{ count: number; cutoffDate: string } | null>(null);
  const [bulkDeletePassword, setBulkDeletePassword] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteLoadingPreview, setBulkDeleteLoadingPreview] = useState(false);

  const BULK_DELETE_DAY_OPTIONS = [7, 14, 30, 60, 90, 120, 240, 365];

  const fetchBulkDeletePreview = useCallback(async (days: number) => {
    setBulkDeleteLoadingPreview(true);
    setBulkDeletePreview(null);
    try {
      const result = await imageServiceApi.bulkDeleteLogsPreview(days);
      setBulkDeletePreview(result);
    } catch {
      toast.error(t('common.error'));
    } finally {
      setBulkDeleteLoadingPreview(false);
    }
  }, [t, toast]);

  const handleOpenBulkDelete = useCallback(() => {
    setBulkDeleteOpen(true);
    setBulkDeletePassword('');
    setBulkDeletePreview(null);
    setBulkDeleteDays(30);
    fetchBulkDeletePreview(30);
  }, [fetchBulkDeletePreview]);

  const handleBulkDeleteDaysChange = useCallback((days: number) => {
    setBulkDeleteDays(days);
    fetchBulkDeletePreview(days);
  }, [fetchBulkDeletePreview]);

  const handleBulkDelete = useCallback(async () => {
    if (!bulkDeletePassword || !bulkDeletePreview) return;
    setBulkDeleting(true);
    try {
      const result = await imageServiceApi.bulkDeleteLogsByAge(bulkDeleteDays, bulkDeletePassword);
      toast.success(t('imageService.processingLogs.bulkDeleteSuccess', { count: result.deleted }));
      setBulkDeleteOpen(false);
      setBulkDeletePassword('');
      setBulkDeletePreview(null);
      queryClient.invalidateQueries({ queryKey: ['processing-logs'] });
    } catch (e: any) {
      if (e?.response?.status === 401) {
        toast.error(t('imageService.processingLogs.bulkDeleteWrongPassword'));
      } else if (!e?._handled) {
        toast.error(t('common.error'));
      }
    } finally {
      setBulkDeleting(false);
    }
  }, [bulkDeleteDays, bulkDeletePassword, bulkDeletePreview, t, toast, queryClient]);

  const { data, isLoading } = useQuery({
    queryKey: ['processing-logs', page, search, statusFilter, typeFilter, sortCol, sortDir],
    queryFn: async () => {
      const res = await imageServiceApi.getProcessingLogs({
        page, limit: 20, status: statusFilter || undefined,
        jobType: typeFilter || undefined, q: search || undefined,
        sort: sortCol, order: sortDir,
      });
      return {
        items: res.data ?? [],
        total: res.pagination?.total ?? 0,
        totalPages: res.pagination?.totalPages ?? 0,
      };
    },
    staleTime: 1000 * 15,
    placeholderData: (prev) => prev,
  });

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 0;

  const handleSort = (col: string) => {
    if (col === 'actions') return;
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
    setPage(1);
  };

  const handleRetry = async (jobId: string) => {
    try {
      await imageServiceApi.retryJob(jobId);
      toast.success(t('imageService.processingLogs.retrySuccess'));
      queryClient.invalidateQueries({ queryKey: ['processing-logs'] });
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
  };

  const thCls = (col: string) =>
    `px-4 py-3 text-left text-sm font-semibold cursor-pointer select-none hover:text-cyan-300 ${themeConfig.text.primary}`;

  const STATUS_LABEL_KEY: Record<string, string> = {
    queued: 'imageService.processingLogs.statusQueued',
    running: 'imageService.processingLogs.statusRunning',
    completed: 'imageService.processingLogs.statusCompleted',
    failed: 'imageService.processingLogs.statusFailed',
    retrying: 'imageService.processingLogs.statusRetrying',
    dead_letter: 'imageService.processingLogs.statusDeadLetter',
  };
  const TYPE_LABEL_KEY: Record<string, string> = {
    sync: 'imageService.processingLogs.typeSync',
    convert: 'imageService.processingLogs.typeConvert',
    thumbnail: 'imageService.processingLogs.typeThumbnail',
    checksum: 'imageService.processingLogs.typeChecksum',
    archive: 'imageService.processingLogs.typeArchive',
    delete: 'imageService.processingLogs.typeDelete',
  };
  const statusOptions = Object.keys(STATUS_LABEL_KEY).map(s => ({ value: s, label: t(STATUS_LABEL_KEY[s]) }));
  const typeOptions = Object.keys(TYPE_LABEL_KEY).map(s => ({ value: s, label: t(TYPE_LABEL_KEY[s]) }));

  return (
    <div className="p-6">
      <div className="mb-6">
        <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
          Image Service · {t('imageService.processingLogs.title')}
        </p>
        <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.processingLogs.title')}</h1>
        <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.processingLogs.subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${themeConfig.text.secondary}`} />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder={t('imageService.search.searchPlaceholder')}
            className={`w-full pl-8 pr-3 py-1.5 rounded-lg text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary}`} />
        </div>
        <div className="w-36">
          <SearchableSelect value={statusFilter} onChange={v => { setStatusFilter(v); setPage(1); }}
            placeholder={t('imageService.processingLogs.allStatuses')} options={statusOptions} />
        </div>
        <div className="w-36">
          <SearchableSelect value={typeFilter} onChange={v => { setTypeFilter(v); setPage(1); }}
            placeholder={t('imageService.processingLogs.allTypes')} options={typeOptions} />
        </div>
        {hasPermission(user, 'processing:create') && (
          <button onClick={handleOpenBulkDelete}
            className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">
            <Trash2 size={13} /> {t('imageService.processingLogs.bulkDelete')}
          </button>
        )}
      </div>

      {isLoading ? <TableSkeleton rows={8} /> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className={themeConfig.tableHeader}>
                <tr>
                  <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>#</th>
                  <th onClick={() => handleSort('imageId')} className={thCls('imageId')}>
                    <div className="flex items-center gap-1">{t('imageService.processingLogs.imageId')}
                      {sortCol === 'imageId' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                  </th>
                  <th onClick={() => handleSort('jobType')} className={thCls('jobType')}>
                    <div className="flex items-center gap-1">{t('imageService.processingLogs.jobType')}
                      {sortCol === 'jobType' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                  </th>
                  <th onClick={() => handleSort('status')} className={thCls('status')}>
                    <div className="flex items-center gap-1">{t('imageService.processingLogs.status')}
                      {sortCol === 'status' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                  </th>
                  <th onClick={() => handleSort('workerId')} className={thCls('workerId')}>
                    <div className="flex items-center gap-1">{t('imageService.processingLogs.workerId')}
                      {sortCol === 'workerId' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                  </th>
                  <th onClick={() => handleSort('queuedAt')} className={thCls('queuedAt')}>
                    <div className="flex items-center gap-1">{t('imageService.processingLogs.queuedAt')}
                      {sortCol === 'queuedAt' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                  </th>
                  <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>
                    {t('imageService.processingLogs.duration')}
                  </th>
                  <th className={`px-4 py-3 text-center text-sm font-semibold ${themeConfig.text.primary}`}>
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className={`divide-y ${themeConfig.tableDivide}`}>
                {items.map((job: any, idx: number) => (
                  <tr key={job.id} className={`border-b ${themeConfig.tableBorder} ${themeConfig.tableRow}`}>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.primary}`}>{(page - 1) * 20 + idx + 1}</td>
                    <td className={`px-4 py-3 text-sm font-mono ${themeConfig.text.secondary}`}>
                      {job.imageId ? job.imageId.slice(0, 8) + '...' : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-md text-xs bg-cyan-500/10 text-cyan-400">
                        {t(TYPE_LABEL_KEY[job.jobType] ?? job.jobType)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${JOB_STATUS_STYLES[job.status] ?? 'bg-gray-500/20 text-gray-400'}`}>
                        {t(STATUS_LABEL_KEY[job.status] ?? job.status)}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-xs ${themeConfig.text.secondary}`}>
                      {job.workerId ?? '—'}
                    </td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>
                      {job.queuedAt ? formatDateTime(job.queuedAt, i18n.language) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.primary}`}>
                      {job.durationMs ? `${(job.durationMs / 1000).toFixed(1)}${t('imageService.processingLogs.seconds')}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center">
                        {['failed', 'dead_letter'].includes(job.status) && (
                          <button onClick={() => handleRetry(job.id)}
                            className="p-2 rounded-lg hover:bg-green-500/20" title={t('imageService.processingLogs.retry')}>
                            <RotateCcw size={15} className="text-green-500" />
                          </button>
                        )}
                        {job.errorMessage && (
                          <div className={`ml-1 max-w-[200px] truncate text-xs ${themeConfig.text.secondary}`}
                            title={job.errorMessage}>
                            {job.errorMessage}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {items.length === 0 && (
            <div className={`text-center py-12 ${themeConfig.text.secondary} text-sm`}>
              {t('imageService.processingLogs.noLogs')}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-5">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className={`px-3 py-1.5 rounded-lg text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30`}>
                {t('common.prev')}
              </button>
              <span className={`text-xs ${themeConfig.text.secondary}`}>{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className={`px-3 py-1.5 rounded-lg text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30`}>
                {t('common.next')}
              </button>
            </div>
          )}
        </>
      )}

      {/* Bulk Delete Modal */}
      <Modal isOpen={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)} title={t('imageService.processingLogs.bulkDeleteTitle')}>
        <div className="space-y-5 p-1 max-w-md">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className={`text-xs ${themeConfig.text.secondary}`}>
              {t('imageService.processingLogs.bulkDeleteWarning')}
            </p>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${themeConfig.text.primary}`}>
              {t('imageService.processingLogs.bulkDeleteDays')}
            </label>
            <SearchableSelect
              value={String(bulkDeleteDays)}
              onChange={v => handleBulkDeleteDaysChange(Number(v))}
              placeholder={t('imageService.processingLogs.bulkDeleteDays')}
              options={BULK_DELETE_DAY_OPTIONS.map(d => ({ value: String(d), label: `${d} ${t('imageService.processingLogs.days')}` }))}
            />
          </div>

          <div className={`p-3 rounded-lg ${themeConfig.card} border ${themeConfig.inputBorder}`}>
            {bulkDeleteLoadingPreview ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full" />
                <span className={`text-sm ${themeConfig.text.secondary}`}>...</span>
              </div>
            ) : bulkDeletePreview ? (
              <p className={`text-sm font-medium ${bulkDeletePreview.count > 0 ? 'text-red-400' : themeConfig.text.primary}`}>
                {t('imageService.processingLogs.bulkDeletePreview', {
                  count: Number(bulkDeletePreview.count),
                  date: bulkDeletePreview.cutoffDate.split('T')[0],
                })}
              </p>
            ) : null}
          </div>

          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
              {t('imageService.processingLogs.bulkDeleteConfirm')}
            </label>
            <input
              type="password" autoComplete="new-password"
              value={bulkDeletePassword}
              onChange={e => setBulkDeletePassword(e.target.value)}
              placeholder={t('imageService.processingLogs.bulkDeletePassword')}
              className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-red-500/50`}
              onKeyDown={e => { if (e.key === 'Enter' && bulkDeletePassword && bulkDeletePreview && bulkDeletePreview.count > 0) handleBulkDelete(); }}
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
            <Button variant="secondary" onClick={() => setBulkDeleteOpen(false)}>
              {t('common.close')}
            </Button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting || !bulkDeletePassword || !bulkDeletePreview || bulkDeletePreview.count === 0}
              className="px-4 py-2 rounded-md text-sm font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
            >
              {bulkDeleting ? (
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <Trash2 size={14} />
              )}
              {t('imageService.processingLogs.bulkDelete')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
