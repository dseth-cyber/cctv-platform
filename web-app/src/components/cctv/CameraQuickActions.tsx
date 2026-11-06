import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Film, Pencil, Server, Star } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { hasPermission } from '@/App';

/** What can be done with a camera wherever it is shown live: star it, or go straight to its recordings. */
export function CameraQuickActions({ cameraId, deviceId, isFavorite, onToggleFavorite }: {
  cameraId: string;
  deviceId?: string | null;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canEdit = hasPermission(user, 'cameras:update');
  const actionClass = 'p-1 rounded bg-slate-950/80 hover:bg-slate-800 text-slate-300 hover:text-cyan-300';
  const stay = { onClick: (e: React.MouseEvent) => e.stopPropagation(), onDoubleClick: (e: React.MouseEvent) => e.stopPropagation() };
  return (
    <>
      {canEdit && (
        <Link data-no-focus to={`/cctv/cameras?edit=${cameraId}&back=1`} {...stay} title={t('ui.liveGrid.editCamera')} aria-label={t('ui.liveGrid.editCamera')} className={actionClass}>
          <Pencil className="w-3.5 h-3.5" />
        </Link>
      )}
      {deviceId && (
        <Link data-no-focus to={`/cctv/devices?device=${deviceId}&back=1`} {...stay} title={t('ui.liveGrid.manageDevice')} aria-label={t('ui.liveGrid.manageDevice')} className={actionClass}>
          <Server className="w-3.5 h-3.5" />
        </Link>
      )}
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
