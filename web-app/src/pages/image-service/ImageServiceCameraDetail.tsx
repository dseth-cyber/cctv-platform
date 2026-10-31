import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { useFeatures } from '@/hooks/useFeatures'
import { formatDateTime } from '@/utils/dateUtils';
import { ArrowLeft, Camera, Wifi, WifiOff, AlertTriangle, Wrench,
  RefreshCw, Edit, Trash2, HardDrive, Clock } from 'lucide-react';
import { Button, TableSkeleton } from '@/components/ui';

const CAMERA_STATUS_STYLES: Record<string, { bg: string; icon: any }> = {
  active: { bg: 'bg-green-500/20 text-green-400', icon: Wifi },
  inactive: { bg: 'bg-gray-500/20 text-gray-400', icon: WifiOff },
  error: { bg: 'bg-red-500/20 text-red-400', icon: AlertTriangle },
  maintenance: { bg: 'bg-yellow-500/20 text-yellow-400', icon: Wrench },
};

export default function ImageServiceCameraDetail() {
  const { factoryModules } = useFeatures()
  const { t, i18n } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [scanning, setScanning] = useState(false);

  const { data: camera, isLoading } = useQuery({
    queryKey: ['camera', id],
    queryFn: () => imageServiceApi.getCamera(id!),
    enabled: !!id,
  });

  const { data: images = [] } = useQuery({
    queryKey: ['camera-images', id],
    queryFn: () => imageServiceApi.getImages({ cameraId: id, limit: 20 }),
    enabled: !!id && factoryModules,
  });

  const handleScan = async () => {
    if (!id) return;
    setScanning(true);
    try {
      await imageServiceApi.scanCamera(id);
      toast.success(t('imageService.cameras.scanTriggered'));
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['camera', id] }), 3000);
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
    finally { setScanning(false); }
  };

  if (isLoading) return <div className="p-6"><TableSkeleton rows={6} /></div>;
  if (!camera) return <div className="p-6 text-red-400">{t('ui.imageServiceCameraDetail.cameraNotFound')}</div>;

  const statusStyle = CAMERA_STATUS_STYLES[camera.status] ?? CAMERA_STATUS_STYLES.inactive;
  const StatusIcon = statusStyle.icon;

  return (
    <div className="p-6">
      <button onClick={() => navigate('/image-service/cameras')}
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
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleScan} disabled={scanning}>
            <RefreshCw size={16} className={`mr-1.5 ${scanning ? 'animate-spin' : ''}`} />
            {t('imageService.cameras.scanNow')}
          </Button>
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
            <HardDrive size={16} className="text-cyan-400" />
            <span className={`text-xs font-medium uppercase tracking-wider ${themeConfig.text.secondary}`}>
              {t('imageService.cameras.totalImages')}
            </span>
          </div>
          <p className={`text-xl font-bold ${themeConfig.text.primary}`}>
            {Number(camera.totalImagesCount ?? 0).toLocaleString()}
          </p>
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
          <dt className={themeConfig.text.secondary}>{t('ui.imageServiceCameraDetail.smbPath')}</dt>
          <dd className={`${themeConfig.text.primary} font-mono text-xs`}>{camera.smbSharePath}</dd>
          <dt className={themeConfig.text.secondary}>{t('imageService.cameras.captureMode')}</dt>
          <dd className={themeConfig.text.primary}>{camera.captureMode}</dd>
          <dt className={themeConfig.text.secondary}>{t('imageService.cameras.pollInterval')}</dt>
          <dd className={themeConfig.text.primary}>{camera.pollIntervalSeconds}s</dd>
          <dt className={themeConfig.text.secondary}>{t('imageService.cameras.smbUsername')}</dt>
          <dd className={themeConfig.text.primary}>{camera.smbUsername}</dd>
        </dl>
      </div>

      <div className={`p-4 rounded-xl border ${themeConfig.card}`}>
        <h3 className={`text-sm font-semibold mb-3 ${themeConfig.text.primary}`}>
          {t('imageService.search.recentImages')}
        </h3>
        {images.length === 0 ? (
          <p className={`text-sm ${themeConfig.text.secondary}`}>{t('common.noData')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className={themeConfig.tableHeader}>
                <tr>
                  <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.secondary}`}>#</th>
                  <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.secondary}`}>{t('imageService.search.filename')}</th>
                  <th className={`px-3 py-2 text-right text-xs font-semibold ${themeConfig.text.secondary}`}>{t('imageService.search.size')}</th>
                  <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.secondary}`}>{t('imageService.search.capturedAt')}</th>
                  <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.secondary}`}>{t('imageService.search.status')}</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${themeConfig.tableDivide}`}>
                {(Array.isArray(images) ? images : images.data ?? []).slice(0, 10).map((img: any, idx: number) => (
                  <tr key={img.id} className={themeConfig.tableRow}>
                    <td className={`px-3 py-2 text-xs ${themeConfig.text.primary}`}>{idx + 1}</td>
                    <td className={`px-3 py-2 text-xs font-mono ${themeConfig.text.primary}`}>{img.filename}</td>
                    <td className={`px-3 py-2 text-xs text-right ${themeConfig.text.secondary}`}>
                      {img.fileSizeBytes ? t('ui.imageServiceCameraDetail.mb', { v0: (img.fileSizeBytes / 1024 / 1024).toFixed(1) }) : '—'}
                    </td>
                    <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>
                      {img.capturedAt ? formatDateTime(img.capturedAt, i18n.language) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        img.status === 'processed' ? 'bg-green-500/20 text-green-400' :
                        img.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                        img.status === 'error' ? 'bg-red-500/20 text-red-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {t(`imageService.search.status${img.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
