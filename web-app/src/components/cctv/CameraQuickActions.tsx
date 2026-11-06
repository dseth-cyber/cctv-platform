import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Film, Star } from 'lucide-react';

/** What can be done with a camera wherever it is shown live: star it, or go straight to its recordings. */
export function CameraQuickActions({ cameraId, isFavorite, onToggleFavorite }: {
  cameraId: string;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Link
        data-no-focus
        to={`/cctv/playback?cameraId=${cameraId}`}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        title={t('ui.liveGrid.openPlayback')}
        aria-label={t('ui.liveGrid.openPlayback')}
        className="p-1 rounded bg-slate-950/80 hover:bg-slate-800 text-slate-300 hover:text-cyan-300"
      >
        <Film className="w-3.5 h-3.5" />
      </Link>
      <button
        type="button"
        data-no-focus
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(cameraId);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        aria-pressed={isFavorite}
        title={isFavorite ? t('ui.liveGrid.overview.unstar') : t('ui.liveGrid.overview.star')}
        aria-label={isFavorite ? t('ui.liveGrid.overview.unstar') : t('ui.liveGrid.overview.star')}
        className="p-1 rounded bg-slate-950/80 hover:bg-slate-800"
      >
        <Star className={`w-3.5 h-3.5 ${isFavorite ? 'fill-amber-400 text-amber-400' : 'text-slate-400'}`} />
      </button>
    </>
  );
}
