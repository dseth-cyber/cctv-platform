import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import { PageErrorBoundary } from '@/components/PageErrorBoundary'
import { useTranslation } from 'react-i18next'
import { useTheme, themes } from '@/contexts/ThemeContext'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { imageServiceApi } from '@/services/imageServiceApi'
import { Button, Modal, PasswordStrengthMeter, PasswordInput } from '@/components/ui'
import { setForbiddenHandler } from '@/lib/axios'
import LoginPage from '@/pages/auth/LoginPage'

// Core pages imported eagerly for instant navigation without lazy-loading delay
import ImageServiceCameras from '@/pages/image-service/ImageServiceCameras'

const ImageServiceCameraDetail = lazy(() => import('@/pages/image-service/ImageServiceCameraDetail'))
const ImageServiceRetention = lazy(() => import('@/pages/image-service/ImageServiceRetention'))
const ImageServiceRoadmap = lazy(() => import('@/pages/image-service/ImageServiceRoadmap'))
const ImageServiceSettings = lazy(() => import('@/pages/image-service/ImageServiceSettings'))
const AlertManagement = lazy(() => import('@/pages/image-service/AlertManagement'))
const UserManagement = lazy(() => import('@/pages/image-service/UserManagement'))
const HealthStatus = lazy(() => import('@/pages/image-service/HealthStatus'))
const TelegramBotSettings = lazy(() => import('@/pages/image-service/TelegramBotSettings'))
const ApiKeysManagement = lazy(() => import('@/pages/image-service/ApiKeysManagement'))
const MasterdataManagement = lazy(() => import('@/pages/image-service/MasterdataManagement'))
const SystemConfigPage = lazy(() => import('@/pages/image-service/SystemConfigPage'))
const RequiredFieldsSettings = lazy(() => import('@/pages/image-service/RequiredFieldsSettings'))
const AuditLogViewer = lazy(() => import('@/pages/image-service/AuditLogViewer'))
const BackupDashboard = lazy(() => import('@/pages/image-service/BackupDashboard'))
const StorageProvidersPage = lazy(() => import('@/pages/image-service/StorageProvidersPage'))
const CameraAnalytics = lazy(() => import('@/pages/image-service/CameraAnalytics'))
const IncidentCenter = lazy(() => import('@/pages/image-service/IncidentCenter'))
const WorkOrders = lazy(() => import('@/pages/image-service/WorkOrders'))
const CameraTemplates = lazy(() => import('@/pages/image-service/CameraTemplates'))
const ImageServiceReports = lazy(() => import('@/pages/image-service/ImageServiceReports'))
const DeviceManagement = lazy(() => import('@/pages/cctv/DeviceManagement'))
const SiteManagement = lazy(() => import('@/pages/cctv/SiteManagement'))
const LiveGrid = lazy(() => import('@/pages/cctv/LiveGrid'))
const CameraGroups = lazy(() => import('@/pages/cctv/CameraGroups'))
const CctvMap = lazy(() => import('@/pages/cctv/CctvMap'))
const CctvDashboard = lazy(() => import('@/pages/cctv/CctvDashboard'))
const CctvPlayback = lazy(() => import('@/pages/cctv/CctvPlayback'))
const MediaNodeManagement = lazy(() => import('@/pages/cctv/MediaNodeManagement'))
const CctvReleaseCenter = lazy(() => import('@/pages/cctv/CctvReleaseCenter'))
import { translateAlertTitle, translateAlertMessage, getLocalizedValue, type IncidentLabelMaps } from '@/utils/textUtils'
import {
  Camera, LayoutDashboard, Search, Activity, HardDrive, FileText, Shield, Settings, Map, CalendarClock,
  FolderTree, Globe, Palette, User, ChevronDown, ChevronLeft, ChevronRight, LogOut, Lock, Bell, Users, HeartPulse, Key, MessageCircle, BookText, Sliders, AlertTriangle, History, Info, Server, Layers, Image, BarChart3, RefreshCw, Play, ClipboardList, LayoutTemplate, BookOpen,
  Menu, X, GripVertical, ArrowDownUp, RotateCcw, Hourglass, FileSpreadsheet, Eye, EyeOff, Package,
  Building2, Radio, MapPin, Film, FileCheck, Wrench } from 'lucide-react'

export function hasPermission(user: any, permission: string): boolean {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'system') return true
  if (!user.permissions) return false
  return user.permissions.includes(permission) || user.permissions.includes('*')
}

// Sidebar nav item text/hover colors, aware of the light theme (whose sidebar bg is near-white —
// the dark-theme gray-300/400 text used elsewhere is invisible against it).
function sidebarItemClasses(theme: string, isActive: boolean, muted = false): string {
  if (isActive) return theme === 'light' ? 'bg-cyan-100 text-cyan-700' : 'bg-cyan-500/15 text-cyan-300'
  if (theme === 'light') return muted ? 'text-gray-500 hover:bg-gray-100 hover:text-gray-900' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
  return muted ? 'text-gray-400 hover:bg-white/5 hover:text-white' : 'text-gray-300 hover:bg-white/5 hover:text-white'
}
function sidebarBorderClass(theme: string): string {
  return theme === 'light' ? 'border-gray-200' : 'border-white/10'
}

function UnauthorizedPage() {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center min-h-[50vh]">
      <AlertTriangle size={56} className="text-red-400 mb-4 animate-pulse" />
      <h3 className={`text-xl font-bold ${themeConfig.text.primary}`}>
        {t('imageService.auth.unauthorized') || t('ui.app.accessDenied')}
      </h3>
      <p className={`text-sm mt-2 max-w-md ${themeConfig.text.secondary}`}>
        {t('imageService.auth.unauthorizedDesc') || t('ui.app.youDoNotHavePermissionTo')}
      </p>
    </div>
  )
}

