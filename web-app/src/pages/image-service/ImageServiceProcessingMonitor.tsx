import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { Responsive, WidthProvider } from 'react-grid-layout';
import { imageServiceApi } from '@/services/imageServiceApi';
import { formatDateTime } from '@/utils/dateUtils';
import ProcessingVisualizer from './ProcessingVisualizer';
import CountUpValue from '@/components/ui/CountUpValue';
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import {
  Activity, CheckCircle, XCircle, AlertTriangle, RotateCcw, RefreshCw,
  Play, Pause, Radio, GripVertical, Settings, Check, Star,
} from 'lucide-react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);
const LAYOUT_STORAGE_KEY = 'image_service_processing_layout_v10';

const DEFAULT_LAYOUTS: Record<string, any[]> = {
  lg: [
    { i: 'stats', x: 0, y: 0, w: 12, h: 1.5, minW: 6, minH: 1.5 },
    { i: 'visualizer', x: 0, y: 1.5, w: 12, h: 2, minW: 3, minH: 1.5 },
    { i: 'jobStatus', x: 0, y: 3.5, w: 4, h: 3, minW: 3, minH: 2.5 },
    { i: 'byType', x: 4, y: 3.5, w: 4, h: 3, minW: 3, minH: 2.5 },
    { i: 'recentJobs', x: 8, y: 3.5, w: 4, h: 5, minW: 3, minH: 3 },
  ],
  md: [
    { i: 'stats', x: 0, y: 0, w: 10, h: 1.5, minW: 6, minH: 1.5 },
    { i: 'visualizer', x: 0, y: 1.5, w: 10, h: 2, minW: 3, minH: 1.5 },
    { i: 'jobStatus', x: 0, y: 3.5, w: 5, h: 3, minW: 3, minH: 2.5 },
    { i: 'byType', x: 5, y: 3.5, w: 5, h: 3, minW: 3, minH: 2.5 },
    { i: 'recentJobs', x: 0, y: 6.5, w: 10, h: 5, minW: 3, minH: 3 },
  ],
  sm: [
    { i: 'stats', x: 0, y: 0, w: 6, h: 1.5, minW: 6, minH: 1.5 },
    { i: 'visualizer', x: 0, y: 1.5, w: 6, h: 2, minW: 3, minH: 1.5 },
    { i: 'jobStatus', x: 0, y: 3.5, w: 6, h: 3, minW: 3, minH: 2.5 },
    { i: 'byType', x: 0, y: 6.5, w: 6, h: 3, minW: 3, minH: 2.5 },
    { i: 'recentJobs', x: 0, y: 9.5, w: 6, h: 5, minW: 3, minH: 3 },
  ],
};

