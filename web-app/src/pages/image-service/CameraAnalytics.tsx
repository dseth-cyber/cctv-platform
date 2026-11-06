import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/contexts/ThemeContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Responsive, WidthProvider } from 'react-grid-layout'
import { imageServiceApi } from '@/services/imageServiceApi'
import { TableSkeleton, ExportButton, SearchableSelect, CountUpValue } from '@/components/ui'
import {
  Activity, Shield, Clock, Heart, Camera, TrendingDown, Image,
  AlertTriangle, CheckCircle, XCircle, ChevronDown, ChevronLeft, ChevronRight,
  GripVertical, Settings, RotateCcw, Check, Star,
} from 'lucide-react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

const ResponsiveGridLayout = WidthProvider(Responsive)
const LAYOUT_STORAGE_KEY = 'analytics-layout-v2'

const DEFAULT_LAYOUTS: Record<string, any[]> = {
  lg: [
    { i: 'availability', x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 1.5 },
    { i: 'mtbf', x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 1.5 },
    { i: 'mttr', x: 6, y: 0, w: 3, h: 2, minW: 2, minH: 1.5 },
    { i: 'healthScore', x: 9, y: 0, w: 3, h: 2, minW: 2, minH: 1.5 },
    { i: 'timeBreakdown', x: 0, y: 2, w: 4, h: 3, minW: 3, minH: 2.5 },
    { i: 'offlineEvents', x: 8, y: 2, w: 4, h: 3, minW: 3, minH: 2.5 },
    { i: 'timeline', x: 0, y: 5, w: 12, h: 2, minW: 6, minH: 1.5 },
    { i: 'eventHistory', x: 0, y: 7, w: 12, h: 3, minW: 6, minH: 2.5 },
    { i: 'comparison', x: 0, y: 10, w: 12, h: 4, minW: 6, minH: 3 },
  ],
  md: [
    { i: 'availability', x: 0, y: 0, w: 5, h: 2, minW: 2, minH: 1.5 },
    { i: 'mtbf', x: 5, y: 0, w: 5, h: 2, minW: 2, minH: 1.5 },
    { i: 'mttr', x: 0, y: 2, w: 5, h: 2, minW: 2, minH: 1.5 },
    { i: 'healthScore', x: 5, y: 2, w: 5, h: 2, minW: 2, minH: 1.5 },
    { i: 'timeBreakdown', x: 0, y: 4, w: 4, h: 3, minW: 3, minH: 2.5 },
    { i: 'offlineEvents', x: 7, y: 4, w: 3, h: 3, minW: 3, minH: 2.5 },
    { i: 'timeline', x: 0, y: 7, w: 10, h: 2, minW: 6, minH: 1.5 },
    { i: 'eventHistory', x: 0, y: 9, w: 10, h: 3, minW: 6, minH: 2.5 },
    { i: 'comparison', x: 0, y: 12, w: 10, h: 4, minW: 6, minH: 3 },
  ],
  sm: [
    { i: 'availability', x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 1.5 },
    { i: 'mtbf', x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 1.5 },
    { i: 'mttr', x: 0, y: 2, w: 3, h: 2, minW: 2, minH: 1.5 },
    { i: 'healthScore', x: 3, y: 2, w: 3, h: 2, minW: 2, minH: 1.5 },
    { i: 'timeBreakdown', x: 0, y: 4, w: 6, h: 3, minW: 3, minH: 2.5 },
    { i: 'offlineEvents', x: 0, y: 10, w: 6, h: 3, minW: 3, minH: 2.5 },
    { i: 'timeline', x: 0, y: 13, w: 6, h: 2, minW: 4, minH: 1.5 },
    { i: 'eventHistory', x: 0, y: 15, w: 6, h: 3, minW: 4, minH: 2.5 },
    { i: 'comparison', x: 0, y: 18, w: 6, h: 4, minW: 4, minH: 3 },
  ],
}

const PERIODS = ['7d', '14d', '30d', '60d', '90d'] as const

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`
  return `${(seconds / 86400).toFixed(1)}d`
}

function formatDurationLong(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  return parts.join(' ') || '0m'
}

function HealthBadge({ grade, score }: { grade: string; score: number }) {
  const colorMap: Record<string, string> = {
    excellent: 'bg-green-500/20 text-green-400 border-green-500/30',
    good: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    warning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${colorMap[grade] || colorMap.good}`}>
      {score}
    </span>
  )
}

function timeAgo(iso?: string | null): { text: string; staleMin: number } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  const staleMin = secs / 60;
  let text: string;
  if (secs < 60) text = `${secs}s`;
  else if (secs < 3600) text = `${Math.floor(secs / 60)}m`;
  else if (secs < 86400) text = `${(secs / 3600).toFixed(1)}h`;
  else text = `${(secs / 86400).toFixed(1)}d`;
  return { text, staleMin };
}

function StatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    active: 'bg-green-400',
    online: 'bg-green-400',
    maintenance: 'bg-yellow-400',
    offline: 'bg-red-400',
    error: 'bg-red-400',
    inactive: 'bg-gray-400',
  }
  return <span className={`inline-block w-2 h-2 rounded-full ${colorMap[status] || 'bg-gray-400'}`} />
}

