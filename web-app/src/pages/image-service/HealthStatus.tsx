import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/contexts/ThemeContext'
import { imageServiceApi } from '@/services/imageServiceApi'
import {
  HeartPulse, Database, HardDrive, Server, Cpu, Activity, CheckCircle, XCircle,
  Camera, Clock, Layers, AlertTriangle, Play, Shield, Video, Radio, Wifi, WifiOff,
} from 'lucide-react'
import { TableSkeleton, Button } from '@/components/ui'
import api from '@/lib/axios'

const BASE = '/image-service/api/v1'

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${ok ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
      {ok ? <CheckCircle size={16} className="text-green-400" /> : <XCircle size={16} className="text-red-400" />}
      <span className={`text-sm font-medium ${ok ? 'text-green-400' : 'text-red-400'}`}>{label}</span>
    </div>
  )
}

function UsageBar({ label, used, total, color }: { label: string; used: number; total: number; color: string }) {
  const { themeConfig } = useTheme()
  const pct = total > 0 ? (used / total) * 100 : 0
  const fmt = (b: number) => {
    if (b === 0) return '0 B'
    const k = 1024; const s = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(b) / Math.log(k))
    return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i]
  }
  const barColor = pct > 90 ? '#ef4444' : pct > 75 ? '#f59e0b' : color
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className={themeConfig.text.secondary}>{label}</span>
        <span style={{ color: barColor }}>{pct.toFixed(1)}%</span>
      </div>
      <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: barColor }} />
      </div>
      <div className="flex justify-between text-[10px] mt-0.5">
        <span className={themeConfig.text.secondary}>{fmt(used)} used</span>
        <span className={themeConfig.text.secondary}>{fmt(total)} total</span>
      </div>
    </div>
  )
}

