import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Responsive, WidthProvider } from 'react-grid-layout';
import { imageServiceApi } from '@/services/imageServiceApi';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line,
} from 'recharts';
import { HardDrive, FileImage, Image, Archive, BarChart3, TrendingUp, Calendar, AlertTriangle, Clock, GripVertical, Settings, RotateCcw, Check, Star } from 'lucide-react';
import { SearchableSelect, ExportButton, CountUpValue } from '@/components/ui';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);
const LAYOUT_STORAGE_KEY = 'image_service_storage_layout_v10';

const DEFAULT_LAYOUTS: Record<string, any[]> = {
  lg: [
    { i: 'stats', x: 0, y: 0, w: 8, h: 2, minW: 6, minH: 1.5 },
    { i: 'projectionTable', x: 8, y: 0, w: 4, h: 5, minW: 3, minH: 3 },
    { i: 'pieByFileType', x: 0, y: 2, w: 4, h: 3.5, minW: 3, minH: 2.5 },
    { i: 'forecastChart', x: 4, y: 2, w: 4, h: 3.5, minW: 3, minH: 2.5 },
    { i: 'growthTrend', x: 0, y: 5.5, w: 6, h: 3, minW: 3, minH: 2.5 },
    { i: 'byCamera', x: 6, y: 5.5, w: 6, h: 3, minW: 4, minH: 2.5 },
  ],
  md: [
    { i: 'stats', x: 0, y: 0, w: 10, h: 2, minW: 6, minH: 1.5 },
    { i: 'pieByFileType', x: 0, y: 2, w: 5, h: 3.5, minW: 3, minH: 2.5 },
    { i: 'forecastChart', x: 5, y: 2, w: 5, h: 3.5, minW: 3, minH: 2.5 },
    { i: 'projectionTable', x: 0, y: 5.5, w: 4, h: 4, minW: 3, minH: 3 },
    { i: 'growthTrend', x: 4, y: 5.5, w: 6, h: 3, minW: 3, minH: 2.5 },
    { i: 'byCamera', x: 0, y: 9.5, w: 10, h: 3, minW: 4, minH: 2.5 },
  ],
  sm: [
    { i: 'stats', x: 0, y: 0, w: 6, h: 2, minW: 4, minH: 1.5 },
    { i: 'pieByFileType', x: 0, y: 2, w: 6, h: 3.5, minW: 3, minH: 2.5 },
    { i: 'forecastChart', x: 0, y: 5.5, w: 6, h: 3.5, minW: 3, minH: 2.5 },
    { i: 'projectionTable', x: 0, y: 9, w: 6, h: 4, minW: 3, minH: 3 },
    { i: 'growthTrend', x: 0, y: 13, w: 6, h: 3, minW: 3, minH: 2.5 },
    { i: 'byCamera', x: 0, y: 16, w: 6, h: 3, minW: 4, minH: 2.5 },
  ],
};

const PIE_COLORS = ['#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444'];
const BAR_COLORS = ['#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#3b82f6'];

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

const PieBytesTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const bytes = p.value;
  const gb = bytes / (1024 * 1024 * 1024);
  const mb = bytes / (1024 * 1024);
  const displaySize = gb >= 0.1 ? `${gb.toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
  return (
    <div className="px-3 py-2 rounded-lg border border-white/20 bg-slate-900/90 backdrop-blur-md text-xs shadow-xl">
      <p style={{ color: p.payload?.fill || p.color }} className="font-semibold mb-1">{p.name}</p>
      <p className="text-white font-bold">{displaySize}</p>
      <p className="text-gray-400">{p.payload?.files?.toLocaleString()} {p.payload?.files !== undefined ? 'files' : ''}</p>
    </div>
  );
};

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + units[i];
}

function DragHandle({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="drag-handle absolute top-2 right-2 cursor-grab active:cursor-grabbing opacity-40 hover:opacity-90 transition-opacity z-10 p-1 rounded-md bg-black/40 backdrop-blur-sm">
      <GripVertical size={13} className="text-white" />
    </div>
  );
}

const safeParseLayout = (value: any) => {
  if (!value || value === '[object Object]') return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* ignore */ }
  return null;
};

export default function ImageServiceStorage() {
  const { t, i18n } = useTranslation();
  const { themeConfig } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const [days, setDays] = useState(30);
  const [isEditing, setIsEditing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [layouts, setLayouts] = useState(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_LAYOUTS;
    } catch { return DEFAULT_LAYOUTS; }
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['storage-summary'],
    queryFn: () => imageServiceApi.getStorageSummary(),
    refetchInterval: 1000 * 60,
  });

  const { data: growth } = useQuery({
    queryKey: ['storage-growth', days],
    queryFn: () => imageServiceApi.getStorageGrowth(days),
    staleTime: 1000 * 60 * 2,
  });

  const { data: forecast, isLoading: forecastLoading } = useQuery({
    queryKey: ['storage-forecast'],
    queryFn: () => imageServiceApi.getStorageForecast(),
    staleTime: 1000 * 60 * 5,
  });

  const { data: cameras = [] } = useQuery({
    queryKey: ['cameras'],
    queryFn: () => imageServiceApi.getCameras(),
    staleTime: 1000 * 60 * 5,
  });

  const { data: systemConfig } = useQuery({
    queryKey: ['system-config'],
    queryFn: () => imageServiceApi.getSystemConfigs(),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (systemConfig?.dashboard_layout_storage?.value) {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (!saved) {
        const parsed = safeParseLayout(systemConfig.dashboard_layout_storage.value);
        if (parsed) setLayouts(parsed);
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
      await imageServiceApi.updateSystemConfigs({ dashboard_layout_storage: JSON.stringify(layouts) });
      toast.success(t('imageService.overview.defaultLayoutSaved'));
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
  };

  const tickFill = themeConfig.name === 'light' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)';
  const gridStroke = themeConfig.name === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';

  const byFileType = summary?.byFileType ? Object.entries(summary.byFileType).map(([k, v]: any) => ({
    name: t(`imageService.storage.${k === 'raw' ? 'rawImages' : k === 'processed' ? 'processedImages' : 'thumbnails'}`),
    value: v.bytes,
    files: v.files,
  })) : [];

  const byCamera = summary?.byCamera?.map((c: any) => ({
    name: c.cameraName,
    value: c.bytes || c.files,
  })) ?? [];

  const growthData = growth?.data?.map((d: any) => ({
    label: d.date?.slice(5),
    value: Math.round(d.bytesAdded / (1024 * 1024)),
    images: d.imagesAdded,
  })) ?? [];

  const statsCards = [
    { label: t('imageService.storage.totalFiles'), value: (summary?.totalFiles ?? 0).toLocaleString(), icon: FileImage, color: '#06b6d4' },
    { label: t('imageService.storage.totalSize'), value: `${formatBytes(summary?.totalBytes ?? 0)} / ${formatBytes(summary?.totalCapacity ?? 0)}`, icon: HardDrive, color: '#8b5cf6' },
    { label: t('imageService.storage.byFileType'), value: `${byFileType.length} ${t('imageService.storage.types')}`, icon: Archive, color: '#f59e0b' },
    { label: t('imageService.storage.growthTrend'), value: growthData.length > 1
      ? growthData[growthData.length - 1].value > growthData[0].value ? t('common.increasing') : t('common.stable')
      : '—', icon: TrendingUp, color: '#10b981' },
    {
      label: t('imageService.storage.daysUntilFull'),
      value: forecast?.daysUntilFull != null
        ? `${forecast.daysUntilFull.toLocaleString()} ${t('imageService.storage.days')}`
        : '—',
      icon: Clock,
      color: forecast?.daysUntilFull != null && forecast.daysUntilFull < 120 ? '#ef4444' : '#10b981',
    },
  ];

  const hasData = summary && byFileType.length > 0;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
            Image Service · {t('imageService.storage.title')}
          </p>
          <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.storage.title')}</h1>
          <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.storage.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
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
          <button onClick={() => setIsEditing(!isEditing)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5
              ${isEditing
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white'
                : `border ${themeConfig.inputBorder} ${themeConfig.text.primary} hover:bg-white/5`} transition-all`}>
            {isEditing ? <Check size={14} /> : <Settings size={14} />}
            {isEditing ? t('imageService.overview.finishEditing') : t('imageService.overview.editLayout')}
          </button>
          <ExportButton
            filename="image-service-storage"
            title={t('imageService.storage.title')}
            sections={[
              { title: t('imageService.storage.title'), columns: [
                { key: 'label', label: 'Metric' }, { key: 'value', label: 'Value' },
              ], data: statsCards.map(s => ({ label: s.label, value: s.value })) },
              { title: t('imageService.storage.byFileType'), columns: [
                { key: 'name', label: t('imageService.storage.byFileType') },
                { key: 'files', label: t('imageService.storage.totalFiles') },
                { key: 'size', label: t('imageService.storage.totalSize') },
              ], data: byFileType.map(f => ({ name: f.name, files: f.files, size: formatBytes(f.value) })) },
              { title: t('imageService.storage.byCamera'), columns: [
                { key: 'name', label: t('imageService.cameras.cameraName') },
                { key: 'value', label: t('imageService.storage.totalSize') },
              ], data: byCamera.map((c: any) => ({ name: c.name, value: formatBytes(c.value) })) },
              { title: t('imageService.storage.growthTrend'), columns: [
                { key: 'label', label: t('common.date') },
                { key: 'value', label: 'MB' },
                { key: 'images', label: t('imageService.overview.totalImages') },
              ], data: growthData },
              ...(forecast ? [{ title: t('imageService.storage.forecast'), columns: [
                { key: 'label', label: 'Metric' }, { key: 'value', label: 'Value' },
              ], data: [
                { label: t('imageService.storage.usage'), value: `${forecast.usagePercent?.toFixed(1)}%` },
                { label: t('imageService.storage.dailyGrowth'), value: `${formatBytes(forecast.dailyGrowthRate)}/day` },
                { label: t('imageService.storage.daysUntilFull'), value: forecast.daysUntilFull != null ? `${forecast.daysUntilFull} ${t('imageService.storage.days')}` : '-' },
              ] }] : []),
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
            <div className="grid grid-cols-5 gap-4 p-5 h-full">
              <div className="flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-2">
                  <FileImage size={18} style={{ color: '#06b6d4' }} />
                  <span className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.storage.totalFiles')}</span>
                </div>
                <span className="text-xl font-bold" style={{ color: '#06b6d4' }}>
                  <CountUpValue value={summary?.totalFiles} isLoading={summaryLoading} />
                </span>
              </div>

              <div className="flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-2">
                  <HardDrive size={18} style={{ color: '#8b5cf6' }} />
                  <span className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.storage.totalSize')}</span>
                </div>
                <span className="text-xl font-bold flex items-baseline gap-1" style={{ color: '#8b5cf6' }}>
                  <CountUpValue
                    value={summary ? summary.totalBytes / (1024 * 1024 * 1024) : undefined}
                    isLoading={summaryLoading}
                    formatter={(v) => v.toFixed(2)}
                    suffix=" GB"
                  />
                  <span className={`text-xs font-normal ${themeConfig.text.secondary}`}>
                    / {formatBytes(summary?.totalCapacity ?? 0)}
                  </span>
                </span>
              </div>

              <div className="flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-2">
                  <Archive size={18} style={{ color: '#f59e0b' }} />
                  <span className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.storage.byFileType')}</span>
                </div>
                <span className="text-xl font-bold" style={{ color: '#f59e0b' }}>
                  <CountUpValue value={summary ? byFileType.length : undefined} isLoading={summaryLoading} suffix={` ${t('imageService.storage.types')}`} />
                </span>
              </div>

              <div className="flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp size={18} style={{ color: '#10b981' }} />
                  <span className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.storage.growthTrend')}</span>
                </div>
                <span className="text-xl font-bold" style={{ color: '#10b981' }}>
                  {growthData.length > 1
                    ? growthData[growthData.length - 1].value > growthData[0].value ? t('common.increasing') : t('common.stable')
                    : '—'}
                </span>
              </div>

              <div className="flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-2">
                  <Clock size={18} style={{ color: forecast?.daysUntilFull != null && forecast.daysUntilFull < 120 ? '#ef4444' : '#10b981' }} />
                  <span className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.storage.daysUntilFull')}</span>
                </div>
                <span className="text-xl font-bold" style={{ color: forecast?.daysUntilFull != null && forecast.daysUntilFull < 120 ? '#ef4444' : '#10b981' }}>
                  <CountUpValue value={forecast ? forecast.daysUntilFull : undefined} isLoading={forecastLoading} suffix={` ${t('imageService.storage.days')}`} />
                </span>
              </div>
            </div>
          </div>

          <div key="pieByFileType" className={`${themeConfig.card} rounded-lg overflow-hidden relative p-5 flex flex-col h-full`}>
            <DragHandle show={isEditing} />
            <h3 className={`text-sm font-semibold mb-3 flex-shrink-0 ${themeConfig.text.primary}`}>
              {t('imageService.storage.byFileType')}
            </h3>
            <div className="relative flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byFileType} cx="50%" cy="50%" innerRadius={55} outerRadius={80}
                    paddingAngle={3} dataKey="value" nameKey="name">
                    {byFileType.map((_: any, i: number) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieBytesTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, color: tickFill }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
                <span className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.storage.totalSize')}</span>
                <p className={`text-sm font-bold ${themeConfig.text.primary}`}>{formatBytes(summary?.totalBytes ?? 0)}</p>
              </div>
            </div>
            {byFileType.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {byFileType.map((item: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i] }} />
                      <span className={themeConfig.text.primary}>{item.name}</span>
                    </div>
                    <div className="flex gap-3">
                      <span className={themeConfig.text.secondary}>{formatBytes(item.value)}</span>
                      <span className={themeConfig.text.primary}>{item.files.toLocaleString()} files</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div key="growthTrend" className={`${themeConfig.card} rounded-lg overflow-hidden relative p-5 flex flex-col h-full`}>
            <DragHandle show={isEditing} />
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>
                {t('imageService.storage.growthTrend')}
              </h3>
              <div className="w-24">
                <SearchableSelect value={String(days)} onChange={v => setDays(parseInt(v))}
                  options={[7, 14, 30, 60, 90].map(d => ({ value: String(d), label: `${d} ${t('imageService.storage.days')}` }))} />
              </div>
            </div>
            <ResponsiveContainer width="100%" height="100%" className="flex-1 min-h-0">
              <AreaChart data={growthData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="label" tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="value" stroke="#06b6d4" strokeWidth={2}
                  fill="url(#growthGrad)" dot={false} name="MB" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div key="forecastChart" className={`${themeConfig.card} rounded-lg overflow-hidden relative p-5 flex flex-col h-full`}>
            <DragHandle show={isEditing} />
            <h3 className={`text-sm font-semibold mb-3 flex-shrink-0 ${themeConfig.text.primary}`}>
              {t('imageService.storage.forecast')}
            </h3>
            {forecast ? (
              <>
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex-1">
                    <div className="flex justify-between text-xs mb-1">
                      <span className={themeConfig.text.secondary}>{t('imageService.storage.usage')}</span>
                      <span className={themeConfig.text.primary}>{forecast.usagePercent.toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, forecast.usagePercent)}%`, backgroundColor: forecast.usagePercent > 85 ? '#ef4444' : forecast.usagePercent > 70 ? '#f59e0b' : '#06b6d4' }} />
                    </div>
                    <div className="flex justify-between text-xs mt-1">
                      <span className={themeConfig.text.secondary}>{formatBytes(forecast.totalBytes)}</span>
                      <span className={themeConfig.text.secondary}>{formatBytes(forecast.maxBytes)}</span>
                    </div>
                  </div>
                </div>

                <div className={`text-xs ${themeConfig.text.secondary} mb-3`}>
                  {t('imageService.storage.dailyGrowth')}: {formatBytes(forecast.dailyGrowthRate)}/day
                </div>

                <ResponsiveContainer width="100%" height="100%" className="flex-1 min-h-0">
                  <LineChart data={[
                    { label: t('imageService.storage.today'), value: forecast.usagePercent },
                    ...forecast.projections.map((p: any) => ({ label: `${p.days}d`, value: p.usagePercent })),
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="label" tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2}
                      dot={{ r: 4, fill: '#8b5cf6' }} name="Usage %" />
                  </LineChart>
                </ResponsiveContainer>
              </>
            ) : (
              <div className={`text-center py-8 ${themeConfig.text.secondary} text-sm`}>
                {t('imageService.storage.noData')}
              </div>
            )}
          </div>

          <div key="projectionTable" className={`${themeConfig.card} rounded-lg overflow-hidden relative p-5 flex flex-col h-full`}>
            <DragHandle show={isEditing} />
            <h3 className={`text-sm font-semibold mb-3 flex-shrink-0 ${themeConfig.text.primary}`}>
              {t('imageService.storage.projectionTable')}
            </h3>
            {forecast?.projections ? (
              <div className="space-y-2.5 flex-1 overflow-y-auto min-h-0">
                {forecast.projections.map((p: any) => {
                  const isFull = p.usagePercent >= 100;
                  return (
                    <div key={p.days} className={`rounded-lg p-3 ${isFull ? 'bg-red-500/10 border border-red-500/20' : 'bg-white/5'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm font-semibold ${themeConfig.text.primary}`}>
                          {t('imageService.storage.inDays', { days: p.days })}
                        </span>
                        <span className={`text-xs font-semibold ${isFull ? 'text-red-400' : themeConfig.text.secondary}`}>
                          {isFull ? t('imageService.storage.full') : `${p.usagePercent.toFixed(1)}%`}
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, p.usagePercent)}%`, backgroundColor: isFull ? '#ef4444' : '#8b5cf6' }} />
                      </div>
                      <div className={`text-xs mt-1 ${themeConfig.text.secondary}`}>
                        {formatBytes(p.projectedBytes)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={`text-center py-8 ${themeConfig.text.secondary} text-sm`}>
                {t('imageService.storage.noData')}
              </div>
            )}
          </div>

          <div key="byCamera" className={`${themeConfig.card} rounded-lg overflow-hidden relative p-5 flex flex-col h-full`}>
            <DragHandle show={isEditing} />
            <h3 className={`text-sm font-semibold mb-3 flex-shrink-0 ${themeConfig.text.primary}`}>
              {t('imageService.storage.byCamera')}
            </h3>
            {byCamera.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" className="flex-1 min-h-0">
                <BarChart data={byCamera} barCategoryGap="30%">
                  <CartesianGrid vertical={false} stroke={gridStroke} />
                  <XAxis dataKey="name" tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                  <Bar dataKey="value" name={t('imageService.overview.storageUsed', 'พื้นที่เก็บข้อมูล')} radius={[4, 4, 0, 0]}>
                    {byCamera.map((_: any, i: number) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className={`text-center py-8 ${themeConfig.text.secondary} text-sm`}>
                {t('imageService.storage.noData')}
              </div>
            )}
          </div>
        </ResponsiveGridLayout>
      </div>
    </div>
  );
}