function DragHandle({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div className="drag-handle absolute top-2 right-2 cursor-grab active:cursor-grabbing opacity-40 hover:opacity-90 transition-opacity z-10 p-1 rounded-md bg-black/40 backdrop-blur-sm">
      <GripVertical size={13} className="text-white" />
    </div>
  )
}

const safeParseLayout = (value: any) => {
  if (!value || value === '[object Object]') return null
  if (typeof value === 'object') return value
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object') return parsed
  } catch { /* ignore */ }
  return null
}

export default function CameraAnalytics() {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()
  const { user } = useAuth()
  const toast = useToast()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const [period, setPeriod] = useState<string>('7d')
  const [selectedCameraId, setSelectedCameraId] = useState<string>('')
  const [isEditing, setIsEditing] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const [hoverSeg, setHoverSeg] = useState<{ seg: any; widthPct: number; x: number; y: number } | null>(null)

  const [layouts, setLayouts] = useState(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY)
      const parsed = safeParseLayout(saved)
      return parsed && typeof parsed === 'object' && Array.isArray(parsed.lg) ? parsed : DEFAULT_LAYOUTS
    } catch { return DEFAULT_LAYOUTS }
  })

  const safeLayouts = useMemo(() => {
    if (layouts && typeof layouts === 'object' && Array.isArray(layouts.lg)) {
      return layouts
    }
    return DEFAULT_LAYOUTS
  }, [layouts])

  const { data: systemConfig } = useQuery({
    queryKey: ['system-config'],
    // A role without settings access just keeps the built-in layout.
    queryFn: () => imageServiceApi.getSystemConfigs({ silent403: true }),
    retry: false,
    staleTime: Infinity,
  })

  useEffect(() => {
    if (systemConfig?.dashboard_layout_analytics?.value) {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY)
      if (!saved) {
        const parsed = safeParseLayout(systemConfig.dashboard_layout_analytics.value)
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.lg)) {
          setLayouts(parsed)
        }
      }
    }
  }, [systemConfig])

  // Dispatch a window resize event shortly after mount to resolve grid layout squishing issues
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'))
    }, 200)
    return () => clearTimeout(timer)
  }, [])

  const handleLayoutChange = useCallback((_l: any, allLayouts: any) => {
    setLayouts(allLayouts)
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(allLayouts))
  }, [])

  const handleResetLayout = () => {
    setLayouts(DEFAULT_LAYOUTS)
    localStorage.removeItem(LAYOUT_STORAGE_KEY)
  }

  const handleSaveDefaultLayout = async () => {
    try {
      await imageServiceApi.updateSystemConfigs({ dashboard_layout_analytics: JSON.stringify(layouts) })
      toast.success(t('imageService.overview.defaultLayoutSaved'))
    } catch {
      toast.error(t('common.error'))
    }
  }

  // Fetch cameras list
  const { data: cameras = [] } = useQuery({
    queryKey: ['cameras-analytics-list'],
    queryFn: () => imageServiceApi.getCameras(),
    staleTime: 20000,
    // Keep the realtime status card fresh (health monitor updates ~1/min).
    refetchInterval: 20000,
  })

  // Auto-select first camera
  const effectiveCameraId = selectedCameraId || (cameras.length > 0 ? cameras[0].id : '')

  // Fetch single camera analytics
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['camera-analytics', effectiveCameraId, period],
    queryFn: () => imageServiceApi.getCameraAnalytics(effectiveCameraId, period),
    enabled: !!effectiveCameraId,
    staleTime: 30000,
  })

  // Fetch comparison data
  const { data: comparison = [], isLoading: comparisonLoading } = useQuery({
    queryKey: ['camera-comparison', period],
    queryFn: () => imageServiceApi.getCameraComparison(period),
    staleTime: 30000,
  })

  const selectedCamera = cameras.find((c: any) => c.id === effectiveCameraId)
  const selectedCameraName = selectedCamera?.name || ''

  // Pie chart data for uptime/downtime/maintenance
  const pieData = useMemo(() => {
    if (!analytics) return []
    const uptimePct = analytics.uptime?.percent ?? 0
    const downtimePct = analytics.downtime?.percent ?? 0
    const maintenancePct = analytics.maintenance?.percent ?? 0
    return [
      { name: t('imageService.analytics.uptime'), value: uptimePct, color: '#10B880' },
      { name: t('imageService.analytics.downtime'), value: downtimePct, color: '#ef4444' },
      { name: t('imageService.analytics.maintenance'), value: maintenancePct, color: '#f59e0b' },
    ].filter((d) => d.value > 0)
  }, [analytics, t])

  // Bar chart data for comparison
  const comparisonBarData = useMemo(() => {
    if (!comparison || comparison.length === 0) return []
    return comparison.map((c: any) => ({
      name: c.cameraName.length > 12 ? c.cameraName.slice(0, 12) + '...' : c.cameraName,
      availability: c.availability,
      healthScore: c.healthScore,
      slaTarget: c.slaTarget,
    }))
  }, [comparison])

  // Export data for event history
  const eventExportData = useMemo(() => {
    if (!analytics?.events) return []
    return [...analytics.events].reverse().map((event: any, idx: number) => {
      const reversedIdx = analytics.events.length - 1 - idx
      const nextEvent = reversedIdx < analytics.events.length - 1 ? analytics.events[reversedIdx + 1] : null
      const durationMs = nextEvent
        ? new Date(nextEvent.createdAt).getTime() - new Date(event.createdAt).getTime()
        : Date.now() - new Date(event.createdAt).getTime()
      return {
        no: analytics.events.length - idx,
        date: new Date(event.createdAt).toLocaleString(),
        eventType: event.eventType,
        reason: event.downtimeReason || '-',
        changedBy: (event.metadata as any)?.changedBy || 'system',
        duration: formatDuration(Math.round(durationMs / 1000)),
      }
    })
  }, [analytics])

  const eventExportColumns = [
    { key: 'no', label: '#' },
    { key: 'date', label: t('imageService.analytics.duration') },
    { key: 'eventType', label: t('ui.cameraAnalytics.event') },
    { key: 'reason', label: t('imageService.analytics.reason') },
    { key: 'changedBy', label: t('imageService.analytics.changedBy') },
    { key: 'duration', label: t('imageService.analytics.duration') },
  ]

  if (cameras.length === 0 && !analyticsLoading) {
    return (
      <div className="p-6">
        <h2 className={`text-xl font-bold ${themeConfig.text.primary}`}>{t('imageService.analytics.title')}</h2>
        <p className={`mt-2 ${themeConfig.text.secondary}`}>{t('imageService.analytics.noData')}</p>
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
        <div>
          <p className={`text-xs font-medium mb-0.5 uppercase tracking-widest ${themeConfig.text.secondary}`}>
            iSmart CCTV · {t('imageService.analytics.title')}
          </p>
          <h2 className={`text-2xl font-bold ${themeConfig.text.primary}`}>
            {t('imageService.analytics.title')}
          </h2>
          <p className={`text-sm ${themeConfig.text.secondary}`}>
            {t('imageService.analytics.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Camera selector with search + prev/next */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                const idx = cameras.findIndex((c: any) => c.id === effectiveCameraId)
                if (idx > 0) setSelectedCameraId(cameras[idx - 1].id)
              }}
              disabled={cameras.findIndex((c: any) => c.id === effectiveCameraId) <= 0}
              className={`p-2 rounded-lg border ${themeConfig.cardBorder} ${themeConfig.text.secondary} hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors`}
              title={t('common.previous')}
            >
              <ChevronLeft size={14} />
            </button>
            <div className="w-52">
              <SearchableSelect
                value={effectiveCameraId}
                onChange={(v) => setSelectedCameraId(v)}
                placeholder={t('imageService.analytics.selectCamera')}
                options={cameras.map((cam: any) => ({ value: cam.id, label: cam.name }))}
              />
            </div>
            <button
              onClick={() => {
                const idx = cameras.findIndex((c: any) => c.id === effectiveCameraId)
                if (idx < cameras.length - 1) setSelectedCameraId(cameras[idx + 1].id)
              }}
              disabled={cameras.findIndex((c: any) => c.id === effectiveCameraId) >= cameras.length - 1}
              className={`p-2 rounded-lg border ${themeConfig.cardBorder} ${themeConfig.text.secondary} hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors`}
              title={t('common.next')}
            >
              <ChevronRight size={14} />
            </button>
            <span className={`text-xs ${themeConfig.text.secondary}`}>
              {cameras.findIndex((c: any) => c.id === effectiveCameraId) + 1}/{cameras.length}
            </span>
          </div>

          {/* Period tabs */}
          <div className={`flex rounded-lg overflow-hidden border ${themeConfig.cardBorder}`}>
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  period === p
                    ? 'bg-cyan-500/20 text-cyan-300'
                    : `${themeConfig.text.secondary} hover:bg-white/5`
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Layout buttons */}
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
            filename={`camera-analytics-${selectedCameraName}-${period}`}
            title={`${t('imageService.analytics.title')} — ${selectedCameraName}`}
            sections={[
              { title: t('imageService.analytics.title'), columns: [
                { key: 'metric', label: t('ui.cameraAnalytics.metric') }, { key: 'value', label: t('ui.cameraAnalytics.value') },
              ], data: analytics ? [
                { metric: t('imageService.analytics.availability'), value: `${analytics.availability}%` },
                { metric: t('imageService.analytics.slaTarget'), value: `${analytics.slaTarget}% — ${analytics.slaMet ? '✅' : '❌'}` },
                { metric: 'MTBF', value: analytics.mtbf != null ? `${analytics.mtbf.toFixed(1)} ${t('imageService.analytics.hours')}` : '-' },
                { metric: 'MTTR', value: analytics.mttr != null ? `${analytics.mttr.toFixed(1)} ${t('imageService.analytics.minutes')}` : '-' },
                { metric: t('imageService.analytics.healthScore'), value: `${analytics.healthScore} (${t(`imageService.analytics.${analytics.healthGrade}`)})` },
                { metric: t('imageService.analytics.offlineEvents'), value: String(analytics.offlineCount) },
              ] : [] },
              ...(analytics ? [{ title: `${t('imageService.analytics.uptime')} / ${t('imageService.analytics.downtime')}`, columns: [
                { key: 'metric', label: t('ui.cameraAnalytics.metric') }, { key: 'seconds', label: t('imageService.analytics.duration') }, { key: 'pct', label: '%' },
              ], data: [
                { metric: t('imageService.analytics.uptime'), seconds: `${Math.round(analytics.uptime.seconds / 3600)} ${t('imageService.analytics.hours')}`, pct: `${analytics.uptime.percent}%` },
                { metric: t('imageService.analytics.downtime'), seconds: `${Math.round(analytics.downtime.seconds / 3600)} ${t('imageService.analytics.hours')}`, pct: `${analytics.downtime.percent}%` },
                { metric: t('imageService.analytics.maintenance'), seconds: `${Math.round(analytics.maintenance.seconds / 3600)} ${t('imageService.analytics.hours')}`, pct: `${analytics.maintenance.percent}%` },
              ] }] : []),
              { title: t('imageService.analytics.eventHistory'), columns: eventExportColumns, data: eventExportData },
              ...(comparison.length > 0 ? [{ title: t('imageService.analytics.comparison'), columns: [
                { key: 'name', label: t('imageService.cameras.cameraName') },
                { key: 'availability', label: t('imageService.analytics.availability') },
                { key: 'mtbf', label: 'MTBF' },
                { key: 'mttr', label: 'MTTR' },
                { key: 'healthScore', label: t('imageService.analytics.healthScore') },
                { key: 'offlineCount', label: t('imageService.analytics.offlineEvents') },
              ], data: comparison.map((c: any) => ({
                name: c.cameraName, availability: `${c.availability}%`,
                mtbf: c.mtbf != null ? `${c.mtbf.toFixed(1)}h` : '-',
                mttr: c.mttr != null ? `${c.mttr.toFixed(1)}m` : '-',
                healthScore: `${c.healthScore} (${c.healthGrade})`,
                offlineCount: c.offlineCount,
              })) }] : []),
            ]}
          />
        </div>
      </div>

      {isEditing && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-xs ${themeConfig.card}`}>
          {t('imageService.overview.dragHint')}
        </div>
      )}

      {/* P52 — realtime status of the selected camera (health monitor, ~1/min) */}
      {selectedCamera && (() => {
        const op = selectedCamera.operationalStatus ?? 'unknown';
        const opTone: Record<string, string> = {
          online: 'text-green-400 border-green-500/30 bg-green-500/5',
          offline: 'text-red-400 border-red-500/30 bg-red-500/5',
          recovering: 'text-amber-400 border-amber-500/30 bg-amber-500/5',
          unknown: 'text-gray-400 border-white/10 bg-white/5',
        };
        const lastPoll = timeAgo(selectedCamera.lastPolledAt);
        const opLabel = String(t(`imageService.cameras.operational.${op}`, op));
        return (
          <div className={`mb-4 rounded-xl border p-4 ${opTone[op] ?? opTone.unknown}`}>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-2">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${op === 'online' ? 'bg-green-400' : op === 'offline' ? 'bg-red-400' : op === 'recovering' ? 'bg-amber-400' : 'bg-gray-400'} ${op === 'online' || op === 'recovering' ? 'animate-pulse' : ''}`} />
                <div>
                  <p className="text-[10px] uppercase tracking-wider opacity-70">{t('imageService.analytics.currentStatus', 'สถานะตอนนี้ (เรียลไทม์)')}</p>
                  <p className="text-lg font-bold leading-tight">{opLabel}</p>
                </div>
              </div>
              <div className="h-8 w-px bg-current opacity-10" />
              <div>
                <p className={`text-[10px] uppercase tracking-wider ${themeConfig.text.secondary}`}>{t('imageService.cameras.status', 'สถานะตั้งค่า')}</p>
                <p className={`text-sm font-semibold flex items-center gap-1.5 ${themeConfig.text.primary}`}>
                  <StatusDot status={selectedCamera.status} />{String(t(`imageService.cameras.${selectedCamera.status}`, selectedCamera.status))}
                </p>
              </div>
              <div>
                <p className={`text-[10px] uppercase tracking-wider ${themeConfig.text.secondary}`}>{t('imageService.analytics.lastPolled', 'ตรวจล่าสุด')}</p>
                <p className={`text-sm font-semibold ${themeConfig.text.primary}`}>
                  {lastPoll ? t('imageService.analytics.ago', '{{t}} ที่แล้ว', { t: lastPoll.text }) : '—'}
                </p>
              </div>
              {op === 'offline' && (
                <div className="flex items-center gap-1.5 text-red-400 text-xs font-medium">
                  <AlertTriangle size={14} />
                  {t('imageService.analytics.offlineWarn', 'ระบบติดต่อกล้องไม่ได้ — ข้อมูลอาจไม่อัปเดต')}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {(() => {
        const slaMet = analytics?.slaMet ?? true;
        const slaTarget = analytics?.slaTarget ?? 99.5;
        const hasCustomSla = analytics?.hasCustomSla ?? false;
        const maintenanceSeconds = analytics?.maintenance?.seconds ?? 0;
        const uptimeSeconds = analytics?.uptime?.seconds ?? 0;
        const downtimeSeconds = analytics?.downtime?.seconds ?? 0;
        const mtbf = analytics?.mtbf ?? null;
        const mttr = analytics?.mttr ?? null;
        const healthScore = analytics?.healthScore ?? 100;
        const healthGrade = analytics?.healthGrade ?? 'good';
        const offlineCount = analytics?.offlineCount ?? 0;
        const timeline = analytics?.timeline ?? [];
        const events = analytics?.events ?? [];

        return (
          <div ref={contentRef}>
            <ResponsiveGridLayout
              className="layout"
              layouts={safeLayouts}
              breakpoints={{ lg: 900, md: 700, sm: 480 }}
              cols={{ lg: 12, md: 10, sm: 6 }}
              rowHeight={100}
              isDraggable={isEditing}
              isResizable={isEditing}
              draggableHandle=".drag-handle"
              onLayoutChange={handleLayoutChange}
              compactType="vertical"
            >
              {/* Availability */}
              <div key="availability" className={`${themeConfig.card} rounded-xl p-4 relative overflow-hidden`}>
                <DragHandle show={isEditing} />
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-2 rounded-lg bg-green-500/10">
                    <Shield size={16} className="text-green-400" />
                  </div>
                  <span className={`text-sm font-medium ${themeConfig.text.secondary}`}>
                    {t('imageService.analytics.availability')}
                  </span>
                </div>
                <div className={`text-3xl font-bold ${themeConfig.text.primary}`}>
                  <CountUpValue value={analytics?.availability} isLoading={analyticsLoading} suffix="%" />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {slaMet ? (
                    <span className="flex items-center gap-1 text-xs text-green-400">
                      <CheckCircle size={12} /> {t('imageService.analytics.slaMet')}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-red-400">
                      <XCircle size={12} /> {t('imageService.analytics.slaNotMet')}
                    </span>
                  )}
                  <span className={`text-xs ${themeConfig.text.secondary}`}>
                    ({t('imageService.analytics.slaTarget')}: {slaTarget}%)
                  </span>
                  {hasCustomSla && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-cyan-500/10 text-cyan-400">
                      {t('imageService.analytics.customSla', 'Custom SLA')}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5 italic">
                  {t('imageService.analytics.availabilityTip', 'ยิ่งสูงยิ่งดี (ค่าแนะนำ >= 99.5%)')}
                </p>
                {maintenanceSeconds > 0 && (
                  <p className="text-[10px] text-amber-400 mt-0.5 italic">
                    {t('imageService.analytics.maintenanceExcludedNote', 'ไม่รวมช่วงซ่อมบำรุงตามแผนในการคำนวณ SLA')}
                  </p>
                )}
              </div>

            {/* MTBF */}
            <div key="mtbf" className={`${themeConfig.card} rounded-xl p-4 relative overflow-hidden`}>
              <DragHandle show={isEditing} />
              <div className="flex items-center gap-2 mb-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Clock size={16} className="text-blue-400" />
                </div>
                <span className={`text-sm font-medium ${themeConfig.text.secondary}`}>
                  {t('imageService.analytics.mtbf')}
                </span>
              </div>
              <div className={`text-3xl font-bold ${themeConfig.text.primary}`}>
                {mtbf !== null ? `${mtbf.toFixed(1)}h` : '--'}
              </div>
              <p className={`text-xs mt-2 ${themeConfig.text.secondary}`}>
                {mtbf !== null ? t('imageService.analytics.mtbfDesc') : t('imageService.analytics.noFailures')}
              </p>
              <p className="text-[10px] text-gray-400 mt-1.5 italic">
                {t('imageService.analytics.mtbfTip', 'ระยะเวลาทำงานเฉลี่ยก่อนเสีย (ยิ่งสูงยิ่งดี)')}
              </p>
            </div>

            {/* MTTR */}
            <div key="mttr" className={`${themeConfig.card} rounded-xl p-4 relative overflow-hidden`}>
              <DragHandle show={isEditing} />
              <div className="flex items-center gap-2 mb-3">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <Activity size={16} className="text-orange-400" />
                </div>
                <span className={`text-sm font-medium ${themeConfig.text.secondary}`}>
                  {t('imageService.analytics.mttr')}
                </span>
              </div>
              <div className={`text-3xl font-bold ${themeConfig.text.primary}`}>
                {mttr !== null ? `${mttr.toFixed(1)}m` : '--'}
              </div>
              <p className={`text-xs mt-2 ${themeConfig.text.secondary}`}>
                {mttr !== null ? t('imageService.analytics.mttrDesc') : t('imageService.analytics.noRepairs')}
              </p>
              <p className="text-[10px] text-gray-400 mt-1.5 italic">
                {t('imageService.analytics.mttrTip', 'ระยะเวลาเฉลี่ยซ่อมบำรุง/กู้คืน (ยิ่งต่ำยิ่งดี)')}
              </p>
            </div>

            {/* Health Score */}
            <div key="healthScore" className={`${themeConfig.card} rounded-xl p-4 relative overflow-hidden`}>
              <DragHandle show={isEditing} />
              <div className="flex items-center gap-2 mb-3">
                <div className={`p-2 rounded-lg ${
                  healthGrade === 'excellent' ? 'bg-green-500/10' :
                  healthGrade === 'good' ? 'bg-blue-500/10' :
                  healthGrade === 'warning' ? 'bg-yellow-500/10' : 'bg-red-500/10'
                }`}>
                  <Heart size={16} className={
                    healthGrade === 'excellent' ? 'text-green-400' :
                    healthGrade === 'good' ? 'text-blue-400' :
                    healthGrade === 'warning' ? 'text-yellow-400' : 'text-red-400'
                  } />
                </div>
                <span className={`text-sm font-medium ${themeConfig.text.secondary}`}>
                  {t('imageService.analytics.healthScore')}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-3xl font-bold ${themeConfig.text.primary}`}>
                  <CountUpValue value={healthScore} isLoading={analyticsLoading} />
                </span>
                <HealthBadge grade={healthGrade} score={healthScore} />
              </div>
              <p className={`text-xs mt-2 capitalize ${
                healthGrade === 'excellent' ? 'text-green-400' :
                healthGrade === 'good' ? 'text-blue-400' :
                healthGrade === 'warning' ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {String(t(`imageService.analytics.${healthGrade}`, healthGrade))}
              </p>
              <p className="text-[10px] text-gray-400 mt-1.5 italic">
                {t('imageService.analytics.healthTip', 'เกณฑ์คะแนน: >= 80 (ปกติ/ดี)')}
              </p>
            </div>

            {/* Time Breakdown (Pie chart) */}
            <div key="timeBreakdown" className={`${themeConfig.card} rounded-xl p-4 relative overflow-hidden flex flex-col h-full`}>
              <DragHandle show={isEditing} />
              <h3 className={`text-sm font-semibold mb-4 flex-shrink-0 ${themeConfig.text.primary}`}>
                {t('imageService.analytics.uptime')} / {t('imageService.analytics.downtime')}
              </h3>
              {pieData.length > 0 ? (
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={70}
                        dataKey="value"
                        stroke="none"
                      >
                        {pieData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number) => `${value.toFixed(2)}%`}
                        contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }}
                        labelStyle={{ color: '#94a3b8' }}
                        itemStyle={{ color: '#e2e8f0' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className={`text-sm text-center py-8 ${themeConfig.text.secondary}`}>{t('imageService.analytics.noData')}</p>
              )}
              <div className="flex justify-center gap-4 mt-2 flex-shrink-0">
                {pieData.map((d) => (
                  <div key={d.name} className="flex items-center gap-1.5 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className={themeConfig.text.secondary}>{d.name}: {d.value.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Offline Events */}
            <div key="offlineEvents" className={`${themeConfig.card} rounded-xl p-4 relative overflow-hidden flex flex-col h-full`}>
              <DragHandle show={isEditing} />
              <h3 className={`text-sm font-semibold mb-4 flex-shrink-0 ${themeConfig.text.primary}`}>
                {t('imageService.analytics.offlineEvents')}
              </h3>
              <div className="flex items-center justify-center flex-1 min-h-0">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <div className={`p-3 rounded-full ${offlineCount === 0 ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                      <AlertTriangle size={24} className={offlineCount === 0 ? 'text-green-400' : 'text-red-400'} />
                    </div>
                  </div>
                  <div className={`text-4xl font-bold ${themeConfig.text.primary}`}>
                    <CountUpValue value={offlineCount} isLoading={analyticsLoading} />
                  </div>
                  <p className={`text-xs mt-2 ${themeConfig.text.secondary}`}>
                    {t('imageService.analytics.offlineEvents')}
                  </p>
                  <div className={`mt-4 space-y-1 text-xs ${themeConfig.text.secondary}`}>
                    <div className="flex justify-between gap-4">
                      <span>{t('imageService.analytics.uptime')}:</span>
                      <span className="text-green-400 font-medium">{formatDurationLong(uptimeSeconds)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span>{t('imageService.analytics.downtime')}:</span>
                      <span className="text-red-400 font-medium">{formatDurationLong(downtimeSeconds)}</span>
                    </div>
                    <div className="flex justify-between gap-4 items-center">
                      <span>{t('imageService.analytics.maintenance')}:</span>
                      <span className="flex items-center gap-1.5">
                        <span className="text-yellow-400 font-medium">{formatDurationLong(maintenanceSeconds)}</span>
                        {maintenanceSeconds > 0 && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-yellow-500/10 text-yellow-500">
                            {t('imageService.analytics.excludedFromSla', 'ไม่รวมใน SLA')}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Status Timeline */}
            <div key="timeline" className={`${themeConfig.card} rounded-xl p-4 relative overflow-visible flex flex-col h-full`}>
              <DragHandle show={isEditing} />
              <h3 className={`text-sm font-semibold mb-4 flex-shrink-0 ${themeConfig.text.primary}`}>
                {t('imageService.analytics.timeline')}
              </h3>
              {timeline.length > 0 ? (
                <div className="space-y-2 flex-1 min-h-0">
                  <div className="relative h-10 rounded-full overflow-hidden flex gap-[2px] bg-white/5">
                    {timeline.map((seg: any, idx: number) => {
                      const totalMs = timeline.reduce((sum: number, s: any) => sum + s.durationMs, 0)
                      const widthPct = totalMs > 0 ? (seg.durationMs / totalMs) * 100 : 0
                      if (widthPct < 0.1) return null
                      const colorMap: Record<string, string> = {
                        active: '#10B880',
                        online: '#10B880',
                        maintenance: '#f59e0b',
                        offline: '#ef4444',
                        error: '#ef4444',
                        inactive: '#6b7280',
                      }
                      return (
                        <div
                          key={idx}
                          className={`relative group cursor-pointer transition-opacity hover:opacity-80 ${idx === 0 ? 'rounded-l-full' : ''} ${idx === timeline.length - 1 ? 'rounded-r-full' : ''}`}
                          style={{
                            width: `${widthPct}%`,
                            minWidth: widthPct > 1 ? undefined : '3px',
                            backgroundColor: colorMap[seg.status] || '#6b7280'
                          }}
                          title={`${seg.status}: ${formatDurationLong(Math.round(seg.durationMs / 1000))}`}
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect()
                            setHoverSeg({ seg, widthPct, x: rect.left + rect.width / 2, y: rect.top })
                          }}
                          onMouseLeave={() => setHoverSeg(null)}
                        />
                      )
                    })}
                  </div>
                  <div className="flex gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded" style={{ backgroundColor: '#10B880' }} />
                      <span className={themeConfig.text.secondary}>{t('imageService.analytics.uptime')}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded bg-yellow-500" />
                      <span className={themeConfig.text.secondary}>{t('imageService.analytics.maintenance')}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded bg-red-500" />
                      <span className={themeConfig.text.secondary}>{t('imageService.analytics.downtime')}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <p className={`text-sm text-center py-4 ${themeConfig.text.secondary}`}>{t('imageService.analytics.noData')}</p>
              )}
            </div>

            {/* Event History Table */}
            <div key="eventHistory" className={`${themeConfig.card} rounded-xl p-4 relative overflow-hidden flex flex-col h-full`}>
              <DragHandle show={isEditing} />
              <h3 className={`text-sm font-semibold mb-4 flex-shrink-0 ${themeConfig.text.primary}`}>
                {t('imageService.analytics.eventHistory')}
              </h3>
              {events.length > 0 ? (
                <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={themeConfig.tableHeader}>
                        <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.secondary}`}>#</th>
                        <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.secondary}`}>{t('imageService.analytics.duration')}</th>
                        <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.secondary}`}>{t('ui.cameraAnalytics.event')}</th>
                        <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.secondary}`}>{t('imageService.analytics.reason')}</th>
                        <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.secondary}`}>{t('imageService.analytics.changedBy')}</th>
                        <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.secondary}`}>{t('imageService.analytics.duration')}</th>
                      </tr>
                    </thead>
                    <tbody className={themeConfig.tableDivide}>
                      {[...events].reverse().map((event: any, idx: number) => {
                        const reversedIdx = events.length - 1 - idx
                        const nextEvent = reversedIdx < events.length - 1 ? events[reversedIdx + 1] : null
                        const durationMs = nextEvent
                          ? new Date(nextEvent.createdAt).getTime() - new Date(event.createdAt).getTime()
                          : Date.now() - new Date(event.createdAt).getTime()

                        const eventTypeColors: Record<string, string> = {
                          online: 'text-green-400 bg-green-500/10',
                          offline: 'text-red-400 bg-red-500/10',
                          error: 'text-red-400 bg-red-500/10',
                          maintenance_start: 'text-yellow-400 bg-yellow-500/10',
                          maintenance_end: 'text-green-400 bg-green-500/10',
                          reconfigured: 'text-blue-400 bg-blue-500/10',
                          recovering: 'text-yellow-400 bg-yellow-500/10',
                        }

                        return (
                          <tr key={event.id} className={themeConfig.tableRow}>
                            <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>{events.length - idx}</td>
                            <td className={`px-3 py-2 text-xs ${themeConfig.text.primary}`}>
                              {new Date(event.createdAt).toLocaleString()}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${eventTypeColors[event.eventType] || 'text-gray-400 bg-gray-500/10'}`}>
                                {String(t(`imageService.analytics.eventTypes.${event.eventType}`, event.eventType))}
                              </span>
                            </td>
                            <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>
                              {event.downtimeReason || '-'}
                            </td>
                            <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>
                              {(event.metadata as any)?.changedBy || 'system'}
                            </td>
                            <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>
                              {formatDuration(Math.round(durationMs / 1000))}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={`text-sm text-center py-4 ${themeConfig.text.secondary}`}>{t('imageService.analytics.noData')}</p>
              )}
            </div>

            {/* Camera Comparison */}
            <div key="comparison" className={`${themeConfig.card} rounded-xl p-4 relative overflow-hidden flex flex-col h-full`}>
              <DragHandle show={isEditing} />
              <h3 className={`text-sm font-semibold mb-4 flex-shrink-0 ${themeConfig.text.primary}`}>
                {t('imageService.analytics.comparison')}
              </h3>
              {comparisonLoading ? (
                <TableSkeleton rows={3} cols={6} />
              ) : comparison && comparison.length > 0 ? (
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {comparisonBarData.length > 0 && (
                    <div className="h-56 mb-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={comparisonBarData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                          <Tooltip
                            contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }}
                            labelStyle={{ color: '#94a3b8' }}
                            itemStyle={{ color: '#e2e8f0' }}
                          />
                          <Legend wrapperStyle={{ fontSize: '11px' }} />
                          <Bar dataKey="availability" name={t('imageService.analytics.availability')} fill="#10B880" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="healthScore" name={t('imageService.analytics.healthScore')} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className={themeConfig.tableHeader}>
                          <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.secondary}`}>
                            {t('ui.cameraAnalytics.camera')}
                          </th>
                          <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.secondary}`}>
                            {t('imageService.analytics.availability')}
                          </th>
                          <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.secondary}`}>
                            {t('ui.cameraAnalytics.sla')}
                          </th>
                          <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.secondary}`}>
                            {t('imageService.analytics.mtbf')}
                          </th>
                          <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.secondary}`}>
                            {t('imageService.analytics.mttr')}
                          </th>
                          <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.secondary}`}>
                            {t('imageService.analytics.healthScore')}
                          </th>
                          <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.secondary}`}>
                            {t('imageService.analytics.offlineEvents')}
                          </th>
                        </tr>
                      </thead>
                      <tbody className={themeConfig.tableDivide}>
                        {comparison.map((cam: any) => (
                          <tr
                            key={cam.cameraId}
                            className={`${themeConfig.tableRow} cursor-pointer ${cam.cameraId === effectiveCameraId ? 'bg-cyan-500/5' : ''}`}
                            onClick={() => setSelectedCameraId(cam.cameraId)}
                          >
                            <td className={`px-3 py-2 text-xs font-medium ${themeConfig.text.primary}`}>
                              {cam.cameraName}
                            </td>
                            <td className={`px-3 py-2 text-xs ${cam.availability >= 99 ? 'text-green-400' : cam.availability >= 95 ? 'text-yellow-400' : 'text-red-400'}`}>
                              {cam.availability}%
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5" title={`${t('imageService.analytics.slaTarget')}: ${cam.slaTarget}%`}>
                                {cam.slaMet ? (
                                  <CheckCircle size={14} className="text-green-400" />
                                ) : (
                                  <XCircle size={14} className="text-red-400" />
                                )}
                                <span className={`text-[10px] ${themeConfig.text.secondary}`}>{cam.slaTarget}%</span>
                                {cam.hasCustomSla && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" title={t('imageService.analytics.customSla', 'Custom SLA')} />}
                              </div>
                            </td>
                            <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>
                              {cam.mtbf !== null ? `${cam.mtbf.toFixed(1)}h` : '--'}
                            </td>
                            <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>
                              {cam.mttr !== null ? `${cam.mttr.toFixed(1)}m` : '--'}
                            </td>
                            <td className="px-3 py-2">
                              <HealthBadge grade={cam.healthGrade} score={cam.healthScore} />
                            </td>
                            <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>
                              {cam.offlineCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className={`text-sm text-center py-4 ${themeConfig.text.secondary}`}>{t('imageService.analytics.noData')}</p>
              )}
            </div>
          </ResponsiveGridLayout>
        </div>
      );
    })()}
      {hoverSeg && hoverSeg.seg && createPortal(
        <div style={{ position: 'fixed', left: hoverSeg.x, top: hoverSeg.y - 8, transform: 'translate(-50%, -100%)', zIndex: 99999, pointerEvents: 'none' }}
          className="bg-slate-900 border border-white/20 rounded-lg px-4 py-3 text-xs text-white whitespace-nowrap shadow-2xl">
          <div className="font-bold text-sm mb-1">
            {hoverSeg.seg.status === 'active' ? `🟢 ${t('imageService.analytics.uptime')}` :
             hoverSeg.seg.status === 'maintenance' ? `🟡 ${t('imageService.analytics.maintenance')}` :
             `🔴 ${t('imageService.analytics.downtime')}`}
          </div>
          <div className="text-cyan-300 font-semibold text-base">{formatDurationLong(Math.round(hoverSeg.seg.durationMs / 1000))}</div>
          <div className="text-gray-400 mt-1.5">{t('imageService.analytics.fromStatus')}: {new Date(hoverSeg.seg.start).toLocaleString()}</div>
          <div className="text-gray-400">{t('imageService.analytics.toStatus')}: {new Date(hoverSeg.seg.end).toLocaleString()}</div>
          <div className="text-gray-500 mt-1 text-[10px]">{hoverSeg.widthPct.toFixed(1)}%</div>
        </div>,
        document.body
      )}
    </div>
  )
}
