import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { imageServiceApi } from '@/services/imageServiceApi';

/** What permanently deleting these cameras takes with it, known before the person confirms. */
export function useDeletionImpact(ids: string[], enabled: boolean) {
  return useQuery<any>({
    queryKey: ['camera-deletion-impact', ids.join(',')],
    queryFn: () => imageServiceApi.getCameraDeletionImpact(ids),
    enabled: enabled && ids.length > 0,
    staleTime: 0,
  });
}

const size = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(bytes / 1024 ** 2)} MB`);

export function DeletionImpactNote({ impact, skipsHeld = false }: { impact: any; skipsHeld?: boolean }) {
  const { t } = useTranslation();
  if (!impact) return null;
  const hasFiles = impact.clips > 0 || impact.recordings > 0;
  return (
    <div className="space-y-1 text-xs" data-deletion-impact>
      {impact.legalHold > 0 && (
        <p className="font-semibold text-rose-300">
          {t(skipsHeld ? 'imageService.cameras.deletionHeldSkipped' : 'imageService.cameras.deletionHeld', { n: impact.legalHold })}
        </p>
      )}
      {hasFiles ? (
        <p className="text-amber-300">{t('imageService.cameras.deletionFiles', { clips: impact.clips, recordings: impact.recordings, size: size(impact.bytes) })}</p>
      ) : (
        <p className="text-slate-400">{t('imageService.cameras.deletionNoFiles')}</p>
      )}
    </div>
  );
}
