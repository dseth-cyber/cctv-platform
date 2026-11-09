import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { formatDateTime } from '@/utils/dateUtils';
import { ArrowLeft, Camera, Wifi, WifiOff, AlertTriangle, Wrench,
  RefreshCw, Edit, Trash2, HardDrive, Clock } from 'lucide-react';
import { Button, TableSkeleton } from '@/components/ui';
import { CameraSpecCard } from '@/components/cctv/CameraSpecCard';

const CAMERA_STATUS_STYLES: Record<string, { bg: string; icon: any }> = {
  active: { bg: 'bg-green-500/20 text-green-400', icon: Wifi },
  inactive: { bg: 'bg-gray-500/20 text-gray-400', icon: WifiOff },
  error: { bg: 'bg-red-500/20 text-red-400', icon: AlertTriangle },
  maintenance: { bg: 'bg-yellow-500/20 text-yellow-400', icon: Wrench },
};

export default function ImageServiceCameraDetail() {
  const { t, i18n } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const { data: camera, isLoading } = useQuery({
    queryKey: ['camera', id],
    queryFn: () => imageServiceApi.getCamera(id!),
    enabled: !!id,
  });

  if (isLoading) return <div className="p-6"><TableSkeleton rows={6} /></div>;
  if (!camera) return <div className="p-6 text-red-400">{t('ui.imageServiceCameraDetail.cameraNotFound')}</div>;

  const statusStyle = CAMERA_STATUS_STYLES[camera.status] ?? CAMERA_STATUS_STYLES.inactive;
  const StatusIcon = statusStyle.icon;

  return (
    <div className="p-6">
      <button onClick={() => navigate('/cctv/cameras')}
        className={`flex items-center gap-1 text-sm mb-4 hover:text-cyan-300 transition-colors ${themeConfig.text.secondary}`}>
        <ArrowLeft size={14} /> {t('common.back')}
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
            iSmart CCTV · {t('imageService.cameras.title')}
          </p>
          <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{camera.name}</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className={`p-4 rounded-xl border ${themeConfig.card}`}>
          <div className="flex items-center gap-2 mb-2">
            <Camera size={16} className="text-cyan-400" />
            <span className={`text-xs font-medium uppercase tracking-wider ${themeConfig.text.secondary}`}>
              {t('imageService.cameras.status')}
            </span>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium inline-flex items-center gap-1 ${statusStyle.bg}`}>
            <StatusIcon size={11} />
            {t(`imageService.cameras.${camera.status}`)}
          </span>
        </div>


        <div className={`p-4 rounded-xl border ${themeConfig.card}`}>
          <div className="flex items-center gap-2 mb-2">
            <Clock size={16} className="text-cyan-400" />
            <span className={`text-xs font-medium uppercase tracking-wider ${themeConfig.text.secondary}`}>
              {t('imageService.cameras.lastPoll')}
            </span>
          </div>
          <p className={`text-xl font-bold ${themeConfig.text.primary}`}>
            {camera.lastPolledAt ? formatDateTime(camera.lastPolledAt, i18n.language) : '—'}
          </p>
        </div>
      </div>

      <div className={`p-4 rounded-xl border ${themeConfig.card} mb-6`}>
        <h3 className={`text-sm font-semibold mb-3 ${themeConfig.text.primary}`}>
          {t('imageService.cameras.cameraInfo')}
        </h3>
        <dl className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
          <dt className={themeConfig.text.secondary}>{t('ui.imageServiceCameraDetail.ip')}</dt>
          <dd className={themeConfig.text.primary}>{camera.ipAddress}</dd>
          <dt className={themeConfig.text.secondary}>{t('imageService.cameras.description')}</dt>
          <dd className={themeConfig.text.primary}>{camera.description || '—'}</dd>
          <dt className={themeConfig.text.secondary}>{t('ui.imageServiceCameras.streamPath')}</dt>
          <dd className={`${themeConfig.text.primary} font-mono text-xs`}>{camera.streamPath || '—'}</dd>
          {/* Stored RTSP URLs come back with the password redacted. */}
          <dt className={themeConfig.text.secondary}>{t('ui.imageServiceCameras.rtspUrlMain')}</dt>
          <dd className={`${themeConfig.text.primary} font-mono text-xs break-all`}>{camera.rtspUrl || '—'}</dd>
          <dt className={themeConfig.text.secondary}>{t('ui.imageServiceCameras.rtspUrlSub')}</dt>
          <dd className={`${themeConfig.text.primary} font-mono text-xs break-all`}>{camera.rtspUrlSub || '—'}</dd>
        </dl>
      </div>
      <CameraSpecCard spec={camera.spec} readAt={camera.device?.healthCheckedAt} />

    </div>
  );
}