// The setup pages opened from the master data page, with what each one needs.
export const MASTERDATA_LINKS = [
  { path: '/cctv/camera-groups', labelKey: 'nav.cameraGroups', icon: FolderTree, permission: 'cameras:read' },
  { path: '/cctv/camera-templates', labelKey: 'nav.cameraTemplates', icon: LayoutTemplate, permission: 'camera-template:read' },
  { path: '/cctv/retention', labelKey: 'nav.retention', icon: Shield, permission: 'retention:read' },
]
const MASTERDATA_PAGE_PERMISSIONS = ['masterdata:read', ...MASTERDATA_LINKS.map((l) => l.permission)]

const navItems = [
  { path: '/cctv/overview', labelKey: 'nav.overview', icon: LayoutDashboard, permission: 'overview:read' },
  { path: '/cctv/cameras', labelKey: 'nav.cameras', icon: Camera, permission: 'cameras:read' },
  { path: '/cctv/live-grid', labelKey: 'nav.liveGrid', icon: Radio, permission: 'cameras:read' },
  { path: '/cctv/playback', labelKey: 'nav.playback', icon: Film, permission: 'cameras:read' },
  { path: '/cctv/devices', labelKey: 'nav.devices', icon: Server, permission: 'cameras:read' },
  { path: '/cctv/sites', labelKey: 'nav.sites', icon: Building2, permission: 'cameras:read' },
  { path: '/cctv/map', labelKey: 'nav.map', icon: MapPin, permission: 'cameras:read' },
  { path: '/cctv/camera-analytics', labelKey: 'nav.cameraAnalytics', icon: BarChart3, permission: 'cameras:read' },
  { path: '/cctv/incidents', labelKey: 'nav.incidents', icon: ClipboardList, permission: 'cameras:read' },
  { path: '/cctv/work-orders', labelKey: 'nav.workOrders', icon: Wrench, permission: 'cameras:read' },
  { path: '/cctv/reports', labelKey: 'nav.reports', icon: FileSpreadsheet, permission: 'cameras:read' },
  { path: '/cctv/alerts', labelKey: 'nav.alerts', icon: Bell, permission: 'alerts:read' },
  { path: '/cctv/masterdata', labelKey: 'nav.masterdata', icon: BookText, permission: 'masterdata:read', anyOf: MASTERDATA_PAGE_PERMISSIONS, activeOn: ['/cctv/camera-groups', '/cctv/camera-templates', '/cctv/retention'] },
]

const settingsSubItems = [
  { path: '/cctv/settings', labelKey: 'nav.settings', icon: Settings, permission: 'settings:read' },
  { path: '/cctv/roadmap', labelKey: 'nav.roadmap', icon: Map, permission: 'roadmap:read' },
  { path: '/cctv/api-keys', labelKey: 'nav.apiKeys', icon: Key, permission: 'api-keys:read' },
  { path: '/cctv/telegram-bot', labelKey: 'nav.telegramBot', icon: MessageCircle, permission: 'telegram-bot:read' },
  { path: '/cctv/system-config', labelKey: 'nav.systemConfig', icon: Sliders, permission: 'system-config:read' },
  { path: '/cctv/required-fields', labelKey: 'nav.requiredFields', icon: ClipboardList, permission: 'system-config:read' },
  { path: '/cctv/users', labelKey: 'nav.users', icon: Users, permission: 'users:read' },
  { path: '/cctv/health', labelKey: 'nav.health', icon: HeartPulse, permission: 'health:read' },
  { path: '/cctv/media-nodes', labelKey: 'nav.mediaNodes', icon: Server, permission: 'cameras:read' },
  { path: '/cctv/storage-providers', labelKey: 'nav.storageProviders', icon: Server, permission: 'storage:read' },
  { path: '/cctv/audit-log', labelKey: 'nav.auditLog', icon: History, permission: 'audit-log:read', allCameras: true },
  { path: '/cctv/backup', labelKey: 'nav.backup', icon: Shield, permission: 'backup:read' },
  { path: '/cctv/release', labelKey: 'nav.release', icon: FileCheck, permission: 'settings:read' },
]

const LANG_OPTIONS = [
  { value: 'th', label: 'TH' },
  { value: 'en', label: 'EN' },
  { value: 'cn', label: 'CN' },
  { value: 'mm', label: 'MM' },
  { value: 'jp', label: 'JP' },
]

const THEME_OPTIONS = [
  { value: 'modern', labelKey: 'ui.app.themeModern' },
  { value: 'dark', labelKey: 'ui.app.themeDark' },
  { value: 'light', labelKey: 'ui.app.themeLight' },
]

