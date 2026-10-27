import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { Responsive, WidthProvider } from 'react-grid-layout';
import { imageServiceApi } from '@/services/imageServiceApi';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
} from 'recharts';
import { GripVertical, Settings, RotateCcw, Check, Star, Camera, HardDrive, Activity, Image, TrendingUp, Clock, CheckCircle, ShieldCheck } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { ExportButton, CountUpValue, ChartShimmerLoader, SearchableSelect } from '@/components/ui';
import { PERIOD_OPTIONS, periodDays as periodDaysOf, formatBucketLabel } from '@/lib/periodOptions';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);
const LAYOUT_STORAGE_KEY = 'image_service_overview_layout_v2';

const DEFAULT_LAYOUTS = {
  lg: [
    { i: 'trends', x: 0, y: 0, w: 12, h: 4.5, minW: 6, minH: 3.5 },
    { i: 'stats', x: 0, y: 4.5, w: 12, h: 1.5, minW: 6, minH: 1.5 },
    { i: 'recent', x: 0, y: 6, w: 6, h: 2.5, minW: 3, minH: 2 },
    { i: 'growth', x: 6, y: 6, w: 6, h: 2.5, minW: 3, minH: 2 },
    { i: 'throughputHistory', x: 0, y: 8.5, w: 12, h: 2.5, minW: 6, minH: 2 },
    { i: 'averageThroughput', x: 0, y: 11, w: 3, h: 3, minW: 3, minH: 2.5 },
    { i: 'cameraStatus', x: 3, y: 11, w: 3, h: 3, minW: 3, minH: 2.5 },
    { i: 'byCamera', x: 6, y: 11, w: 3, h: 3, minW: 3, minH: 2.5 },
    { i: 'storageDonut', x: 9, y: 11, w: 3, h: 3, minW: 3, minH: 2.5 },
    { i: 'queueLength', x: 0, y: 14, w: 4, h: 2, minW: 3, minH: 1.5 },
    { i: 'postgresStats', x: 4, y: 14, w: 4, h: 2, minW: 3, minH: 1.5 },
    { i: 'providerStats', x: 8, y: 14, w: 4, h: 2, minW: 3, minH: 1.5 },
  ],
  md: [
    { i: 'trends', x: 0, y: 0, w: 10, h: 4.5, minW: 6, minH: 3.5 },
    { i: 'stats', x: 0, y: 4.5, w: 10, h: 1.5, minW: 6, minH: 1.5 },
    { i: 'recent', x: 0, y: 6, w: 5, h: 2.5, minW: 3, minH: 2 },
    { i: 'growth', x: 5, y: 6, w: 5, h: 2.5, minW: 3, minH: 2 },
    { i: 'throughputHistory', x: 0, y: 8.5, w: 10, h: 2.5, minW: 5, minH: 2 },
    { i: 'averageThroughput', x: 0, y: 11, w: 5, h: 3, minW: 3, minH: 2.5 },
    { i: 'cameraStatus', x: 5, y: 11, w: 5, h: 3, minW: 3, minH: 2.5 },
    { i: 'byCamera', x: 0, y: 14, w: 5, h: 3, minW: 3, minH: 2.5 },
    { i: 'storageDonut', x: 5, y: 14, w: 5, h: 3, minW: 3, minH: 2.5 },
    { i: 'queueLength', x: 0, y: 17, w: 3, h: 2, minW: 3, minH: 1.5 },
    { i: 'postgresStats', x: 3, y: 17, w: 4, h: 2, minW: 3, minH: 1.5 },
    { i: 'providerStats', x: 7, y: 17, w: 3, h: 2, minW: 3, minH: 1.5 },
  ],
  sm: [
    { i: 'trends', x: 0, y: 0, w: 6, h: 4.5, minW: 4, minH: 3.5 },
    { i: 'stats', x: 0, y: 4.5, w: 6, h: 1.5, minW: 4, minH: 1.5 },
    { i: 'recent', x: 0, y: 6, w: 6, h: 2.5, minW: 3, minH: 2 },
    { i: 'growth', x: 0, y: 8.5, w: 6, h: 2.5, minW: 3, minH: 2 },
    { i: 'throughputHistory', x: 0, y: 11, w: 6, h: 2.5, minW: 3, minH: 2 },
    { i: 'averageThroughput', x: 0, y: 13.5, w: 6, h: 3, minW: 3, minH: 2.5 },
    { i: 'cameraStatus', x: 0, y: 16.5, w: 6, h: 3, minW: 3, minH: 2.5 },
    { i: 'byCamera', x: 0, y: 19.5, w: 6, h: 3, minW: 3, minH: 2.5 },
    { i: 'storageDonut', x: 0, y: 22.5, w: 6, h: 3, minW: 3, minH: 2.5 },
    { i: 'queueLength', x: 0, y: 25.5, w: 6, h: 2, minW: 3, minH: 1.5 },
    { i: 'postgresStats', x: 0, y: 27.5, w: 6, h: 2, minW: 3, minH: 1.5 },
    { i: 'providerStats', x: 0, y: 29.5, w: 6, h: 2, minW: 3, minH: 1.5 },
  ],
};

