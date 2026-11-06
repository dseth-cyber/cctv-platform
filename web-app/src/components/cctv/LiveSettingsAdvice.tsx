import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Lightbulb } from 'lucide-react';
import { imageServiceApi } from '@/services/imageServiceApi';

interface Props {
  refreshSeconds: string;
  deviceConcurrency: string;
  globalConcurrency: string;
  onApplyRefresh: (seconds: number) => void;
}

/** What the values being typed would mean on this system, worked out by the server from its own numbers. */
export function LiveSettingsAdvice({ refreshSeconds, deviceConcurrency, globalConcurrency, onApplyRefresh }: Props) {
  const { t } = useTranslation();
  const [params, setParams] = useState({ refreshSeconds, deviceConcurrency, globalConcurrency });
  useEffect(() => {
    const timer = setTimeout(() => setParams({ refreshSeconds, deviceConcurrency, globalConcurrency }), 400);
    return () => clearTimeout(timer);
  }, [refreshSeconds, deviceConcurrency, globalConcurrency]);

  const { data, isError } = useQuery<any>({
    queryKey: ['snapshot-advice', params],
    queryFn: () => imageServiceApi.getSnapshotAdvice(params),
    retry: false,
    refetchInterval: 15_000,
    placeholderData: (prev: any) => prev,
  });
  if (isError || !data) return null;
  const { advice, now } = data;

  return (
    <div className="col-span-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-xs space-y-1.5">
      <div className="flex items-center gap-1.5 font-semibold text-cyan-300">
        <Lightbulb size={14} /> {t('imageService.systemConfig.liveAdvice.title')}
      </div>
      <p className="text-slate-300">
        {t('imageService.systemConfig.liveAdvice.load', { cameras: advice.cameras, busiest: advice.busiestDeviceCameras, ips: advice.imagesPerSecond, mbps: advice.bandwidthMbps })}
      </p>
      {advice.keepsUp ? (
        <p className="text-emerald-300">{t('imageService.systemConfig.liveAdvice.ok', { s: advice.achievableSeconds })}</p>
      ) : (
        <div className="text-amber-300 flex flex-wrap items-center gap-2">
          <span>
            {t('imageService.systemConfig.liveAdvice.slow', {
              set: params.refreshSeconds,
              s: advice.achievableSeconds,
              limit: t(`imageService.systemConfig.liveAdvice.limit_${advice.limitedBy}`),
              rec: advice.recommendedRefreshSeconds,
            })}
          </span>
          <button type="button" onClick={() => onApplyRefresh(advice.recommendedRefreshSeconds)} className="px-2 py-0.5 rounded border border-amber-400/50 hover:bg-amber-400/10">
            {t('imageService.systemConfig.liveAdvice.apply', { rec: advice.recommendedRefreshSeconds })}
          </button>
        </div>
      )}
      <p className="text-slate-400">
        {advice.source === 'measured'
          ? t('imageService.systemConfig.liveAdvice.measured', { samples: advice.samples, ms: advice.avgMs, kb: advice.avgKb })
          : t('imageService.systemConfig.liveAdvice.assumed', { ms: advice.avgMs, kb: advice.avgKb })}
      </p>
      <p className="text-slate-400">
        {t('imageService.systemConfig.liveAdvice.now', { n: now.demanded, perMin: now.imagesPerMinute, mb: now.cacheMb })}
      </p>
    </div>
  );
}