function Dropdown({ icon: Icon, options, value, onChange }: {
  icon: any
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium hover:bg-white/10 transition-colors"
      >
        <Icon size={15} />
        <span>{options.find(o => o.value === value)?.label}</span>
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-32 rounded-md border border-white/20 bg-slate-800 shadow-xl z-50 overflow-hidden">
          {options.map(o => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                value === o.value ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-200 hover:bg-white/10'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const SEARCH_TYPE_ICONS: Record<string, any> = { camera: Camera, image: Image, alert: Bell, user: User }
const SEARCH_TYPE_LABELS: Record<string, string> = { camera: 'Cameras', image: 'Images', alert: 'Alerts', user: 'Users' }
const LANG_LABELS: Record<string, string> = { th: 'TH', en: 'EN', cn: 'CN', mm: 'MM', jp: 'JP' }
const LANG_NAMES: Record<string, string> = { th: 'ไทย', en: 'English', cn: '中文', mm: 'မြန်မာ', jp: '日本語' }

function LanguageDropdown({ lang, onChange }: { lang: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-bold hover:bg-white/10 transition-colors">
        <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center text-[10px] font-bold">{LANG_LABELS[lang] ?? lang.toUpperCase()}</span>
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-28 rounded-md border border-white/20 bg-slate-800 shadow-xl z-50 overflow-hidden">
          {LANG_OPTIONS.map(o => (
            <button key={o.value} onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors ${lang === o.value ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-200 hover:bg-white/10'}`}>
              <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[9px] font-bold">{o.label}</span>
              {LANG_NAMES[o.value] ?? o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function NavBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const canAcknowledge = hasPermission(user, 'alerts:update')

  const { data: countData } = useQuery({
    queryKey: ['unacknowledged-count'],
    queryFn: () => imageServiceApi.getUnacknowledgedCount(),
    refetchInterval: 1000 * 15,
    staleTime: 1000 * 10,
  })

  const { data: alerts } = useQuery({
    queryKey: ['navbar-alerts'],
    queryFn: () => imageServiceApi.getAlerts({ resolved: false }, { silent403: true }),
    refetchInterval: 1000 * 30,
    staleTime: 1000 * 15,
    enabled: open,
  })

  // Reason/Resolution codes embedded in camera status-change alert messages are
  // masterdata-backed — resolve them to the viewer's language here rather than
  // showing the raw code (e.g. "completed").
  const { data: incidentOptions } = useQuery({
    queryKey: ['incident-options'],
    queryFn: () => imageServiceApi.getIncidentOptions({ silent403: true }),
    staleTime: 1000 * 60 * 5,
    enabled: open,
  })
  const incidentLabels = useMemo<IncidentLabelMaps>(() => ({
    reasons: Object.fromEntries((incidentOptions?.reasons ?? []).map((r: any) => [r.code, getLocalizedValue(r, i18n.language)])),
    resolutions: Object.fromEntries((incidentOptions?.resolutions ?? []).map((r: any) => [r.code, getLocalizedValue(r, i18n.language)])),
    rootCauses: Object.fromEntries((incidentOptions?.rootCauses ?? []).map((r: any) => [r.code, getLocalizedValue(r, i18n.language)])),
  }), [incidentOptions, i18n.language])

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  const count = countData?.count ?? 0
  const alertsArr = Array.isArray(alerts?.data) ? alerts.data : (Array.isArray(alerts) ? alerts : [])
  const recent = alertsArr.slice(0, 5)

  const handleAcknowledge = async () => {
    try {
      await imageServiceApi.acknowledgeAllAlerts()
      queryClient.invalidateQueries({ queryKey: ['unacknowledged-count'] })
    } catch { /* ignore */ }
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)}
        className="relative flex items-center px-2.5 py-1.5 rounded-md text-xs hover:bg-white/10 transition-colors">
        <Bell size={16} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center animate-pulse">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-80 rounded-md border border-white/20 bg-slate-800 shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
            <span className="text-xs font-semibold text-white">{t('imageService.nav.alerts') || t('ui.app.notifications')}</span>
            {count > 0 && canAcknowledge && (
              <button onClick={handleAcknowledge} className="text-[10px] text-cyan-400 hover:text-cyan-300">
                {t('imageService.alerts.markAllRead') || t('ui.app.acknowledgeAll')}
              </button>
            )}
          </div>
          {recent.length > 0 ? (
            <div className="max-h-64 overflow-y-auto">
              {recent.map((a: any) => (
                <div key={a.id} className="px-3 py-2 border-b border-white/5 hover:bg-white/5 transition-colors">
                  <div className="flex items-start gap-2">
                    <span className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${a.severity === 'critical' ? 'bg-red-400' : a.severity === 'warning' ? 'bg-yellow-400' : 'bg-blue-400'}`} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-white truncate">{translateAlertTitle(a.title, t)}</p>
                      <p className="text-[10px] text-gray-400 truncate">{translateAlertMessage(a.message, t, incidentLabels, i18n.language)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-3 py-4 text-xs text-gray-400 text-center">{t('imageService.health.healthy') || t('ui.app.noNotifications')}</p>
          )}
          <a href="/cctv/alerts" className="block px-3 py-2 text-center text-xs text-cyan-400 hover:bg-white/5 border-t border-white/10 transition-colors">
            {t('imageService.alerts.viewAll') || t('ui.app.viewAll')} →
          </a>
        </div>
      )}
    </div>
  )
}

function NavSearch() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery(''); setResults([]) } }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const debouncedSearch = useCallback((q: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!q || q.length < 2) { setResults([]); setLoading(false); return }
    setLoading(true)
    timerRef.current = setTimeout(async () => {
      try {
        const res = await imageServiceApi.universalSearch(q)
        setResults(res.results ?? [])
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 300)
  }, [])

  const handleChange = (val: string) => {
    setQuery(val)
    debouncedSearch(val)
  }

  const grouped = results.reduce<Record<string, any[]>>((acc, r) => {
    if (!acc[r.type]) acc[r.type] = []
    acc[r.type].push(r)
    return acc
  }, {})

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input ref={inputRef} value={query}
          onChange={e => { handleChange(e.target.value); if (!open) setOpen(true) }}
          onFocus={() => { if (query.length >= 2) setOpen(true) }}
          placeholder={t('common.search') || t('ui.app.search')}
          autoComplete="off" data-1p-ignore data-lpignore="true" data-form-type="other" name="nav-search"
          className="w-56 pl-8 pr-3 py-1.5 rounded-md text-xs bg-white/10 text-white border border-white/20 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:w-72 transition-all" />
      </div>
      {open && (query.length >= 2) && (
        <div className="absolute right-0 mt-1 w-72 rounded-md border border-white/20 bg-slate-800 shadow-xl z-50 overflow-hidden">
          {loading && (
            <p className="px-3 py-2 text-xs text-gray-400 text-center">...</p>
          )}
          {!loading && Object.keys(grouped).length > 0 && (
            <div className="max-h-64 overflow-y-auto">
              {Object.entries(grouped).map(([type, items]) => {
                const TypeIcon = SEARCH_TYPE_ICONS[type] ?? Search
                return (
                  <div key={type}>
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5 border-t border-white/5">
                      <TypeIcon size={11} />
                      {SEARCH_TYPE_LABELS[type] ?? type}
                    </div>
                    {items.map((r: any) => (
                      <a key={r.id} href={r.url} onClick={() => { setOpen(false); setQuery(''); setResults([]) }}
                        className="block px-3 py-2 text-xs text-gray-200 hover:bg-white/10 transition-colors">
                        <div className="font-medium truncate">{r.title}</div>
                        {r.subtitle && <div className="text-[10px] text-gray-400 truncate">{r.subtitle}</div>}
                      </a>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
          {!loading && results.length === 0 && (
            <p className="px-3 py-3 text-xs text-gray-400 text-center">{t('imageService.search.noResults') || t('ui.app.noResults')}</p>
          )}
        </div>
      )}
    </div>
  )
}

function ProfileMenu({ username, role, onLogout, onChangePassword, onAbout }: { username: string; role: string; onLogout: () => void; onChangePassword: () => void; onAbout: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium hover:bg-white/10 transition-colors">
        <User size={15} />
        <span>{username}</span>
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 rounded-md border border-white/20 bg-slate-800 shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 text-[11px] text-gray-400 border-b border-white/10">{role}</div>
          <button onClick={() => { onChangePassword(); setOpen(false) }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-white/10 transition-colors">
            <Lock size={13} />
            {t('imageService.auth.changePassword')}
          </button>
          <button onClick={() => { onAbout(); setOpen(false) }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-white/10 transition-colors">
            <Info size={13} />
            {t('imageService.about.title')}
          </button>
          <button onClick={() => { onLogout(); setOpen(false) }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-white/10 transition-colors">
            <LogOut size={13} />
            {t('imageService.auth.logout')}
          </button>
        </div>
      )}
    </div>
  )
}

function SettingsNavGroup({ settingsSubItems, locationPath, t, collapsed }: {
  settingsSubItems: { path: string; labelKey: string; icon: any; permission: string }[]
  locationPath: string
  t: (key: string) => string
  collapsed?: boolean
}) {
  const { user } = useAuth()
  const { theme } = useTheme()
  // Closed until wanted, so the daily menu stays short; opens by itself on a page inside it.
  const onSettingsPage = settingsSubItems.some(item => locationPath === item.path)
  const [open, setOpen] = useState(onSettingsPage)
  useEffect(() => {
    if (onSettingsPage) setOpen(true)
  }, [onSettingsPage])

  // The audit log covers every camera, so a person limited to some is not offered it.
  const visibleItems = settingsSubItems.filter(item => hasPermission(user, item.permission) && (!(item as { allCameras?: boolean }).allCameras || user?.allCameras !== false))
  if (visibleItems.length === 0) return null

  const isInSettings = visibleItems.some(item => locationPath === item.path)
  const SettingsIcon = settingsSubItems[0].icon

  if (collapsed) {
    return (
      <Link
        to={visibleItems[0].path}
        className={`flex items-center justify-center p-2 rounded-lg text-sm font-medium transition-colors ${sidebarItemClasses(theme, isInSettings)}`}
        title={t(`imageService.${settingsSubItems[0].labelKey}`)}
      >
        <SettingsIcon size={16} className="flex-shrink-0" />
      </Link>
    )
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${sidebarItemClasses(theme, isInSettings)}`}
      >
        <SettingsIcon size={16} />
        <span className="flex-1 text-left">{t(`imageService.${settingsSubItems[0].labelKey}`)}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className={`ml-3 mt-0.5 space-y-0.5 border-l ${sidebarBorderClass(theme)} pl-2`}>
          {visibleItems.map(item => {
            const Icon = item.icon
            const isActive = locationPath === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${sidebarItemClasses(theme, isActive, true)}`}
              >
                <Icon size={14} />
                {t(`imageService.${item.labelKey}`)}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

type NavItem = { path: string; labelKey: string; icon: any; permission: string; anyOf?: string[]; activeOn?: string[] }

// [R2.4] UI routes moved from /image-service/* to /cctv/*; saved menu preferences may hold old paths.
function migrateMenuPaths(paths: string[]): string[] {
  return paths.map(p => (typeof p === 'string' ? p.replace(/^\/image-service\//, '/cctv/') : p))
}

// Old bookmarks and Telegram links keep working: /image-service/x?y -> /cctv/x?y
function LegacyRouteRedirect() {
  const location = useLocation()
  const target = location.pathname.replace(/^\/image-service\//, '/cctv/') + location.search + location.hash
  return <Navigate to={target} replace />
}

// Hook: returns nav items ordered by a per-user saved order, with reorder handlers
function useSidebarOrder(username: string | undefined, items: NavItem[]) {
  const storageKey = username ? `sidebar-nav-order:${username}` : ''
  const [order, setOrder] = useState<string[]>(() => {
    if (!storageKey) return []
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? migrateMenuPaths(JSON.parse(raw)) : []
    } catch { return [] }
  })

  // Re-read when the user changes
  useEffect(() => {
    if (!storageKey) { setOrder([]); return }
    try {
      const raw = localStorage.getItem(storageKey)
      setOrder(raw ? migrateMenuPaths(JSON.parse(raw)) : [])
    } catch { setOrder([]) }
  }, [storageKey])

  const persist = useCallback((next: string[]) => {
    setOrder(next)
    if (storageKey) {
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* ignore */ }
    }
  }, [storageKey])

  // Items sorted by saved order; unknown items keep original order at the end
  const ordered = useMemo(() => {
    if (order.length === 0) return items
    const indexOf = (p: string) => {
      const i = order.indexOf(p)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    return [...items].sort((a, b) => {
      const ia = indexOf(a.path), ib = indexOf(b.path)
      if (ia !== ib) return ia - ib
      return items.indexOf(a) - items.indexOf(b)
    })
  }, [items, order])

  // Move item from one path-position to before another; operates on current visible order
  const reorder = useCallback((fromPath: string, toPath: string, visiblePaths: string[]) => {
    if (fromPath === toPath) return
    const next = [...visiblePaths]
    const from = next.indexOf(fromPath)
    const to = next.indexOf(toPath)
    if (from === -1 || to === -1) return
    next.splice(from, 1)
    next.splice(to, 0, fromPath)
    persist(next)
  }, [persist])

  const reset = useCallback(() => persist([]), [persist])

  return { ordered, reorder, reset }
}

function SidebarNav({ navItems, settingsSubItems, user, locationPath, t, onNavigate, collapsed, onToggleCollapse, updateHiddenMenuItems }: {
  navItems: NavItem[]
  settingsSubItems: NavItem[]
  user: any
  locationPath: string
  t: (key: string) => string
  onNavigate: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
  updateHiddenMenuItems: (hiddenMenuItems: string[]) => Promise<void>
}) {
  // Shares the bell's query, so both always show the same number.
  const { data: alertCountData } = useQuery({
    queryKey: ['unacknowledged-count'],
    queryFn: () => imageServiceApi.getUnacknowledgedCount(),
    refetchInterval: 1000 * 15,
    staleTime: 1000 * 10,
  })
  const alertCount: number = alertCountData?.count ?? 0
  const badgeOf = (path: string) => (path === '/cctv/incidents' ? openCount : path === '/cctv/alerts' ? alertCount : 0)
  const { theme } = useTheme()
  const visibleNav = useMemo(() => navItems.filter(item => (item.anyOf ?? [item.permission]).some(p => hasPermission(user, p))), [navItems, user])
  const { ordered, reorder, reset } = useSidebarOrder(user?.username, visibleNav)
  const [reorderMode, setReorderMode] = useState(false)
  const [dragPath, setDragPath] = useState<string | null>(null)
  const [overPath, setOverPath] = useState<string | null>(null)

  const { data: openIncidents } = useQuery({
    queryKey: ['sidebar-open-incidents-count'],
    queryFn: () => imageServiceApi.searchIncidents({ status: 'open', limit: 1 }),
    refetchInterval: 1000 * 15,
    staleTime: 1000 * 10,
    enabled: hasPermission(user, 'cameras:read'),
  })
  // Whoever checks work also needs to see what is waiting for them.
  const { data: pendingIncidents } = useQuery({
    queryKey: ['sidebar-pending-incidents-count'],
    queryFn: () => imageServiceApi.searchIncidents({ status: 'pending', limit: 1 }),
    refetchInterval: 1000 * 15,
    staleTime: 1000 * 10,
    enabled: hasPermission(user, 'incidents:verify'),
  })
  const openCount = (openIncidents?.pagination?.total ?? 0) + (pendingIncidents?.pagination?.total ?? 0)

  const visiblePaths = ordered.map(i => i.path)

  const handleDrop = (toPath: string) => {
    if (dragPath) reorder(dragPath, toPath, visiblePaths)
    setDragPath(null)
    setOverPath(null)
  }

  const hiddenPaths: string[] = Array.isArray(user?.hiddenMenuItems) ? migrateMenuPaths(user.hiddenMenuItems) : []
  const hiddenSet = new Set(hiddenPaths)
  const toggleHidden = (path: string) => {
    const next = hiddenSet.has(path) ? hiddenPaths.filter(p => p !== path) : [...hiddenPaths, path]
    updateHiddenMenuItems(next).catch(() => {})
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className={`flex-1 overflow-y-auto ${collapsed ? 'px-1.5' : 'px-3'} py-4 space-y-1`}>
        {ordered.map(item => {
          const Icon = item.icon
          const isActive = locationPath === item.path || !!item.activeOn?.includes(locationPath)
          const isDragging = dragPath === item.path
          const isOver = overPath === item.path && dragPath !== item.path
          const isHidden = hiddenSet.has(item.path)
          if (!reorderMode && isHidden) return null
          return (
            <div
              key={item.path}
              draggable={reorderMode}
              onDragStart={reorderMode ? () => setDragPath(item.path) : undefined}
              onDragOver={reorderMode ? (e) => { e.preventDefault(); setOverPath(item.path) } : undefined}
              onDragLeave={reorderMode ? () => setOverPath(p => (p === item.path ? null : p)) : undefined}
              onDrop={reorderMode ? (e) => { e.preventDefault(); handleDrop(item.path) } : undefined}
              onDragEnd={reorderMode ? () => { setDragPath(null); setOverPath(null) } : undefined}
              className={`${isDragging ? 'opacity-50' : ''} ${isOver ? 'border-t-2 border-cyan-400' : 'border-t-2 border-transparent'}`}
            >
              {reorderMode ? (
                <div
                  className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2 px-3'} py-2 rounded-lg text-sm font-medium cursor-grab active:cursor-grabbing ${sidebarItemClasses(theme, isActive)} ${isHidden ? 'opacity-50' : ''}`}
                  title={collapsed ? t(`imageService.${item.labelKey}`) : undefined}
                >
                  {collapsed ? (
                    <Icon size={16} className="flex-shrink-0" />
                  ) : (
                    <>
                      <GripVertical size={14} className="text-gray-500 flex-shrink-0" />
                      <Icon size={16} />
                      <span className="truncate flex-1">{t(`imageService.${item.labelKey}`)}</span>
                      <button
                        type="button"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleHidden(item.path) }}
                        title={isHidden ? t('imageService.nav.showMenuItem') : t('imageService.nav.hideMenuItem')}
                        className="p-1 rounded hover:bg-white/10 flex-shrink-0"
                      >
                        {isHidden ? <EyeOff size={13} className="text-gray-500" /> : <Eye size={13} className="text-gray-400" />}
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <Link
                  to={item.path}
                  onClick={onNavigate}
                  className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2 rounded-lg text-sm font-medium transition-colors ${sidebarItemClasses(theme, isActive)}`}
                  title={collapsed ? t(`imageService.${item.labelKey}`) : undefined}
                >
                  {collapsed ? (
                    <div className="relative">
                      <Icon size={16} className="flex-shrink-0" />
                      {badgeOf(item.path) > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center animate-pulse z-10">
                          {badgeOf(item.path) > 99 ? '99+' : badgeOf(item.path)}
                        </span>
                      )}
                    </div>
                  ) : (
                    <>
                      <Icon size={16} className="flex-shrink-0" />
                      <span className="truncate">{t(`imageService.${item.labelKey}`)}</span>
                      {badgeOf(item.path) > 0 && (
                        <span className="ml-auto w-5 h-5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center animate-pulse flex-shrink-0">
                          {badgeOf(item.path) > 99 ? '99+' : badgeOf(item.path)}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              )}
            </div>
          )
        })}

        <div onClick={(e) => { if ((e.target as HTMLElement).closest('a')) onNavigate() }}>
          <SettingsNavGroup
            settingsSubItems={settingsSubItems}
            locationPath={locationPath}
            t={t}
            collapsed={collapsed}
          />
        </div>
      </div>

      {/* Reorder toggle row — bottom */}
      <div className={`flex-shrink-0 p-3 border-t ${sidebarBorderClass(theme)} ${collapsed ? (theme === 'light' ? 'bg-gray-50' : 'bg-black/10') : ''}`}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            {/* Expand button */}
            <button
              onClick={onToggleCollapse}
              title={t('common.expandSidebar')}
              className={`flex items-center justify-center p-2 rounded-md transition-colors ${sidebarItemClasses(theme, false, true)}`}
            >
              <ChevronRight size={14} className="flex-shrink-0" />
            </button>
            {/* Reorder button */}
            <button
              onClick={() => setReorderMode(v => !v)}
              title={reorderMode ? t('imageService.nav.reorderDone') : t('imageService.nav.reorderMenu')}
              className={`flex items-center justify-center p-2 rounded-md text-[11px] font-medium transition-colors ${sidebarItemClasses(theme, reorderMode, true)}`}
            >
              <ArrowDownUp size={13} className="flex-shrink-0" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-1">
            {/* Collapse button on the left */}
            <button
              onClick={onToggleCollapse}
              title={t('common.collapseSidebar')}
              className={`flex items-center p-2 rounded-md transition-colors ${sidebarItemClasses(theme, false, true)}`}
            >
              <ChevronLeft size={14} className="flex-shrink-0" />
            </button>

            {/* Reorder & Reset buttons on the right */}
            <div className="flex items-center gap-1.5">
              {reorderMode && (
                <button
                  onClick={reset}
                  title={t('imageService.nav.resetOrder')}
                  className={`flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] transition-colors ${sidebarItemClasses(theme, false, true)}`}
                >
                  <RotateCcw size={12} className="flex-shrink-0" />
                  {t('imageService.nav.resetOrder')}
                </button>
              )}
              <button
                onClick={() => setReorderMode(v => !v)}
                title={reorderMode ? t('imageService.nav.reorderDone') : t('imageService.nav.reorderMenu')}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${sidebarItemClasses(theme, reorderMode, true)}`}
              >
                <ArrowDownUp size={13} className="flex-shrink-0" />
                {reorderMode ? t('imageService.nav.reorderDone') : t('imageService.nav.reorderMenu')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AboutModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()
  const { data: configs } = useQuery({
    queryKey: ['system-branding'],
    queryFn: () => imageServiceApi.getSystemBranding(),
    enabled: isOpen,
  })
  const configMap: Record<string, any> = configs ?? {}
  const version = configMap.system_version?.value ?? '1.0.0'

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <Info size={16} className="text-cyan-400" />
          <span>{t('imageService.about.title')}</span>
        </div>
      }
    >
      <div className="flex flex-col items-center pt-2">
        {/* Logo */}
        {configMap.system_logo?.value ? (
          <img src={configMap.system_logo.value} alt={t('ui.app.logo')} className="h-16 w-auto object-contain mb-4" />
        ) : (
          <Camera size={48} className="text-cyan-400 mb-4" />
        )}

        {/* Title */}
        <h3 className={`text-xl font-bold text-center tracking-wide ${themeConfig.text.primary}`}>
          {configMap.system_name?.value ?? 'iSmart CCTV'}
        </h3>

        {/* Subtitle */}
        <p className="text-[10px] font-bold tracking-wider text-center text-gray-400 uppercase mt-1">
          {configMap.system_description?.value ?? 'Enterprise CCTV Management System'}
        </p>

        {/* Version Pill */}
        <div className="mt-4">
          <span className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-semibold bg-white/5 border border-white/10 text-gray-300">
            {t('ui.app.version')}{' '}{version}
          </span>
        </div>

        {/* Divider */}
        <div className="w-full border-t border-white/10 my-6"></div>

        {/* Footer / Developer Copyright */}
        <p className="text-xs text-center text-gray-400">
          {configMap.system_copyright?.value ?? `© ${new Date().getFullYear()} iSmart CCTV. All rights reserved.`}
        </p>
      </div>
    </Modal>
  )
}

function ChangePasswordModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const { changePassword } = useAuth()
  const toast = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (newPassword !== confirmPassword) { toast.error(t('imageService.auth.passwordMismatch')); return }
    if (newPassword.length < 10) { toast.error(t('imageService.auth.passwordTooShort')); return }
    setSubmitting(true)
    try {
      await changePassword(currentPassword, newPassword)
      toast.success(t('imageService.auth.passwordChanged'))
      onClose()
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
    } catch (err: any) {
      // Surface the backend's actual reason (wrong current password / new password too
      // weak or common / same as current) instead of a generic failure toast — same
      // string-matching pattern used throughout this app's error translation.
      const msg: string | undefined = err?.response?.data?.message
      if (msg?.toLowerCase().includes('current password is incorrect')) toast.error(t('imageService.auth.currentPasswordIncorrect'))
      else if (msg?.toLowerCase().includes('must be different')) toast.error(t('imageService.auth.passwordSameAsOld'))
      else if (msg?.toLowerCase().includes('too common')) toast.error(t('imageService.auth.passwordTooWeak'))
      else if (msg?.toLowerCase().includes('at least 10 character')) toast.error(t('imageService.auth.passwordTooShort'))
      else toast.error(t('common.error'))
    }
    finally { setSubmitting(false) }
  }

  const inputClass = `w-full px-3 py-2 rounded-md text-sm border border-white/30 bg-white/10 backdrop-blur-md text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50`

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('imageService.auth.changePassword')}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-white mb-1">{t('imageService.auth.currentPassword')}</label>
          {/* No show/hide toggle here on purpose — this is the account's existing
              password, not something being composed; a toggle would let anyone who
              walks up to an unlocked session reveal it. */}
          <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-white mb-1">{t('imageService.auth.newPassword')}</label>
          <PasswordInput value={newPassword} onChange={e => setNewPassword(e.target.value)} className={inputClass} />
          <PasswordStrengthMeter password={newPassword} />
        </div>
        <div>
          <label className="block text-sm font-medium text-white mb-1">{t('imageService.auth.confirmPassword')}</label>
          <PasswordInput value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className={inputClass} />
          {confirmPassword && (
            <p className={`text-[11px] mt-1 ${newPassword === confirmPassword ? 'text-emerald-400' : 'text-red-400'}`}>
              {newPassword === confirmPassword ? t('imageService.auth.passwordsMatch') : t('imageService.auth.passwordsDontMatch')}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={submitting || !currentPassword || !newPassword || !confirmPassword}>
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default function App() {
  const { t, i18n } = useTranslation()
  const { themeConfig, theme, setTheme } = useTheme()
  const { isAuthenticated, user, logout, updateHiddenMenuItems } = useAuth()
  const toast = useToast()
  const location = useLocation()
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [aboutModalOpen, setAboutModalOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true')

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev
      localStorage.setItem('sidebar-collapsed', String(next))
      return next
    })
  }

  // Close the mobile drawer whenever the route changes
  useEffect(() => { setMobileMenuOpen(false) }, [location.pathname])

  useEffect(() => {
    setForbiddenHandler((msg) => {
      // Show the backend's actual message (e.g. "Insufficient permission. Required: storage:read")
      // alongside the generic translated heading — the generic text alone gives no clue which
      // permission is actually missing, which makes this class of bug very hard to track down.
      const heading = t('imageService.auth.forbidden')
      toast.error(msg && msg !== 'Permission denied' ? `${heading}: ${msg}` : heading)
    })
  }, [t, toast])

  // Synchronize theme based on login status and user preference
  useEffect(() => {
    if (isAuthenticated && user?.username) {
      const userTheme = localStorage.getItem(`image-service-theme:${user.username}`) || 'modern'
      if (userTheme !== theme) {
        setTheme(userTheme)
      }
    } else if (!isAuthenticated) {
      if (theme !== 'modern') {
        setTheme('modern')
      }
    }
  }, [isAuthenticated, user?.username, theme, setTheme])
  const { data: sysConfig } = useQuery({
    queryKey: ['system-branding'],
    queryFn: () => imageServiceApi.getSystemBranding(),
  })
  const configMap: Record<string, any> = sysConfig ?? {}
  const logoBase64 = configMap.system_logo?.value

  // Dynamically update browser tab title and favicon based on system configuration
  useEffect(() => {
    const systemName = configMap.system_name?.value || 'iSmart CCTV';
    document.title = systemName;

    let faviconLink = document.querySelector("link[rel*='icon']") as HTMLLinkElement | null;
    if (!faviconLink) {
      faviconLink = document.createElement('link');
      faviconLink.rel = 'icon';
      document.head.appendChild(faviconLink);
    }
    if (logoBase64) {
      faviconLink.href = logoBase64;
    } else {
      faviconLink.href = '/vite.svg';
    }
  }, [configMap.system_name?.value, logoBase64]);

  if (!isAuthenticated) return <LoginPage logoBase64={logoBase64} />

  return (
    <div className={`h-screen overflow-hidden flex flex-col ${themeConfig.background} ${themeConfig.text.primary}`}>
      {/* Top Navbar */}
      <header className={`${themeConfig.navBar} px-5 py-2.5 flex items-center justify-between flex-shrink-0 z-40`}>
        <div className="flex items-center gap-3">
          {/* Hamburger (mobile only) */}
          <button
            onClick={() => setMobileMenuOpen(v => !v)}
            className="md:hidden flex items-center p-1.5 rounded-md hover:bg-white/10 transition-colors"
            aria-label={t('ui.app.toggleMenu')}
          >
            {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>

          <div className="flex items-center gap-2">
            {logoBase64 ? (
              <img src={logoBase64} alt={t('ui.app.logo')} className="h-7 w-7 rounded object-contain" />
            ) : (
              <Camera size={22} className="text-cyan-400" />
            )}
            <span className="text-sm font-bold tracking-tight">iSmart CCTV</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Processing indicator */}
          {/* Search */}
          <div className="hidden md:block">
            <NavSearch />
          </div>
          {/* Notifications - always visible */}
          <NavBell />
          {/* Language */}
          <div className="hidden sm:block">
            <LanguageDropdown lang={i18n.language} onChange={v => { i18n.changeLanguage(v); localStorage.setItem('i18nextLng', v) }} />
          </div>
          <button
            onClick={() => {
              const keys = Object.keys(themes)
              const idx = keys.indexOf(theme)
              setTheme(keys[(idx + 1) % keys.length])
            }}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium hover:bg-white/10 transition-colors"
            title={t('imageService.settings.theme')}
          >
            <Palette size={15} />
            <span>{t(THEME_OPTIONS.find(o => o.value === theme)?.labelKey ?? 'ui.app.themeModern')}</span>
          </button>
          <div className="hidden sm:block w-px h-5 mx-1 bg-white/10" />
          <ProfileMenu
            username={user?.username ?? 'admin'}
            role={user?.role ?? 'viewer'}
            onLogout={logout}
            onChangePassword={() => setPasswordModalOpen(true)}
            onAbout={() => setAboutModalOpen(true)}
          />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile backdrop */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`flex-shrink-0 ${themeConfig.sidebar} flex flex-col overflow-hidden h-full
            fixed inset-y-0 left-0 z-50 transform transition-all duration-200 ease-in-out
            ${sidebarCollapsed ? 'md:w-16' : 'md:w-56'} w-56
            ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
            md:relative md:translate-x-0 md:z-auto md:inset-auto`}
        >
          <SidebarNav
            navItems={navItems}
            settingsSubItems={settingsSubItems}
            user={user}
            locationPath={location.pathname}
            t={t}
            onNavigate={() => setMobileMenuOpen(false)}
            collapsed={sidebarCollapsed}
            onToggleCollapse={toggleSidebar}
            updateHiddenMenuItems={updateHiddenMenuItems}
          />
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          <PageErrorBoundary key={location.pathname}>
          <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full" /></div>}>
          <Routes>
            <Route path="/cctv/overview" element={
              hasPermission(user, 'overview:read') ? <CctvDashboard /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/cameras" element={
              hasPermission(user, 'cameras:read') ? <ImageServiceCameras /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/camera-groups" element={
              hasPermission(user, 'cameras:read') ? <CameraGroups /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/live-grid" element={
              hasPermission(user, 'cameras:read') ? <LiveGrid /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/playback" element={
              hasPermission(user, 'cameras:read') ? <CctvPlayback /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/devices" element={
              hasPermission(user, 'cameras:read') ? <DeviceManagement /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/sites" element={
              hasPermission(user, 'cameras:read') ? <SiteManagement /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/map" element={
              hasPermission(user, 'cameras:read') ? <CctvMap /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/media-nodes" element={
              hasPermission(user, 'cameras:read') ? <MediaNodeManagement /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/release" element={
              hasPermission(user, 'settings:read') ? <CctvReleaseCenter /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/cameras/:id" element={
              hasPermission(user, 'cameras:read') ? <ImageServiceCameraDetail /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/camera-analytics" element={
              hasPermission(user, 'cameras:read') ? <CameraAnalytics /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/incidents" element={
              hasPermission(user, 'cameras:read') ? <IncidentCenter /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/work-orders" element={
              hasPermission(user, 'cameras:read') ? <WorkOrders /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/reports" element={
              hasPermission(user, 'cameras:read') ? <ImageServiceReports /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/camera-templates" element={
              hasPermission(user, 'cameras:read') ? <CameraTemplates /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/storage-providers" element={
              hasPermission(user, 'storage:read') ? <StorageProvidersPage /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/audit-log" element={
              hasPermission(user, 'audit-log:read') && user?.allCameras !== false ? <AuditLogViewer /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/backup" element={
              hasPermission(user, 'backup:read') ? <BackupDashboard /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/retention" element={
              hasPermission(user, 'retention:read') ? <ImageServiceRetention /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/roadmap" element={
              hasPermission(user, 'roadmap:read') ? <ImageServiceRoadmap /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/alerts" element={
              hasPermission(user, 'alerts:read') ? <AlertManagement /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/users" element={
              hasPermission(user, 'users:read') ? <UserManagement /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/health" element={
              hasPermission(user, 'health:read') ? <HealthStatus /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/api-keys" element={
              hasPermission(user, 'api-keys:read') ? <ApiKeysManagement /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/telegram-bot" element={
              hasPermission(user, 'telegram-bot:read') ? <TelegramBotSettings /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/masterdata" element={
              MASTERDATA_PAGE_PERMISSIONS.some(p => hasPermission(user, p)) ? <MasterdataManagement /> : <UnauthorizedPage />
            } />
             <Route path="/cctv/system-config" element={
              hasPermission(user, 'system-config:read') ? <SystemConfigPage /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/required-fields" element={
              hasPermission(user, 'system-config:read') ? <RequiredFieldsSettings /> : <UnauthorizedPage />
            } />
            <Route path="/cctv/settings" element={
              hasPermission(user, 'settings:read') ? <ImageServiceSettings /> : <UnauthorizedPage />
            } />
            <Route path="/image-service/*" element={<LegacyRouteRedirect />} />
            <Route path="/" element={<Navigate to="/cctv/overview" replace />} />
            <Route path="*" element={<Navigate to="/cctv/overview" replace />} />
          </Routes>
          </Suspense>
          </PageErrorBoundary>
        </main>
      </div>
      <ChangePasswordModal isOpen={passwordModalOpen} onClose={() => setPasswordModalOpen(false)} />
      <AboutModal isOpen={aboutModalOpen} onClose={() => setAboutModalOpen(false)} />
    </div>
  )
}