const BAR_COLORS = ['#06b6d4', '#8b5cf6', '#f59e0b', '#10B880', '#ef4444', '#3b82f6'];
const PIE_COLORS = ['#06b6d4', '#8b5cf6', '#f59e0b', '#10B880', '#ef4444'];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const formattedLabel = label && typeof label === 'string' && label.includes('T') && label.endsWith('Z') ? (() => {
    try {
      const date = new Date(label);
      return `${String(date.getHours()).padStart(2, '0')}:00`;
    } catch {
      return label;
    }
  })() : label;
  return (
    <div className="px-3 py-2 rounded-lg border border-white/20 bg-slate-900/90 backdrop-blur-md text-xs shadow-xl">
      <p className="text-gray-300 mb-1">{formattedLabel}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-semibold">
          {p.name}: {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </p>
      ))}
    </div>
  );
};

function DragHandle({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="drag-handle absolute top-2 right-2 cursor-grab active:cursor-grabbing opacity-40 hover:opacity-90 transition-opacity z-10 p-1 rounded-md bg-black/40 backdrop-blur-sm">
      <GripVertical size={13} className="text-white" />
    </div>
  );
}

function TimebaseBadge({ timebase, t, themeConfig }: { timebase: 'capture' | 'ingestion'; t: any; themeConfig: any }) {
  const label = timebase === 'capture'
    ? t('imageService.overview.timebaseCaptureShort', 'เวลาถ่ายภาพ')
    : t('imageService.overview.timebaseIngestionShort', 'เวลาประมวลผล');
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${themeConfig.inputBorder} ${themeConfig.text.secondary}`}>
      {label}
    </span>
  );
}

function formatBytes(bytes: number) {
  if (bytes === 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const mergeLayouts = (savedLayouts: any, defaultLayouts: any) => {
  if (!savedLayouts) return defaultLayouts;
  const merged = { ...savedLayouts };
  for (const breakpoint of ['lg', 'md', 'sm'] as const) {
    if (!merged[breakpoint]) {
      merged[breakpoint] = defaultLayouts[breakpoint];
      continue;
    }
    const savedKeys = new Set(merged[breakpoint].map((w: any) => w.i));
    const missing = defaultLayouts[breakpoint].filter((w: any) => !savedKeys.has(w.i));
    if (missing.length > 0) {
      const maxY = Math.max(...merged[breakpoint].map((w: any) => w.y + w.h), 0);
      const appended = missing.map((w: any, idx: number) => ({
        ...w,
        y: maxY + idx * 2.5
      }));
      merged[breakpoint] = [...merged[breakpoint], ...appended];
    }
  }
  return merged;
};

const safeParseLayout = (value: any) => {
  if (!value || value === '[object Object]') return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* ignore */ }
  return null;
};

export default function ImageServiceOverview() {
  const { t, i18n } = useTranslation();
  const { themeConfig } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const [isEditing, setIsEditing] = useState(false);
  const [timebase, setTimebase] = useState<'capture' | 'ingestion'>(
    () => (localStorage.getItem('image_service_overview_timebase') === 'capture' ? 'capture' : 'ingestion'),
  );
  const [period, setPeriod] = useState<string>('7d');

  const handleTimebaseChange = useCallback((mode: 'capture' | 'ingestion') => {
    setTimebase(mode);
    localStorage.setItem('image_service_overview_timebase', mode);
  }, []);
  const [throughputUnit, setThroughputUnit] = useState<'minute' | 'hour' | 'day'>('hour');
  const [defaultLayout, setDefaultLayout] = useState<any>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [layouts, setLayouts] = useState(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (saved) return mergeLayouts(JSON.parse(saved), DEFAULT_LAYOUTS);
    } catch {}
    return DEFAULT_LAYOUTS;
  });

  const { data: systemConfig } = useQuery({
    queryKey: ['system-config'],
    queryFn: () => imageServiceApi.getSystemConfigs(),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (systemConfig?.dashboard_layout_overview?.value) {
      const parsed = safeParseLayout(systemConfig.dashboard_layout_overview.value);
      if (parsed) {
        const merged = mergeLayouts(parsed, DEFAULT_LAYOUTS);
        setDefaultLayout(merged);
        const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
        if (!saved) {
          setLayouts(merged);
        }
      }
    }
  }, [systemConfig]);

  // Dispatch a window resize event shortly after mount to resolve grid layout squishing issues
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  // Same query key as the Storage Providers settings page ('storage-providers') — not a
  // page-local key — so editing a provider's capacity/active state there invalidates this
  // card immediately instead of leaving it to show stale data until staleTime expires.
  // refetchInterval is still kept as a fallback for edits made from another tab/session.
  const { data: providers = [] } = useQuery({
    queryKey: ['storage-providers'],
    queryFn: () => imageServiceApi.getStorageProviders(undefined, { silent403: true }).then((r: any) => r.data ?? r),
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
  });

  const { data: overview, isLoading } = useQuery({
    queryKey: ['image-service-overview', timebase],
    queryFn: () => imageServiceApi.getOverview(timebase),
    refetchInterval: 1000 * 30,
  });

  const { data: trendsData } = useQuery({
    queryKey: ['overview-period-trends', period, timebase],
    queryFn: () => imageServiceApi.getTrends(period, timebase),
    staleTime: 1000 * 60 * 2,
  });

  const dailyBreakdown = trendsData?.dailyBreakdown ?? [];
  const avgImagesPerDay = dailyBreakdown.length > 0
    ? Math.round(dailyBreakdown.reduce((sum: number, d: any) => sum + (d.images || 0), 0) / dailyBreakdown.length)
    : (overview?.processingRate ? Math.round(overview.processingRate * 24) : 0);

  const periodOptions = PERIOD_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey, o.fallback) }));
  const periodDays = periodDaysOf(period);
  const bucketUnit = trendsData?.bucketUnit;
  const isHourly = bucketUnit === 'hour';

  const handleLayoutChange = useCallback((_l: any, allLayouts: any) => {
    setLayouts(allLayouts);
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(allLayouts));
  }, []);

  const handleResetLayout = () => {
    setLayouts(DEFAULT_LAYOUTS);
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
  };

  const handleSaveDefaultLayout = async () => {
    try {
      await imageServiceApi.updateSystemConfigs({ dashboard_layout_overview: JSON.stringify(layouts) });
      toast.success(t('imageService.overview.defaultLayoutSaved'));
    } catch {
      toast.error(t('common.error'));
    }
  };

  const hourlyThroughput = overview?.hourlyThroughput ?? [];
  const totalProcessed24h = hourlyThroughput.reduce((sum: number, item: any) => sum + (item.value ?? 0), 0);
  const avgProcessedPerHour = Math.round((totalProcessed24h / 24) * 10) / 10;

  const camOnline = overview?.camerasOnline ?? 0;
  const camOffline = overview?.camerasOffline ?? 0;
  const camNotWorking = (overview?.inactiveCameras ?? 0) + (overview?.maintenanceCameras ?? 0) + (overview?.errorCameras ?? 0);
  const camTotal = (overview?.activeCameras ?? 0) + camNotWorking;
  // Reachability is judged against cameras a human set ACTIVE. A deliberately
  // disabled camera shows in the breakdown as "not working" but never turns the
  // card red — red is reserved for active-yet-unreachable machines.
  const camSubParts = [
    `${t('imageService.overview.camWorking', 'ทำงาน')} ${camOnline}`,
    ...(camNotWorking > 0 ? [`${t('imageService.overview.camNotWorking', 'ไม่ทำงาน')} ${camNotWorking}`] : []),
    ...(camOffline > 0 ? [`⚠ ${t('imageService.overview.camUnreachable', 'เชื่อมต่อไม่ได้')} ${camOffline}`] : []),
  ];
  const stats = [
    {
      label: t('imageService.overview.totalImages'),
      value: <CountUpValue value={overview ? overview.totalImages : undefined} isLoading={isLoading} />,
      icon: Image,
      color: '#06b6d4',
    },
    {
      label: t('imageService.overview.onlineCameras', 'กล้องออนไลน์ (ติดต่อได้จริง)'),
      value: (
        <>
          <CountUpValue value={overview ? camOnline : undefined} isLoading={isLoading} /> /{' '}
          <CountUpValue value={overview ? camTotal : undefined} isLoading={isLoading} />
        </>
      ),
      icon: Camera,
      color: camOffline > 0 ? '#ef4444' : '#10B880',
      sub: camSubParts.join(' · '),
    },
    {
      label: t('imageService.overview.storageUsed'),
      value: (
        <span className="inline-flex items-baseline gap-1">
          <CountUpValue
            value={overview?.storageUsed ? overview.storageUsed / (1024 * 1024 * 1024) : undefined}
            isLoading={isLoading}
            formatter={(v) => v.toFixed(2)}
            suffix=" GB"
          />
          <span className={`text-xs font-normal ${themeConfig.text.secondary}`}>
            / {formatBytes(overview?.storageTotal ?? 0)}
          </span>
        </span>
      ),
      icon: HardDrive,
      color: '#8b5cf6',
    },
    {
      label: t('imageService.overview.processingRate'),
      value: (
        <>
          <CountUpValue value={overview ? overview.processingRate : undefined} isLoading={isLoading} />{' '}
          {t('imageService.overview.perHour')}
        </>
      ),
      icon: Activity,
      color: '#f59e0b',
    },
  ];
  // Both charts follow the page's period selector: derive them from the
  // period-aware daily breakdown (getTrends(period)) rather than the fixed
  // 7-day overview payload. Fall back to overview data until trends load.
  const recentActivity = dailyBreakdown.length > 0
    ? dailyBreakdown.map((d: any) => ({ label: formatBucketLabel(String(d.date), bucketUnit), value: d.images }))
    : (overview?.recentActivity ?? []);
  const storageGrowth = dailyBreakdown.length > 0
    ? dailyBreakdown.map((d: any) => ({ label: formatBucketLabel(String(d.date), bucketUnit), value: Math.round(d.storage / (1024 * 1024 * 1024) * 100) / 100 }))
    : (overview?.storageGrowth ?? []).map((d: any) => ({ label: d.label, value: Math.round(d.value / (1024 * 1024 * 1024) * 100) / 100 }));
  const imagesByCamera = overview?.imagesByCamera ?? [];
  const storageByTypeRaw = overview?.storageByType ?? [];
  const fileTypeNameKey: Record<string, string> = { raw: 'imageService.storage.rawImages', thumbnail: 'imageService.storage.thumbnails', processed: 'imageService.storage.processedImages' };
  const storageByType = storageByTypeRaw.map((d: any) => ({ ...d, name: t(fileTypeNameKey[d.name] ?? d.name) }));

  const tickFill = themeConfig.name === 'light' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)';
  const gridStroke = themeConfig.name === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';
  const trackColor = themeConfig.name === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';

  return (
    <div className="p-4 sm:p-6 overflow-x-hidden">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className={`text-xs font-medium mb-0.5 uppercase tracking-widest ${themeConfig.text.secondary}`}>
            {t('imageService.nav.imageService')} · {t('imageService.overview.title')}
          </p>
          <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>
            {t('imageService.overview.title')}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Global Period Selector Dropdown */}
          <div className="w-32 shrink-0" title={t('imageService.overview.periodSelectorHint', 'เลือกช่วงเวลากรองข้อมูลสถิติทั่วทั้งหน้า')}>
            <SearchableSelect
              value={period}
              onChange={setPeriod}
              options={periodOptions}
              showSearch={false}
            />
          </div>
          <div
            className={`hidden sm:flex items-center rounded-lg border ${themeConfig.inputBorder} overflow-hidden text-xs font-medium`}
            title={t('imageService.overview.timebaseHint', 'เลือกฐานเวลาสำหรับกราฟกิจกรรมรายวันและการเติบโตของพื้นที่จัดเก็บ')}
          >
            {(['capture', 'ingestion'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => handleTimebaseChange(mode)}
                className={`px-3 py-2 flex items-center gap-1.5 transition-colors ${
                  timebase === mode
                    ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white'
                    : `${themeConfig.text.secondary} hover:bg-white/5`
                }`}
              >
                {mode === 'capture' ? <Camera size={13} /> : <Clock size={13} />}
                {mode === 'capture'
                  ? t('imageService.overview.timebaseCapture', 'เวลาถ่ายภาพจริง')
                  : t('imageService.overview.timebaseIngestion', 'เวลาประมวลผลระบบ')}
              </button>
            ))}
          </div>
          {isEditing && (
            <>
              <button onClick={handleResetLayout}
                className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5
                  border ${themeConfig.inputBorder} ${themeConfig.text.primary} hover:bg-white/5 transition-colors`}>
                <RotateCcw size={13} /> {t('imageService.overview.resetLayout')}
              </button>
              {isAdmin && (
                <button onClick={handleSaveDefaultLayout}
                  className="px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5
                    bg-gradient-to-r from-yellow-600 to-orange-600 text-white hover:brightness-110 transition-all">
                  <Star size={13} /> {t('imageService.overview.setDefaultLayout')}
                </button>
              )}
            </>
          )}
          <button onClick={() => setIsEditing((v) => !v)}
            className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${isEditing
              ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white'
              : `border ${themeConfig.inputBorder} ${themeConfig.text.secondary} hover:bg-white/5`}`}>
            {isEditing ? <Check size={14} /> : <Settings size={14} />}
            {isEditing ? t('imageService.overview.finishEditing') : t('imageService.overview.editLayout')}
          </button>
          <ExportButton
            filename="image-service-overview"
            title={t('imageService.overview.title')}
            sections={[
              { title: t('imageService.overview.title'), columns: [
                { key: 'label', label: 'Metric' }, { key: 'value', label: 'Value' },
              ], data: stats.map(s => ({ label: s.label, value: s.value })) },
              { title: t('imageService.overview.cameraStatus'), columns: [
                { key: 'status', label: t('imageService.cameras.status') }, { key: 'count', label: t('imageService.overview.totalImages') }, { key: 'pct', label: '%' },
              ], data: (() => {
                const total = (overview?.activeCameras ?? 0) + (overview?.inactiveCameras ?? 0) + (overview?.errorCameras ?? 0) + (overview?.maintenanceCameras ?? 0);
                return [
                  { status: t('imageService.cameras.active'), count: overview?.activeCameras ?? 0, pct: total ? `${((overview?.activeCameras ?? 0) / total * 100).toFixed(0)}%` : '0%' },
                  { status: t('imageService.cameras.maintenance'), count: overview?.maintenanceCameras ?? 0, pct: total ? `${((overview?.maintenanceCameras ?? 0) / total * 100).toFixed(0)}%` : '0%' },
                  { status: t('imageService.cameras.inactive'), count: overview?.inactiveCameras ?? 0, pct: total ? `${((overview?.inactiveCameras ?? 0) / total * 100).toFixed(0)}%` : '0%' },
                  { status: t('imageService.cameras.error'), count: overview?.errorCameras ?? 0, pct: total ? `${((overview?.errorCameras ?? 0) / total * 100).toFixed(0)}%` : '0%' },
                ];
              })() },
              { title: t('imageService.storage.byFileType'), columns: [
                { key: 'name', label: t('imageService.storage.byFileType') }, { key: 'files', label: t('imageService.storage.totalFiles') }, { key: 'size', label: t('imageService.storage.totalSize') },
              ], data: storageByType.map((d: any) => ({ name: d.name, files: String(d.value ?? 0), size: '-' })) },
              { title: t('imageService.overview.recentActivity'), columns: [
                { key: 'label', label: t('common.date') }, { key: 'value', label: t('imageService.overview.totalImages') },
              ], data: recentActivity },
              { title: `${t('imageService.overview.storageGrowth')} (GB)`, columns: [
                { key: 'label', label: t('common.date') }, { key: 'value', label: 'GB' },
              ], data: storageGrowth },
              { title: t('imageService.overview.imagesByCamera'), columns: [
                { key: 'name', label: t('imageService.cameras.cameraName') }, { key: 'value', label: t('imageService.overview.totalImages') },
              ], data: imagesByCamera },
              { title: t('imageService.overview.queueTitle'), columns: [
                { key: 'label', label: 'Queue' }, { key: 'value', label: 'Count' },
              ], data: [
                { label: t('imageService.overview.queueWait'), value: overview?.queue?.wait ?? 0 },
                { label: t('imageService.overview.queueActive'), value: overview?.queue?.active ?? 0 },
                { label: t('imageService.overview.queueFailed'), value: overview?.queue?.failed ?? 0 },
                { label: t('imageService.overview.queueDelayed'), value: overview?.queue?.delayed ?? 0 },
              ] },
              { title: t('imageService.overview.postgresTitle'), columns: [
                { key: 'label', label: 'Metric' }, { key: 'value', label: 'Value' },
              ], data: [
                { label: t('imageService.overview.postgresTps'), value: overview?.postgres?.tps ?? 0 },
                { label: t('imageService.overview.postgresActiveConnections'), value: overview?.postgres?.activeConnections ?? 0 },
                { label: t('imageService.overview.postgresLocks'), value: overview?.postgres?.locks ?? 0 },
                { label: t('imageService.overview.postgresDeadlocks'), value: overview?.postgres?.deadlocks ?? 0 },
              ] },
              { title: t('imageService.overview.providerTitle'), columns: [
                { key: 'name', label: t('imageService.storageProviders.providerName') }, { key: 'type', label: t('imageService.storageProviders.providerType') }, { key: 'size', label: t('imageService.storage.totalSize') }, { key: 'isDefault', label: t('imageService.overview.default') },
              ], data: (providers as any[]).map((p: any) => ({ name: p.name, type: p.type, size: formatBytes(p.usedBytes ?? 0), isDefault: p.isDefault ? '✅' : '' })) },
            ]}
          />
        </div>
      </div>

      {isEditing && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-xs ${themeConfig.card}`}>
          {t('imageService.overview.dragHint')}
        </div>
      )}

      <div ref={contentRef}>
      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={{ lg: 900, md: 700, sm: 480 }}
        cols={{ lg: 12, md: 10, sm: 6 }}
        rowHeight={100}
        isDraggable={isEditing}
        isResizable={isEditing}
        draggableHandle=".drag-handle"
        onLayoutChange={handleLayoutChange}
        compactType="vertical"
      >
        <div key="stats" className={`${themeConfig.card} rounded-lg overflow-hidden relative`}>
          <DragHandle show={isEditing} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5 h-full">
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle size={18} style={{ color: '#10b981' }} />
                <span className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.overview.onlineCameras', 'กล้องออนไลน์ (ติดต่อได้จริง)')}</span>
              </div>
              <span className="text-2xl font-bold" style={{ color: '#10b981' }}>
                <CountUpValue value={camOnline} isLoading={isLoading} /> / <CountUpValue value={camTotal} isLoading={isLoading} />
              </span>
              <span className={`text-[11px] mt-0.5 ${camOffline > 0 ? 'text-red-400' : themeConfig.text.secondary}`}>
                {camOffline > 0 ? t('imageService.overview.offlineCount', 'ออฟไลน์ {{count}} ตัว', { count: camOffline }) : t('imageService.overview.allOnline', 'กล้องปกติทุกตัว')}
              </span>
            </div>

            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={18} style={{ color: '#06b6d4' }} />
                <span className={`text-xs ${themeConfig.text.secondary}`}>
                  {isHourly
                    ? t('imageService.overview.hourlyAvgImages', 'ค่าเฉลี่ยภาพถ่ายต่อชั่วโมง')
                    : t('imageService.overview.dailyAvgImages', 'ค่าเฉลี่ยภาพถ่ายต่อวัน')}
                </span>
              </div>
              <span className="text-2xl font-bold text-cyan-400">
                <CountUpValue value={avgImagesPerDay} isLoading={isLoading} />
              </span>
              <span className={`text-[11px] mt-0.5 ${themeConfig.text.secondary}`}>
                {isHourly
                  ? t('imageService.overview.avgPeriodSubToday', 'เฉลี่ยสถิติจริงวันนี้ (รายชั่วโมง)')
                  : t('imageService.overview.avgPeriodSub', 'เฉลี่ยสถิติจริง {{days}} วันย้อนหลัง', { days: periodDays })}
              </span>
            </div>

            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-2 mb-2">
                <HardDrive size={18} style={{ color: '#f59e0b' }} />
                <span className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.overview.storageUsed')}</span>
              </div>
              <span className="text-2xl font-bold" style={{ color: '#f59e0b' }}>
                {formatBytes(overview?.storageUsed ?? overview?.totalBytes ?? 0)}
                {overview?.storageTotal ? ` / ${formatBytes(overview.storageTotal)}` : ''}
              </span>
              <span className={`text-[11px] mt-0.5 ${themeConfig.text.secondary}`}>
                {t('imageService.overview.storagePercentWithFree', 'ใช้ไป {{pct}}% (เหลืออีก {{free}})', {
                  pct: (overview?.storageUsed && overview?.storageTotal)
                    ? Math.round((overview.storageUsed / overview.storageTotal) * 100)
                    : (overview?.storagePercent ?? 0),
                  free: overview?.storageTotal
                    ? formatBytes(Math.max(0, overview.storageTotal - (overview?.storageUsed ?? 0)))
                    : '-'
                })}
              </span>
              <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-amber-400/90 font-medium">
                <ShieldCheck size={12} className="shrink-0 text-amber-400" />
                <span>{t('imageService.overview.retentionHint', 'ลบภาพอัตโนมัติตามนโยบายการจัดเก็บ (Raw ➔ Processed ➔ Thumbnail)')}</span>
              </div>
            </div>
          </div>
        </div>

        <div key="recent" className={`${themeConfig.card} rounded-lg overflow-hidden relative p-5 flex flex-col h-full`}>
          <DragHandle show={isEditing} />
          <h3 className={`text-sm font-semibold mb-3 flex-shrink-0 flex items-center gap-2 ${themeConfig.text.primary}`}>
            {t('imageService.overview.recentActivity')}
            <TimebaseBadge timebase={timebase} t={t} themeConfig={themeConfig} />
          </h3>
          <ResponsiveContainer width="100%" height="100%" className="flex-1 min-h-0">
            <AreaChart data={recentActivity} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="recentGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="label" tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="value" stroke="#06b6d4" strokeWidth={2} fill="url(#recentGrad)" dot={false} name={t('imageService.overview.imagesToday')} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div key="growth" className={`${themeConfig.card} rounded-lg overflow-hidden relative p-5 flex flex-col h-full`}>
          <DragHandle show={isEditing} />
          <h3 className={`text-sm font-semibold mb-3 flex-shrink-0 flex items-center gap-2 ${themeConfig.text.primary}`}>
            {t('imageService.overview.storageGrowth')} (GB)
            <TimebaseBadge timebase={timebase} t={t} themeConfig={themeConfig} />
          </h3>
          <ResponsiveContainer width="100%" height="100%" className="flex-1 min-h-0">
            <BarChart data={storageGrowth} barCategoryGap="30%" margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={gridStroke} />
              <XAxis dataKey="label" tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
              <Bar dataKey="value" name={t('imageService.overview.storageGrowth', 'แนวโน้มพื้นที่เก็บข้อมูล')} radius={[4, 4, 0, 0]}>
                {storageGrowth.map((_: any, i: number) => (
                  <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                ))}
                <LabelList dataKey="value" position="top" style={{ fill: tickFill, fontSize: 10 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div key="throughputHistory" className={`${themeConfig.card} rounded-lg overflow-hidden relative p-5 flex flex-col h-full`}>
          <DragHandle show={isEditing} />
          <h3 className={`text-sm font-semibold mb-3 flex-shrink-0 ${themeConfig.text.primary}`}>
            {t('imageService.overview.throughputHistory', 'ประวัติอัตราการประมวลผล (24 ชั่วโมง)')}
          </h3>
          <ResponsiveContainer width="100%" height="100%" className="flex-1 min-h-0">
            <AreaChart data={hourlyThroughput} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="throughputGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis 
                dataKey="label" 
                tick={{ fill: tickFill, fontSize: 10 }} 
                axisLine={false} 
                tickLine={false} 
                tickFormatter={(tick) => {
                  try {
                    const d = new Date(tick);
                    return `${String(d.getHours()).padStart(2, '0')}:00`;
                  } catch {
                    return tick;
                  }
                }}
              />
              <YAxis tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2} fill="url(#throughputGrad)" dot={false} name={t('imageService.overview.jobsCompleted', 'งานที่เสร็จสิ้น')} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div key="averageThroughput" className={`${themeConfig.card} rounded-lg overflow-hidden relative p-5 flex flex-col h-full`}>
          <DragHandle show={isEditing} />
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>
              {t('imageService.overview.averageThroughput', 'อัตราการประมวลผลเฉลี่ย')}
            </h3>
            <div className="flex gap-1 bg-white/5 p-0.5 rounded border border-white/10 select-none">
              {(['minute', 'hour', 'day'] as const).map((unit) => (
                <button
                  key={unit}
                  onClick={() => setThroughputUnit(unit)}
                  className={`px-1.5 py-0.5 text-[9px] rounded transition-all font-medium ${
                    throughputUnit === unit
                      ? 'bg-amber-500 text-slate-950 font-semibold shadow-sm'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {unit === 'minute' ? t('imageService.overview.unitMinute', 'นาที') :
                   unit === 'hour' ? t('imageService.overview.unitHour', 'ชั่วโมง') :
                   t('imageService.overview.unitDay', 'วัน')}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 flex flex-col justify-center items-center relative min-h-0">
            <div className="p-4 rounded-full bg-amber-500/10 mb-3 animate-pulse">
              <Activity size={32} className="text-amber-400" />
            </div>
            <span className={`text-3xl font-extrabold tracking-tight ${themeConfig.text.primary}`}>
              {throughputUnit === 'minute' ? (totalProcessed24h / (24 * 60)).toFixed(2) :
               throughputUnit === 'hour' ? (totalProcessed24h / 24).toFixed(1) :
               totalProcessed24h.toLocaleString()}
            </span>
            <span className={`text-xs mt-1.5 font-medium ${themeConfig.text.secondary}`}>
              {throughputUnit === 'minute' ? t('imageService.overview.perMinuteLabel', 'ภาพ / นาที') :
               throughputUnit === 'hour' ? t('imageService.overview.perHourLabel', 'ภาพ / ชั่วโมง') :
               t('imageService.overview.perDayLabel', 'ภาพ / วัน')}
            </span>
            <p className="text-[10px] text-gray-500 mt-4 text-center italic select-none">
              {t('imageService.overview.averagePeriodDesc', 'คำนวณจากยอดประมวลผลสะสมในรอบ 24 ชั่วโมงที่ผ่านมา')}
            </p>
          </div>
        </div>

        <div key="cameraStatus" className={`${themeConfig.card} rounded-lg relative p-5 flex flex-col h-full`}>
          <DragHandle show={isEditing} />
          <h3 className={`text-sm font-semibold mb-3 flex-shrink-0 ${themeConfig.text.primary}`}>
            {t('imageService.overview.cameraStatus')}
          </h3>
          {(() => {
            const camData = [
              { name: t('imageService.cameras.active'), value: overview?.activeCameras ?? 0, color: '#10B880' },
              { name: t('imageService.cameras.maintenance'), value: overview?.maintenanceCameras ?? 0, color: '#f59e0b' },
              { name: t('imageService.cameras.inactive'), value: overview?.inactiveCameras ?? 0, color: '#6b7280' },
              { name: t('imageService.cameras.error'), value: overview?.errorCameras ?? 0, color: '#ef4444' },
            ];
            const totalCams = camData.reduce((s, d) => s + d.value, 0);
            return (
              <>
                <ResponsiveContainer width="100%" height="100%" className="flex-1 min-h-0">
                  <PieChart>
                    <Pie data={camData.filter(d => d.value > 0)} cx="50%" cy="55%" innerRadius={50} outerRadius={70}
                      paddingAngle={3} dataKey="value" nameKey="name"
                      label={({ name, value }: any) => `${name}: ${value}`}>
                      {camData.filter(d => d.value > 0).map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-3 space-y-1.5">
                  {camData.map((item, i) => {
                    const pct = totalCams > 0 ? ((item.value / totalCams) * 100).toFixed(0) : '0';
                    return (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                          <span className={themeConfig.text.primary}>{item.name}</span>
                        </div>
                        <span className={themeConfig.text.primary}>{item.value} <span className={themeConfig.text.secondary}>({pct}%)</span></span>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>

        <div key="byCamera" className={`${themeConfig.card} rounded-lg overflow-hidden relative p-5 flex flex-col h-full`}>
          <DragHandle show={isEditing} />
          <h3 className={`text-sm font-semibold mb-3 flex-shrink-0 ${themeConfig.text.primary}`}>
            {t('imageService.overview.imagesByCamera')}
          </h3>
          <ResponsiveContainer width="100%" height="100%" className="flex-1 min-h-0">
            <BarChart data={imagesByCamera} layout="vertical" barCategoryGap="20%" margin={{ top: 0, right: 32, left: 0, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke={gridStroke} />
              <XAxis type="number" tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis dataKey="name" type="category" tick={{ fill: tickFill, fontSize: 10 }} axisLine={false} tickLine={false} width={80} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
              <Bar dataKey="value" name={t('imageService.overview.totalImages', 'ภาพทั้งหมด')} radius={[0, 4, 4, 0]}>
                {imagesByCamera.map((_: any, i: number) => (
                  <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                ))}
                <LabelList dataKey="value" position="right" style={{ fill: tickFill, fontSize: 10 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div key="storageDonut" className={`${themeConfig.card} rounded-lg relative p-5 flex flex-col h-full`}>
          <DragHandle show={isEditing} />
          <h3 className={`text-sm font-semibold mb-3 flex-shrink-0 ${themeConfig.text.primary}`}>
            {t('imageService.storage.byFileType')}
          </h3>
          <div className="relative flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={storageByType} cx="50%" cy="55%" innerRadius={50} outerRadius={70}
                  paddingAngle={3} dataKey="value" nameKey="name"
                  label={({ name, value }: any) => `${name}: ${value.toLocaleString()}`}>
                  {storageByType.map((_: any, i: number) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className={`text-2xl font-bold ${themeConfig.text.primary}`}>
                {storageByType.reduce((s: number, v: any) => s + (v.value ?? 0), 0).toLocaleString()}
              </span>
              <span className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.overview.files')}</span>
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            {storageByType.map((item: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i] }} />
                  <span className={themeConfig.text.primary}>{item.name}</span>
                </div>
                <span className={themeConfig.text.primary}>{item.value.toLocaleString()} files</span>
              </div>
            ))}
          </div>
        </div>

        <div key="queueLength" className={`${themeConfig.card} rounded-lg overflow-hidden relative p-5 flex flex-col h-full`}>
          <DragHandle show={isEditing} />
          <h3 className={`text-sm font-semibold mb-3 flex-shrink-0 ${themeConfig.text.primary}`}>
            {t('imageService.overview.queueTitle')}
          </h3>
          <div className="space-y-2 flex-1">
            {[
              { label: t('imageService.overview.queueWait'), value: overview?.queue?.wait ?? 0, color: 'text-cyan-400' },
              { label: t('imageService.overview.queueActive'), value: overview?.queue?.active ?? 0, color: 'text-blue-400' },
              { label: t('imageService.overview.queueFailed'), value: overview?.queue?.failed ?? 0, color: 'text-red-400' },
              { label: t('imageService.overview.queueDelayed'), value: overview?.queue?.delayed ?? 0, color: 'text-purple-400' },
            ].map((q, idx) => (
              <div key={idx} className="flex justify-between items-center text-xs py-1 border-b border-white/5 last:border-0 animate-fade-in">
                <span className={themeConfig.text.secondary}>{q.label}</span>
                <span className={`font-bold ${q.color}`}>{q.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div key="postgresStats" className={`${themeConfig.card} rounded-lg overflow-hidden relative p-5 flex flex-col h-full`}>
          <DragHandle show={isEditing} />
          <h3 className={`text-sm font-semibold mb-3 flex-shrink-0 ${themeConfig.text.primary}`}>
            {t('imageService.overview.postgresTitle')}
          </h3>
          <div className="space-y-2 flex-1">
            {[
              { label: t('imageService.overview.postgresTps'), value: overview?.postgres?.tps ?? 0, color: 'text-cyan-400' },
              { label: t('imageService.overview.postgresActiveConnections'), value: overview?.postgres?.activeConnections ?? 0, color: 'text-green-400' },
              { label: t('imageService.overview.postgresLocks'), value: overview?.postgres?.locks ?? 0, color: 'text-yellow-400' },
              { label: t('imageService.overview.postgresDeadlocks'), value: overview?.postgres?.deadlocks ?? 0, color: (overview?.postgres?.deadlocks ?? 0) > 0 ? 'text-red-400 font-extrabold animate-pulse' : 'text-gray-400' },
            ].map((p, idx) => (
              <div key={idx} className="flex justify-between items-center text-xs py-1 border-b border-white/5 last:border-0">
                <span className={themeConfig.text.secondary}>{p.label}</span>
                <span className={`font-bold ${p.color}`}>{p.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div key="providerStats" className={`${themeConfig.card} rounded-lg overflow-hidden relative p-5 flex flex-col h-full`}>
          <DragHandle show={isEditing} />
          <h3 className={`text-sm font-semibold mb-3 flex-shrink-0 ${themeConfig.text.primary}`}>
            {t('imageService.overview.providerTitle')}
          </h3>
          <div className="space-y-3 flex-1 overflow-y-auto">
            {Array.isArray(providers) && providers.length > 0 ? providers.map((p: any) => {
              const used = p.latestMetric?.usedBytes ?? 0;
              const total = p.capacityBytes ? Number(p.capacityBytes) : (p.latestMetric?.totalBytes || 0);
              const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
              const barColor = pct > 85 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#06b6d4';
              return (
                <div key={p.id} className="px-2 py-1.5 rounded-lg bg-white/5">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${p.isActive ? 'bg-green-400' : 'bg-red-400'}`} />
                      <span className={`font-medium truncate ${themeConfig.text.primary}`}>{p.name}</span>
                      <span className={`font-mono ${themeConfig.text.secondary}`}>({p.type})</span>
                    </div>
                    <span className={`flex-shrink-0 ml-2 ${p.isDefault ? 'text-yellow-400' : themeConfig.text.secondary}`}>
                      {p.isDefault ? t('imageService.overview.default') : ''}
                    </span>
                  </div>
                  {total > 0 ? (
                    <>
                      <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                      </div>
                      <div className="flex justify-between text-[10px] mt-0.5">
                        <span className={themeConfig.text.secondary}>{formatBytes(used)} / {formatBytes(total)}</span>
                        <span style={{ color: barColor }}>{pct.toFixed(1)}%</span>
                      </div>
                    </>
                  ) : (
                    <div className={`text-[10px] ${themeConfig.text.secondary}`}>{formatBytes(used)}</div>
                  )}
                </div>
              );
            }) : (
              <p className={`text-xs ${themeConfig.text.secondary} text-center py-4`}>
                {t('imageService.overview.noProviders')}
              </p>
            )}
          </div>
        </div>
      </ResponsiveGridLayout>
      </div>
    </div>
  );
}