export default function HealthStatus() {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()

  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['health-check'],
    queryFn: () => api.get(`${BASE}/health`).then(r => r.data),
    staleTime: 1000 * 10,
    refetchInterval: 1000 * 15,
  })

  const { data: cameras = [] } = useQuery({
    queryKey: ['cameras-health'],
    queryFn: () => imageServiceApi.getCameras(),
    staleTime: 1000 * 30,
  })

  const { data: alerts } = useQuery({
    queryKey: ['alerts-health'],
    queryFn: () => imageServiceApi.getAlerts({ resolved: false }, { silent403: true }),
    staleTime: 1000 * 30,
  })

  const { data: devices = [] } = useQuery({
    queryKey: ['cctv-devices-health'],
    queryFn: () => imageServiceApi.getDevices(),
    staleTime: 1000 * 30,
  })

  const camerasArr = Array.isArray(cameras?.data) ? cameras.data : (Array.isArray(cameras) ? cameras : [])
  const alertsArr = Array.isArray(alerts?.data) ? alerts.data : (Array.isArray(alerts) ? alerts : [])
  const devicesArr = Array.isArray(devices) ? devices : []

  const activeCameras = camerasArr.filter((c: any) => c.status === 'active').length
  const openAlerts = alertsArr.length

  // CCTV Health Pillars Separation
  const onlineDevices = devicesArr.filter((d: any) => d.status === 'online').length
  const offlineDevices = devicesArr.filter((d: any) => d.status === 'offline').length
  const streamingCameras = camerasArr.filter((c: any) => c.operationalStatus === 'online').length
  const stalledCameras = camerasArr.filter((c: any) => c.operationalStatus === 'offline' || c.status === 'error').length
  const flowAlerts = alertsArr.filter((a: any) => a.alertType === 'camera_no_new_images').length

  const serviceOk = health?.status === 'ok'
  const dbOk = health?.checks?.database === 'ok'
  const redisOk = health?.checks?.redis === 'ok'
  const storageOk = health?.checks?.storage === 'ok'
  const providers = health?.providers ?? []
  const sys = health?.system ?? {}
  const queue = health?.queue ?? {}

  const fmtUptime = (sec: number) => {
    const d = Math.floor(sec / 86400); const h = Math.floor((sec % 86400) / 3600); const m = Math.floor((sec % 3600) / 60)
    if (d > 0) return `${d}d ${h}h ${m}m`; if (h > 0) return `${h}h ${m}m`; return `${m}m`
  }

  if (healthLoading) return <div className="p-6"><TableSkeleton rows={4} /></div>

  return (
    <div className="p-6">
      <div className="mb-6">
        <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
          iSmart CCTV · {t('imageService.health.title')}
        </p>
        <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.health.title')}</h1>
        <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.health.subtitle')}</p>
      </div>

      {/* System Status */}
      <div className={`${themeConfig.card} rounded-lg p-6 mb-5`}>
        <div className="flex items-center gap-3 mb-4">
          <div className={`p-2 rounded-lg ${serviceOk ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
            <HeartPulse size={20} className={serviceOk ? 'text-green-400' : 'text-red-400'} />
          </div>
          <div>
            <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.health.systemStatus')}</h3>
            <p className={`text-xs ${themeConfig.text.secondary}`}>{t(`imageService.health.${serviceOk ? 'allOperational' : 'degraded'}`)}</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className={`text-xs ${themeConfig.text.secondary}`}><Clock size={12} className="inline mr-1" />{t('imageService.health.uptime')}: {fmtUptime(health?.uptime ?? 0)}</span>
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${serviceOk ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              {serviceOk ? t('imageService.health.healthy') : t('imageService.health.degraded')}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <StatusBadge ok={dbOk} label="PostgreSQL" />
          <StatusBadge ok={redisOk} label="Redis" />
          <StatusBadge ok={storageOk} label={t('imageService.health.storage')} />
          {providers.map((p: any) => (
            <StatusBadge key={p.id} ok={p.status === 'ok'} label={`${p.name} (${p.latencyMs}ms)`} />
          ))}
        </div>
      </div>

      {/* CCTV Infrastructure & Stream Health (3-Pillar Separation) */}
      <div className={`${themeConfig.card} rounded-lg p-5 mb-5`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Radio size={18} className="text-cyan-400" />
            <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>
              {t('ui.healthStatus.cctvNetworkLiveStreamHealthHigh')}
            </h3>
          </div>
          <span className="text-xs text-slate-400">
            {t('ui.healthStatus.probeStreamFlowSeparation')}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Pillar 1: Device Reachability */}
          <div className="p-4 rounded-lg bg-white/5 border border-white/5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-medium ${themeConfig.text.secondary}`}>
                  {t('ui.healthStatus.n1DeviceReachabilityPingSocket')}
                </span>
                {offlineDevices === 0 ? (
                  <Wifi size={16} className="text-emerald-400" />
                ) : (
                  <WifiOff size={16} className="text-amber-400" />
                )}
              </div>
              <p className="text-2xl font-bold text-slate-100">
                {onlineDevices} / {devicesArr.length} <span className="text-xs font-normal text-slate-400">{t('ui.healthStatus.unitsOnline')}</span>
              </p>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              {offlineDevices === 0
                ? t('ui.healthStatus.allDvrNvrIpCamNetwork')
                : t('ui.healthStatus.recordingDeviceSOfflineSocketTimeout', { offlineDevices })}
            </p>
          </div>

          {/* Pillar 2: Stream Active (MediaMTX / WHEP) */}
          <div className="p-4 rounded-lg bg-white/5 border border-white/5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-medium ${themeConfig.text.secondary}`}>
                  {t('ui.healthStatus.n2StreamActiveWhepRtsp')}
                </span>
                <Video size={16} className="text-cyan-400" />
              </div>
              <p className="text-2xl font-bold text-cyan-400">
                {streamingCameras} / {camerasArr.length} <span className="text-xs font-normal text-slate-400">{t('ui.healthStatus.chStreaming')}</span>
              </p>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              {t('ui.healthStatus.mediaMTXDynamicPathRegistrationSignedStream')}
            </p>
          </div>

          {/* Pillar 3: Video Stalled / Dropped Frames */}
          <div className="p-4 rounded-lg bg-white/5 border border-white/5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-medium ${themeConfig.text.secondary}`}>
                  {t('ui.healthStatus.n3VideoStalledDroppedFrames')}
                </span>
                {stalledCameras === 0 && flowAlerts === 0 ? (
                  <CheckCircle size={16} className="text-emerald-400" />
                ) : (
                  <AlertTriangle size={16} className="text-rose-400" />
                )}
              </div>
              <p className={`text-2xl font-bold ${stalledCameras === 0 && flowAlerts === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {stalledCameras + flowAlerts} <span className="text-xs font-normal text-slate-400">{t('ui.healthStatus.issues')}</span>
              </p>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              {stalledCameras === 0 && flowAlerts === 0
                ? t('ui.healthStatus.socketUpActiveFrameFlowVerified')
                : t('ui.healthStatus.cameraSStalledOrProducing', { stalledCameras })}
            </p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {[
          { icon: Camera, label: t('imageService.health.activeCameras'), value: String(activeCameras), color: '#10b981' },
          { icon: AlertTriangle, label: t('imageService.health.openAlerts'), value: String(openAlerts), color: openAlerts > 0 ? '#f59e0b' : '#10b981' },
          { icon: Server, label: t('imageService.health.version'), value: `v${health?.version ?? '1.0.0'}`, color: '#8b5cf6' },
        ].map((s, i) => (
          <div key={i} className={`${themeConfig.card} rounded-lg p-4`}>
            <div className="flex items-center gap-2 mb-2"><s.icon size={16} style={{ color: s.color }} /><span className={`text-xs ${themeConfig.text.secondary}`}>{s.label}</span></div>
            <p className="text-lg font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* 3 Column: Resources | Services | Verification */}
      <div className="grid grid-cols-3 gap-5">
        {/* Server Resources */}
        <div className={`${themeConfig.card} rounded-lg p-5`}>
          <div className="flex items-center gap-2 mb-4"><Cpu size={16} className="text-cyan-400" /><h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.health.serverResources')}</h3></div>
          <div className="space-y-4">
            <UsageBar label={t('ui.healthStatus.ram', { v0: t('imageService.health.memory') })} used={sys.memoryUsed ?? 0} total={sys.memoryTotal ?? 0} color="#8b5cf6" />
            <UsageBar label={`${t('imageService.health.disk')} (/)`} used={sys.diskUsed ?? 0} total={sys.diskTotal ?? 0} color="#06b6d4" />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
            {[
              { label: t('ui.healthStatus.cpuCores'), value: sys.cpuCores ?? '—' },
              { label: t('ui.healthStatus.loadAvg'), value: (sys.loadAvg ?? []).join(' / ') || '—' },
              { label: t('ui.healthStatus.platform'), value: sys.platform ?? '—' },
              { label: 'Node.js', value: sys.nodeVersion ?? '—' },
            ].map((item, i) => (
              <div key={i} className="px-3 py-2 rounded-lg bg-white/5">
                <span className={themeConfig.text.secondary}>{item.label}</span>
                <p className={`font-bold ${themeConfig.text.primary} truncate`}>{item.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Services & Queue */}
        <div className={`${themeConfig.card} rounded-lg p-5`}>
          <div className="flex items-center gap-2 mb-4"><Activity size={16} className="text-cyan-400" /><h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.health.serviceDetails')}</h3></div>
          <div className="space-y-2 text-sm">
            {[
              { name: 'image-api', ok: serviceOk, detail: `uptime ${fmtUptime(health?.uptime ?? 0)}` },
              { name: 'PostgreSQL', ok: dbOk, detail: 'postgres:5432' },
              { name: 'Redis', ok: redisOk, detail: 'redis:6379' },
              ...providers.map((p: any) => ({ name: `${p.name} (${p.type})`, ok: p.status === 'ok', detail: `${p.latencyMs}ms` })),
            ].map((svc) => (
              <div key={svc.name} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/5">
                {svc.ok ? <CheckCircle size={13} className="text-green-400" /> : <XCircle size={13} className="text-red-400" />}
                <span className={`font-medium ${themeConfig.text.primary}`}>{svc.name}</span>
                <span className={`text-xs font-mono ${themeConfig.text.secondary}`}>{svc.detail}</span>
                <span className={`ml-auto text-xs ${svc.ok ? 'text-green-400' : 'text-red-400'}`}>{svc.ok ? t('imageService.health.healthy') : t('imageService.health.degraded')}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Verification */}
        <VerificationCard />
      </div>
    </div>
  )
}

const VERIFY_ENDPOINTS = [
  { name: 'Auth Session', path: '/auth/me' },
  { name: 'Cameras', path: '/cameras' },
  { name: 'Storage Providers', path: '/storage-providers' },
  { name: 'Backup Status', path: '/backup/status' },
  { name: 'Retention', path: '/retention-policies' },
  { name: 'Alerts', path: '/alerts' },
  { name: 'Alert Rules', path: '/alert-rules' },
  { name: 'Masterdata', path: '/masterdata?type=camera_status' },
  { name: 'API Keys', path: '/api-keys' },
  { name: 'Telegram', path: '/settings/telegram' },
  { name: 'System Config', path: '/system-config', noAuth: true },
  { name: 'Users', path: '/users' },
  { name: 'Roles', path: '/roles' },
  { name: 'Audit Logs', path: '/audit-logs' },
  { name: 'Health', path: '/health', noAuth: true },
  { name: 'Metrics', path: '/metrics' },
  { name: 'CCTV Devices', path: '/devices' },
  { name: 'CCTV Sites', path: '/sites' },
  { name: 'CCTV Templates', path: '/devices/templates' },
  { name: 'Incidents Center', path: '/cameras/incidents' },
]

function VerificationCard() {
  const { t } = useTranslation()
  const endpoints = VERIFY_ENDPOINTS as any[]
  const { themeConfig } = useTheme()
  const [results, setResults] = useState<Array<{ name: string; ok: boolean; ms: number; error?: string }>>([])
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<string | null>(null)

  const runVerification = useCallback(async () => {
    setRunning(true); setResults([])
    const token = localStorage.getItem('accessToken')
    const base = '/image-service/api/v1'
    const newResults: typeof results = []
    for (const ep of endpoints) {
      const start = Date.now()
      try {
        if (ep.method === 'POST') {
          const res = await fetch(`${base}${ep.path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ep.body) })
          newResults.push({ name: ep.name, ok: res.ok, ms: Date.now() - start, error: res.ok ? undefined : `${res.status}` })
        } else {
          const headers: Record<string, string> = {}
          if (!ep.noAuth && token) headers['Authorization'] = `Bearer ${token}`
          const res = await fetch(`${base}${ep.path}`, { headers })
          newResults.push({ name: ep.name, ok: res.ok, ms: Date.now() - start, error: res.ok ? undefined : `${res.status}` })
        }
      } catch (err: any) { newResults.push({ name: ep.name, ok: false, ms: Date.now() - start, error: err.message }) }
      setResults([...newResults])
    }
    setLastRun(new Date().toLocaleString()); setRunning(false)
  }, [endpoints])

  const pass = results.filter(r => r.ok).length
  const fail = results.filter(r => !r.ok).length
  const total = results.length
  const allPass = total > 0 && fail === 0

  return (
    <div className={`${themeConfig.card} rounded-lg p-5`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-cyan-400" />
          <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.health.verification')}</h3>
          {total > 0 && (
            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-bold ${allPass ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              {allPass ? 'PASS' : 'FAIL'} — {pass}/{total}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lastRun && <span className={`text-xs ${themeConfig.text.secondary}`}>{lastRun}</span>}
          <Button size="sm" onClick={runVerification} disabled={running}>
            <Play size={12} className="mr-1" />{running ? `${total}/${endpoints.length}...` : t('imageService.health.runVerification')}
          </Button>
        </div>
      </div>
      {total > 0 && (
        <>
          <p className={`text-xs mb-3 ${themeConfig.text.secondary}`}>{t('imageService.health.verificationMethod')}</p>
          <div className="grid grid-cols-2 gap-1.5 max-h-[300px] overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs ${r.ok ? 'bg-green-500/5' : 'bg-red-500/10'}`}>
                {r.ok ? <CheckCircle size={12} className="text-green-400 flex-shrink-0" /> : <XCircle size={12} className="text-red-400 flex-shrink-0" />}
                <span className={`flex-1 truncate ${themeConfig.text.primary}`}>{t(`ui.healthStatus.endpoints.${r.name.replace(/[^A-Za-z0-9]/g, '')}`, { defaultValue: r.name })}</span>
                <span className={`flex-shrink-0 font-mono ${r.ok ? themeConfig.text.secondary : 'text-red-400'}`}>{r.ok ? `${r.ms}ms` : r.error}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {total === 0 && !running && (
        <p className={`text-xs text-center py-4 ${themeConfig.text.secondary}`}>{t('imageService.health.verificationHint')}</p>
      )}
    </div>
  )
}