const PIE_COLORS = ['#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
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

const JOB_STATUS_STYLES: Record<string, string> = {
  completed: 'bg-green-500/20 text-green-400',
  running: 'bg-blue-500/20 text-blue-400',
  queued: 'bg-gray-500/20 text-gray-400',
  failed: 'bg-red-500/20 text-red-400',
  retrying: 'bg-yellow-500/20 text-yellow-400',
  dead_letter: 'bg-red-500/20 text-red-400',
};

const STATUS_LABEL_KEY: Record<string, string> = {
  queued: 'imageService.processingLogs.statusQueued',
  running: 'imageService.processingLogs.statusRunning',
  completed: 'imageService.processingLogs.statusCompleted',
  failed: 'imageService.processingLogs.statusFailed',
  retrying: 'imageService.processingLogs.statusRetrying',
  dead_letter: 'imageService.processingLogs.statusDeadLetter',
};

const TYPE_LABEL_KEY: Record<string, string> = {
  sync: 'imageService.processingLogs.typeSync',
  convert: 'imageService.processingLogs.typeConvert',
  thumbnail: 'imageService.processingLogs.typeThumbnail',
  checksum: 'imageService.processingLogs.typeChecksum',
  archive: 'imageService.processingLogs.typeArchive',
  delete: 'imageService.processingLogs.typeDelete',
};

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

export default function ImageServiceProcessingMonitor() {
  const { t, i18n } = useTranslation();
  const { themeConfig } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [layouts, setLayouts] = useState(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_LAYOUTS;
    } catch { return DEFAULT_LAYOUTS; }
  });

  const [logs, setLogs] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [vizStyle, setVizStyle] = useState(() => localStorage.getItem('processing_viz_style') ?? 'ring');

  const [realtimeQueueTotal, setRealtimeQueueTotal] = useState<number | null>(null);
  const [cumulativeMode, setCumulativeMode] = useState(false);
  const [streamStats, setStreamStats] = useState<any>(null);

  const { data: initialData } = useQuery({
    queryKey: ['processing-stats-initial'],
    queryFn: () => imageServiceApi.getOverview(),
    staleTime: 1000 * 10,
  });

  const { data: initialLogs } = useQuery({
    queryKey: ['processing-logs-initial'],
    queryFn: () => (imageServiceApi.getProcessingLogs as any)({ page: 1, limit: 20, sort: 'queuedAt', order: 'desc' }),
    staleTime: 1000 * 10,
  });

  useEffect(() => {
    if (initialLogs?.data && logs.length === 0) {
      setLogs(initialLogs.data);
    }
  }, [initialLogs]);
  const esRef = useRef<EventSource | null>(null);
  const reconnectDelay = useRef(1000);

  const handleLayoutChange = useCallback((_l: any, allLayouts: any) => {
    setLayouts(allLayouts);
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(allLayouts));
  }, []);

  const { data: systemConfig } = useQuery({
    queryKey: ['system-config'],
    queryFn: () => imageServiceApi.getSystemConfigs(),
    staleTime: Infinity,
  });

  const { data: queueHealth, refetch: refetchHealth } = useQuery({
    queryKey: ['queue-health'],
    queryFn: () => imageServiceApi.getQueueHealth(),
    refetchInterval: 30000,
    staleTime: 0,
  });

  const { data: queuePauseData, refetch: refetchQueuePause } = useQuery({
    queryKey: ['queue-pause-state'],
    queryFn: () => imageServiceApi.getQueuePause(),
    staleTime: 10000,
  });
  const isQueuePaused = queuePauseData?.paused ?? false;

  const handleTogglePause = async () => {
    try {
      const res = await imageServiceApi.toggleQueuePause(!isQueuePaused);
      toast.success(res.message || (isQueuePaused ? t('ui.imageServiceProcessingMonitor.queueResumed') : t('ui.imageServiceProcessingMonitor.queuePaused')));
      refetchQueuePause();
    } catch {
      toast.error(t('common.error'));
    }
  };

  const handlePurgeQueue = async () => {
    try {
      const res = await imageServiceApi.purgeActiveQueue();
      toast.success(res.message || t('ui.imageServiceProcessingMonitor.activeQueuePurged'));
      refetchHealth();
      setRealtimeQueueTotal(0);
    } catch {
      toast.error(t('common.error'));
    }
  };



  useEffect(() => {
    if (systemConfig?.dashboard_layout_processing?.value) {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (!saved) {
        const parsed = safeParseLayout(systemConfig.dashboard_layout_processing.value);
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

  const handleResetLayout = () => {
    setLayouts(DEFAULT_LAYOUTS);
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
  };

  const handleSaveDefaultLayout = async () => {
    try {
      await imageServiceApi.updateSystemConfigs({ dashboard_layout_processing: JSON.stringify(layouts) });
      toast.success(t('imageService.overview.defaultLayoutSaved'));
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
  };

  const connect = useCallback(() => {
    esRef.current?.close();
    const es = new EventSource('/image-service/api/v1/processing-logs/stream');
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      reconnectDelay.current = 1000; // Reset on successful connect
    };

    es.addEventListener('stats', (e) => {
      try {
        const data = JSON.parse(e.data);
        setStreamStats(data);
        if (data.queue) {
          const active = Number(data.queue.active ?? 0);
          const wait = Number(data.queue.wait ?? 0);
          setRealtimeQueueTotal(active + wait);
        }
      } catch { /* ignore parse errors */ }
    });

    es.addEventListener('logs', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (Array.isArray(data)) setLogs(data);
      } catch { /* ignore parse errors */ }
    });

    es.onerror = () => {
      setConnected(false);
      esRef.current?.close();
      // Exponential backoff reconnect
      setTimeout(() => {
        if (autoRefresh) {
          connect();
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
        }
      }, reconnectDelay.current);
    };
  }, [autoRefresh]);

  useEffect(() => {
    if (autoRefresh) connect();
    else { esRef.current?.close(); setConnected(false); }
    return () => esRef.current?.close();
  }, [autoRefresh, connect]);

  const statusCounts = ['completed', 'running', 'queued', 'failed', 'dead_letter'].map((s) => ({
    name: t(STATUS_LABEL_KEY[s] ?? s),
    value: cumulativeMode
      ? (initialData?.byStatus?.[s] ?? 0)
      : logs.filter((l) => l.status === s).length,
  }));

  const jobsByType = logs.reduce((acc: Record<string, number>, l: any) => {
    acc[l.jobType] = (acc[l.jobType] || 0) + 1;
    return acc;
  }, {});

  const jobTypeData = cumulativeMode
    ? (initialData?.byType || []).map((tItem: any) => ({
        name: t(TYPE_LABEL_KEY[tItem.jobType] ?? tItem.jobType),
        value: tItem.count,
      }))
    : Object.entries(jobsByType).map(([k, v]) => ({
        name: t(TYPE_LABEL_KEY[k] ?? k),
        value: v,
      }));

  const tickFill = themeConfig.name === 'light' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)';
  const gridStroke = themeConfig.name === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';

  const handleRetry = async (jobId: string) => {
    try {
      await imageServiceApi.retryJob(jobId);
      toast.success(t('imageService.processingLogs.retrySuccess'));
      queryClient.invalidateQueries({ queryKey: ['processing-logs'] });
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
  };

  const activeStats = streamStats || initialData;
  const bs = activeStats?.byStatus ?? initialData?.byStatus ?? {};
  const totalJobs = (activeStats?.total ?? Object.values(bs as Record<string, number>).reduce((a: number, b: number) => a + b, 0)) || logs.length;
  const completedJobs = (activeStats?.completed ?? (bs as any)?.completed) ?? logs.filter((l: any) => l.status === 'completed').length;
  const failedJobs = (activeStats?.failed ?? (((bs as any)?.failed ?? 0) + ((bs as any)?.dead_letter ?? 0))) || logs.filter((l: any) => l.status === 'failed' || l.status === 'dead_letter').length;
  const runningJobs = (activeStats?.running ?? (bs as any)?.running) ?? logs.filter((l: any) => l.status === 'running').length;
  const jobsToday = activeStats?.jobsToday ?? initialData?.jobsToday ?? 0;
  const imagesToday = activeStats?.imagesToday ?? initialData?.imagesToday ?? 0;

  const queueActiveCount = queueHealth?.active ?? 0;
  const queueWaitingCount = queueHealth?.waiting ?? 0;
  const initialQueueTotal = queueActiveCount + queueWaitingCount;
  const currentQueueTotal = realtimeQueueTotal !== null ? realtimeQueueTotal : initialQueueTotal;
  const isVisualizerActive = currentQueueTotal > 0;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
            iSmart CCTV · {t('imageService.processing.title')}
          </p>
          <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.processing.title')}</h1>
          <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.processing.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <button
                onClick={handleTogglePause}
                title={isQueuePaused ? t('ui.imageServiceProcessingMonitor.clickToResumeTheQueue') : t('ui.imageServiceProcessingMonitor.clickToPauseTheQueue')}
                className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  isQueuePaused
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                }`}
              >
                {isQueuePaused ? <Play size={14} /> : <Pause size={14} />}
                {isQueuePaused ? t('ui.imageServiceProcessingMonitor.resumeQueue') : t('ui.imageServiceProcessingMonitor.pauseQueue')}
              </button>

              <button
                onClick={handlePurgeQueue}
                title={t('ui.imageServiceProcessingMonitor.clearStaleJobLocksInThe')}
                className="px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30 transition-all"
              >
                <RotateCcw size={14} />
                {t('ui.imageServiceProcessingMonitor.purgeActiveQueue')}
              </button>
            </>
          )}

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
        </div>
      </div>

      {isEditing && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-xs ${themeConfig.card}`}>
          {t('imageService.overview.dragHint')}
        </div>
      )}



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
            {[
              {
                id: 'stats-today',
                label: t('imageService.processing.jobsTodayFull', 'งานประมวลผลวันนี้'),
                value: jobsToday,
                sub: t('imageService.processing.jobsTodayFrom', '(จาก {{count}} ภาพ)', { count: imagesToday }),
                hint: t('imageService.processing.jobsTodayHint', 'นับจำนวนครั้งของการประมวลผล รวมการลองใหม่ — 1 ภาพอาจมีหลายงาน จึงต่างจาก "ภาพวันนี้" ในหน้าภาพรวมได้'),
                color: '#a855f7', icon: Activity,
              },
              { id: 'stats-total', label: t('imageService.processing.totalJobs'), value: totalJobs, color: '#06b6d4', icon: Activity },
              { id: 'stats-completed', label: t('imageService.processing.completed'), value: completedJobs, color: '#10b981', icon: CheckCircle },
              { id: 'stats-failed', label: t('imageService.processing.failed'), value: failedJobs, color: '#ef4444', icon: XCircle },
              { id: 'stats-running', label: t('imageService.processing.inProgress'), value: runningJobs, color: '#f59e0b', icon: AlertTriangle },
            ].map((s: any, i) => {
              const Icon = s.icon;
              return (
                <div key={i} className="flex flex-col justify-center" title={s.hint}>
                  <div className="flex items-center gap-2 mb-1">
                    <Icon size={16} style={{ color: s.color }} />
                    <span className={`text-xs ${themeConfig.text.secondary}`}>{s.label}</span>
                  </div>
                  <span className="text-2xl font-bold" style={{ color: s.color }}>
                    <span id={s.id}><CountUpValue value={s.value} /></span>
                    {s.id === 'stats-today' ? (
                      <span className={`ml-1.5 text-[11px] font-normal ${themeConfig.text.secondary}`}>
                        {t('ui.imageServiceProcessingMonitor.of')}{' '}<CountUpValue value={imagesToday} />{' '}{t('ui.imageServiceProcessingMonitor.images')}
                      </span>
                    ) : (
                      s.sub && <span className={`ml-1.5 text-[11px] font-normal ${themeConfig.text.secondary}`}>{s.sub}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div key="visualizer" className={`${themeConfig.card} rounded-lg overflow-hidden relative p-5 flex flex-col h-full`}>
          <DragHandle show={isEditing} />
          <h3 className={`text-sm font-semibold mb-3 flex-shrink-0 ${themeConfig.text.primary}`}>
            {t('imageService.processing.visualizer')}
          </h3>
          <div className="flex-1 min-h-0">
            <ProcessingVisualizer
              active={isVisualizerActive}
              style={vizStyle}
              onStyleChange={(s) => { setVizStyle(s); localStorage.setItem('processing_viz_style', s); }}
            />
          </div>
        </div>

        <div key="jobStatus" className={`${themeConfig.card} rounded-lg overflow-hidden relative p-5 flex flex-col h-full`}>
          <DragHandle show={isEditing} />
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.processing.jobStatus')}</h3>
            <button
              onClick={() => setCumulativeMode(!cumulativeMode)}
              className="text-[10px] px-2 py-0.5 rounded border border-cyan-500/20 bg-cyan-500/5 hover:bg-cyan-500/15 transition-all text-cyan-400 font-medium"
            >
              {cumulativeMode ? t('imageService.processing.modeCumulative', 'Cumulative') : t('imageService.processing.modeRealtime', 'Real-time (20)')}
            </button>
          </div>
          <div className="relative flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusCounts} cx="50%" cy="50%" innerRadius={55} outerRadius={80}
                  paddingAngle={3} dataKey="value" nameKey="name"
                  label={({ name, value }) => `${name} ${value}`}>
                  {statusCounts.map((_: any, i: number) => (
                    <Cell key={i} fill={PIE_COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className={`text-2xl font-bold ${themeConfig.text.primary}`}>{cumulativeMode ? totalJobs : logs.length}</span>
              <span className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.processing.totalJobs').toLowerCase()}</span>
            </div>
          </div>
        </div>

        <div key="byType" className={`${themeConfig.card} rounded-lg overflow-hidden relative p-5 flex flex-col h-full`}>
          <DragHandle show={isEditing} />
          <h3 className={`text-sm font-semibold mb-3 flex-shrink-0 ${themeConfig.text.primary}`}>{t('imageService.processing.byType')}</h3>
          <ResponsiveContainer width="100%" height="100%" className="flex-1 min-h-0">
            <BarChart data={jobTypeData} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke={gridStroke} />
              <XAxis dataKey="name" tick={{ fill: tickFill, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: tickFill, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
              <Bar dataKey="value" name={t('imageService.processing.totalJobs', 'งานทั้งหมด')} radius={[4, 4, 0, 0]}>
                {jobTypeData.map((_: any, i: number) => (
                  <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                ))}
                <LabelList dataKey="value" position="top" style={{ fill: tickFill, fontSize: 10 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div key="recentJobs" className={`${themeConfig.card} rounded-lg overflow-hidden relative p-5 flex flex-col h-full`}>
          <DragHandle show={isEditing} />
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.processing.recentJobs')}</h3>
            <div className="flex items-center gap-2">
              <span className={`flex items-center gap-1 text-xs ${connected ? 'text-green-400' : 'text-red-400'}`}>
                <Radio size={10} className={connected ? 'animate-pulse' : ''} />
                {connected ? t('ui.imageServiceProcessingMonitor.live') : t('ui.imageServiceProcessingMonitor.disconnected')}
              </span>
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`p-2 rounded-lg text-xs flex items-center gap-1 transition-colors
                  ${autoRefresh ? 'text-cyan-400 bg-cyan-500/10' : `${themeConfig.text.secondary} hover:bg-white/5`}`}
              >
                {autoRefresh ? <Pause size={13} /> : <Play size={13} />}
                {t('ui.imageServiceProcessingMonitor.auto')}
              </button>
              <button
                onClick={() => { esRef.current?.close(); connect(); }}
                className="p-2 rounded-lg hover:bg-white/5 transition-colors"
              >
                <RefreshCw size={14} className={themeConfig.text.secondary} />
              </button>
            </div>
          </div>

          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full">
              <thead className={themeConfig.tableHeader}>
                <tr>
                  <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.processingLogs.imageId')}</th>
                  <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.processingLogs.jobType')}</th>
                  <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.processingLogs.status')}</th>
                  <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.processingLogs.duration')}</th>
                  <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.processingLogs.queuedAt')}</th>
                  <th className={`px-4 py-3 text-center text-sm font-semibold ${themeConfig.text.primary}`}>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${themeConfig.tableDivide}`}>
                {logs.slice(0, 20).map((log: any) => (
                  <tr key={log.id} className={`border-b ${themeConfig.tableBorder} ${themeConfig.tableRow}`}>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.primary}`}>
                      <span className="font-mono text-xs">{log.imageId?.slice(0, 8) ?? '—'}...</span>
                    </td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.primary}`}>
                      <span className="px-2 py-0.5 rounded text-xs bg-cyan-500/10 text-cyan-400">{t(TYPE_LABEL_KEY[log.jobType] ?? log.jobType)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${JOB_STATUS_STYLES[log.status] ?? ''}`}>
                        {t(STATUS_LABEL_KEY[log.status] ?? log.status)}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>
                      {log.durationMs != null ? `${(log.durationMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>
                      {formatDateTime(log.queuedAt, i18n.language)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {(log.status === 'failed' || log.status === 'dead_letter') && (
                          <button onClick={() => handleRetry(log.id)}
                            className="p-2 rounded-lg hover:bg-green-500/20" title={t('imageService.processingLogs.retry')}>
                            <RotateCcw size={14} className="text-green-500" />
                          </button>
                        )}
                        {log.errorMessage && (
                          <span className="group relative">
                            <button className="p-2 rounded-lg hover:bg-yellow-500/20">
                              <AlertTriangle size={14} className="text-yellow-500" />
                            </button>
                            <span className="absolute bottom-full right-0 mb-1 px-2 py-1 rounded-lg bg-slate-800 text-xs text-gray-200 opacity-0 group-hover:opacity-100 whitespace-nowrap z-10 pointer-events-none transition-opacity">
                              {log.errorMessage}
                            </span>
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={6} className={`px-4 py-8 text-center text-sm ${themeConfig.text.secondary}`}>
                      {t('imageService.processingLogs.noLogs')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </ResponsiveGridLayout>
    </div>
  );
}
