import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { AlertTriangle, RotateCcw, Trash2, RefreshCw, Layers, Clock, XCircle } from 'lucide-react';
import { Button, SearchableSelect } from '@/components/ui';

export default function DeadLetterQueue() {
  const { t } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [filterType, setFilterType] = useState('');

  const { data: dlq, isLoading } = useQuery({
    queryKey: ['dlq-summary'],
    queryFn: () => imageServiceApi.getDlqSummary(),
    refetchInterval: 1000 * 30,
  });

  const retryMutation = useMutation({
    mutationFn: (jobId: string) => imageServiceApi.retryJob(jobId),
    onSuccess: () => {
      toast.success('Job queued for retry');
      queryClient.invalidateQueries({ queryKey: ['dlq-summary'] });
    },
    onError: (e: any) => { if (!e?._handled) toast.error('Failed to retry job'); },
  });

  const rejectMutation = useMutation({
    mutationFn: (jobId: string) => imageServiceApi.rejectJob(jobId),
    onSuccess: () => {
      toast.success('Job rejected');
      queryClient.invalidateQueries({ queryKey: ['dlq-summary'] });
    },
    onError: (e: any) => { if (!e?._handled) toast.error('Failed to reject job'); },
  });

  const bulkRetryMutation = useMutation({
    mutationFn: (jobType?: string) => imageServiceApi.bulkRetryDlq(jobType),
    onSuccess: (res: any) => {
      toast.success(`${res.updated} jobs sent for retry`);
      queryClient.invalidateQueries({ queryKey: ['dlq-summary'] });
    },
    onError: (e: any) => { if (!e?._handled) toast.error('Failed to bulk retry'); },
  });

  const bulkRejectMutation = useMutation({
    mutationFn: (jobType?: string) => imageServiceApi.bulkRejectDlq(jobType),
    onSuccess: (res: any) => {
      toast.success(`${res.updated} jobs rejected`);
      queryClient.invalidateQueries({ queryKey: ['dlq-summary'] });
    },
    onError: (e: any) => { if (!e?._handled) toast.error('Failed to bulk reject'); },
  });

  const jobs = dlq?.jobs ?? [];
  const filteredJobs = filterType ? jobs.filter((j: any) => j.jobType === filterType) : jobs;
  const jobTypes = dlq?.byJobType ? Object.keys(dlq.byJobType) : [];

  const tableHeaderClass = `text-xs font-medium uppercase tracking-wider ${themeConfig.text.secondary} px-4 py-3 text-left`;
  const tableCellClass = `text-sm px-4 py-2.5 ${themeConfig.text.primary}`;

  return (
    <div className="p-6">
      <div className="mb-6">
        <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
          Image Service · {t('imageService.deadLetter.title')}
        </p>
        <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.deadLetter.title')}</h1>
        <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.deadLetter.subtitle')}</p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className={`${themeConfig.card} rounded-lg p-5`}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-red-400" />
            <span className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.deadLetter.total')}</span>
          </div>
          <span className="text-xl font-bold text-red-400">{dlq?.total ?? 0}</span>
        </div>
        <div className={`${themeConfig.card} rounded-lg p-5`}>
          <div className="flex items-center gap-2 mb-2">
            <Layers size={16} className="text-purple-400" />
            <span className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.deadLetter.byJobType')}</span>
          </div>
          <span className="text-xl font-bold text-purple-400">{jobTypes.length}</span>
        </div>
        <div className={`${themeConfig.card} rounded-lg p-5`}>
          <div className="flex items-center gap-2 mb-2">
            <Clock size={16} className="text-amber-400" />
            <span className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.deadLetter.oldest')}</span>
          </div>
          <span className="text-xl font-bold text-amber-400">
            {jobs.length > 0 ? new Date(jobs[jobs.length - 1].queuedAt).toLocaleDateString() : '—'}
          </span>
        </div>
        <div className={`${themeConfig.card} rounded-lg p-5`}>
          <div className="flex items-center gap-2 mb-2">
            <XCircle size={16} className="text-gray-400" />
            <span className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.deadLetter.maxRetries')}</span>
          </div>
          <span className="text-xl font-bold" style={{ color: themeConfig.text.primary }}>
            {jobs.length > 0 ? Math.max(...jobs.map((j: any) => j.retryCount)) : 0}
          </span>
        </div>
      </div>

      <div className={`${themeConfig.card} rounded-lg p-5 mb-6`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>
            {t('imageService.deadLetter.jobTypeBreakdown')}
          </h3>
          <div className="flex items-center gap-2">
            <SearchableSelect
              value={filterType}
              onChange={setFilterType}
              options={[
                { value: '', label: t('imageService.deadLetter.allTypes') },
                ...jobTypes.map((t: string) => ({ value: t, label: t })),
              ]}
            />
            <Button size="sm" variant="ghost" onClick={() => bulkRetryMutation.mutate(filterType || undefined)}
              disabled={bulkRetryMutation.isPending}>
              <RotateCcw size={14} className="mr-1" />
              {t('imageService.deadLetter.retryAll')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => bulkRejectMutation.mutate(filterType || undefined)}
              disabled={bulkRejectMutation.isPending} className="text-red-400 hover:text-red-300">
              <Trash2 size={14} className="mr-1" />
              {t('imageService.deadLetter.rejectAll')}
            </Button>
          </div>
        </div>

        {jobTypes.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {Object.entries(dlq.byJobType).map(([type, count]: [string, any]) => (
              <div key={type} className={`px-3 py-1.5 rounded-lg text-xs font-medium 
                ${filterType === type ? 'bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/30' : 'bg-white/5 ' + themeConfig.text.secondary}`}
                onClick={() => setFilterType(filterType === type ? '' : type)} style={{ cursor: 'pointer' }}>
                {type}: {count}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`${themeConfig.card} rounded-lg overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className={`border-b ${themeConfig.cardBorder}`}>
                <th className={tableHeaderClass}>{t('imageService.deadLetter.jobType')}</th>
                <th className={tableHeaderClass}>{t('imageService.deadLetter.image')}</th>
                <th className={tableHeaderClass}>{t('imageService.deadLetter.error')}</th>
                <th className={tableHeaderClass}>{t('imageService.deadLetter.retries')}</th>
                <th className={tableHeaderClass}>{t('imageService.deadLetter.queuedAt')}</th>
                <th className={`${tableHeaderClass} text-right`}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                <tr><td colSpan={6} className={`text-center py-8 text-sm ${themeConfig.text.secondary}`}>Loading...</td></tr>
              ) : filteredJobs.length === 0 ? (
                <tr><td colSpan={6} className={`text-center py-8 text-sm ${themeConfig.text.secondary}`}>
                  {t('imageService.deadLetter.noDeadLetters')}
                </td></tr>
              ) : filteredJobs.map((job: any) => (
                <tr key={job.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className={tableCellClass}>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-400">
                      {job.jobType}
                    </span>
                  </td>
                  <td className={tableCellClass}>
                    <div className="text-xs text-gray-400">{job.imageFilename || job.imageId?.slice(0, 8)}</div>
                  </td>
                  <td className={tableCellClass}>
                    <div className="text-xs text-red-300 max-w-[240px] truncate" title={job.errorMessage ?? ''}>
                      {job.errorMessage ?? '—'}
                    </div>
                  </td>
                  <td className={tableCellClass}>
                    <span className="text-xs">{job.retryCount}/{job.maxRetries}</span>
                  </td>
                  <td className={tableCellClass}>
                    <span className="text-xs text-gray-400">{new Date(job.queuedAt).toLocaleString()}</span>
                  </td>
                  <td className={`${tableCellClass} text-right`}>
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => retryMutation.mutate(job.id)}
                        disabled={retryMutation.isPending} title={t('imageService.deadLetter.retry')}>
                        <RotateCcw size={14} />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => rejectMutation.mutate(job.id)}
                        disabled={rejectMutation.isPending} className="text-red-400 hover:text-red-300" title={t('imageService.deadLetter.reject')}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
