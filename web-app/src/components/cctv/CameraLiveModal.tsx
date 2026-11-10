import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Maximize2, Radio } from 'lucide-react';
import { Modal } from '@/components/ui';
import { CameraLivePlayer } from '@/components/cctv/LiveHdPlayer';
import { useAuth } from '@/contexts/AuthContext';
import { hasPermission } from '@/App';

/** Button that opens {@link CameraLiveModal}; looks the same wherever a camera can be watched in place. */
export function WatchLiveButton({ onClick, compact = false }: { onClick: () => void; compact?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  if (!hasPermission(user, 'live:view')) return null;
  return (
    <button
      type="button"
      data-live-open
      onClick={onClick}
      title={t('ui.cameraAnalytics.watchLive')}
      className={`inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 hover:text-emerald-200 font-medium transition-colors ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'}`}
    >
      <Radio size={compact ? 11 : 13} />
      {t('ui.cameraAnalytics.watchLive')}
    </button>
  );
}

/**
 * Quick live look at one camera. The player is mounted only while open, so closing it (or going on to the live wall)
 * drops the stream and it never runs twice.
 */
export function CameraLiveModal({ camera, onClose }: {
  camera: { id: string; name: string; operationalStatus?: string | null } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Modal isOpen={!!camera} onClose={onClose} title={camera?.name ?? ''} size="4xl">
      {camera && (
        <div data-live-modal className="space-y-3">
          {camera.operationalStatus === 'offline' && (
            <p className="flex items-center gap-1.5 text-xs text-amber-300">
              <AlertTriangle size={14} />
              {t('ui.cameraAnalytics.liveOffline')}
            </p>
          )}
          <div className="aspect-video w-full rounded-lg overflow-hidden bg-black">
            <CameraLivePlayer cameraId={camera.id} cameraName={camera.name} className="w-full h-full" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg border border-white/10 text-sm text-slate-300 hover:bg-white/5">
              {t('common.close')}
            </button>
            <button
              type="button"
              data-live-wall
              onClick={() => { onClose(); navigate(`/cctv/live-grid?focus=${camera.id}`); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium"
            >
              <Maximize2 size={14} />
              {t('ui.cameraAnalytics.openOnLiveWall')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
