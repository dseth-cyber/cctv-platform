import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/contexts/ThemeContext'
import { imageServiceApi } from '@/services/imageServiceApi'
import {
  Microscope, Camera, Database, Server, Activity, CheckCircle2, Clock, Kanban,
  ArrowRight, HardDrive, Shield, Wifi, Bug, Lock, FileText, Cpu, Palette, Layout,
  BookText, MessageCircle, Settings, GitBranch, Layers, ChevronDown, ChevronRight, Wrench,
  Globe, Smartphone, Video, ShoppingBag, MessageSquare, Box, Package, UserCheck, Search
} from 'lucide-react'

const PHASE_STATUS_STYLES: Record<string, string> = {
  Launched: 'bg-green-500/20 text-green-400',
  'In Progress': 'bg-blue-500/20 text-blue-400',
  Planned: 'bg-gray-500/20 text-gray-400',
}

// Feature Maturity Labels (P25). Derived from each phase's dev status rather than hand-tagged
// per feature, since maturity here tracks "how far along/production-ready" — the same axis
// status already tracks, just labeled the way a changelog/docs site would.
type Maturity = 'experimental' | 'beta' | 'stable' | 'enterprise' | 'deprecated'
const MATURITY_STYLES: Record<Maturity, string> = {
  experimental: 'bg-fuchsia-500/20 text-fuchsia-400',
  beta: 'bg-amber-500/20 text-amber-400',
  stable: 'bg-green-500/20 text-green-400',
  enterprise: 'bg-indigo-500/20 text-indigo-400',
  deprecated: 'bg-gray-500/20 text-gray-400 line-through',
}
function getMaturity(status: string): Maturity {
  if (status === 'Launched') return 'stable'
  if (status === 'In Progress') return 'beta'
  return 'experimental'
}

const PHASE_ICONS: Record<string, any> = {
  phase0: Activity,
  phase1: Wifi,
  phase2: Shield,
  phase3: Clock,
  phase4: Lock,
  phase5: Palette,
  phase6: Server,
  phase7: Kanban,
  phase8: MessageCircle,
  phase9: Settings,
  phase10: Clock,
  phase11: Activity,
  phase12: Server,
  phase13: Shield,
  phase14: FileText,
  phase15: HardDrive,
  phase16: GitBranch,
  phase17: Layers,
  phase18: Server,
  phase19: HardDrive,
  phase20: Activity,
  phase21: Wifi,
  phase22: Layers,
  phase23: Camera,
  phase24: Shield,
  phase25: Cpu,
  phase26: GitBranch,
  phase27: Wifi,
  phase28: Activity,
  phase29: FileText,
  phase30: Wrench,
  phase31: Activity,
  phase32: Activity,
  phase33: Layers,
  phase34: BookText,
  phase35: FileText,
  phase36: Palette,
  phase37: Wrench,
  phase38: Clock,
  phase39: Activity,
  phase40: Activity,
  phase41: Layout,
  phase42: Shield,
  phase43: GitBranch,
  phase44: Database,
  phase45: Layers,
  phase46: Cpu,
  phase47: Video,
  phase48: Server,
  phase49: Globe,
  phase50: Shield,
  phase51: GitBranch,
  phase52: Smartphone,
  phase53: Box,
  phase54: ShoppingBag,
  phase55: MessageSquare,
  phase56: Layout,
  phase57: GitBranch,
  phase58: Kanban,
  phase59: Clock,
  phase60: Activity,
  phase61: Package,
  phase62: UserCheck,
  phase63: HardDrive,
  phase64: Shield,
  phase65: Database,
}

const PHASES = [
  { key: 'phase0', status: 'Launched', priority: 'P0.1' },
  { key: 'phase1', status: 'Launched', priority: 'P0.2' },
  { key: 'phase2', status: 'Launched', priority: 'P0.3' },
  { key: 'phase3', status: 'Launched', priority: 'P1' },
  { key: 'phase4', status: 'Launched', priority: 'P2' },
  { key: 'phase5', status: 'Launched', priority: 'P3' },
  { key: 'phase6', status: 'Launched', priority: 'P4' },
  { key: 'phase7', status: 'Launched', priority: 'P5' },
  { key: 'phase8', status: 'Launched', priority: 'P6' },
  { key: 'phase9', status: 'Launched', priority: 'P7' },
  { key: 'phase10', status: 'Launched', priority: 'P8.1' },
  { key: 'phase11', status: 'Launched', priority: 'P8.2' },
  { key: 'phase12', status: 'Launched', priority: 'P8.3' },
  { key: 'phase13', status: 'Launched', priority: 'P8.4' },
  { key: 'phase14', status: 'Launched', priority: 'P8.5' },
  { key: 'phase15', status: 'Launched', priority: 'P9' },
  { key: 'phase16', status: 'Launched', priority: 'P9.1' },
  { key: 'phase17', status: 'Launched', priority: 'P9.2' },
  { key: 'phase18', status: 'Launched', priority: 'P9.3' },
  { key: 'phase19', status: 'Launched', priority: 'P10' },
  { key: 'phase20', status: 'Launched', priority: 'P11' },
  { key: 'phase21', status: 'Launched', priority: 'P12' },
  { key: 'phase22', status: 'Launched', priority: 'P13' },
  { key: 'phase23', status: 'Launched', priority: 'P14' },
  { key: 'phase24', status: 'Launched', priority: 'P15' },
  { key: 'phase25', status: 'Launched', priority: 'P16' },
  { key: 'phase26', status: 'Launched', priority: 'P17' },
  { key: 'phase27', status: 'Launched', priority: 'P18' },
  { key: 'phase28', status: 'Launched', priority: 'P19' },
  { key: 'phase29', status: 'Launched', priority: 'P20' },
  { key: 'phase30', status: 'Launched', priority: 'P21' },
  { key: 'phase33', status: 'Launched', priority: 'P22' },
  { key: 'phase34', status: 'Launched', priority: 'P23' },
  { key: 'phase35', status: 'Launched', priority: 'P24' },
  { key: 'phase36', status: 'Launched', priority: 'P25' },
  { key: 'phase44', status: 'Launched', priority: 'P26' },
  { key: 'phase58', status: 'Launched', priority: 'P49' },
  { key: 'phase59', status: 'Launched', priority: 'P50' },
  { key: 'phase45', status: 'Planned', priority: 'P27' },
  { key: 'phase37', status: 'Planned', priority: 'P28' },
  { key: 'phase38', status: 'Planned', priority: 'P29' },
  { key: 'phase39', status: 'Planned', priority: 'P30' },
  { key: 'phase40', status: 'Planned', priority: 'P31' },
  { key: 'phase41', status: 'Planned', priority: 'P32' },
  { key: 'phase42', status: 'Planned', priority: 'P33' },
  { key: 'phase43', status: 'Planned', priority: 'P34' },
  { key: 'phase31', status: 'Planned', priority: 'P35' },
  { key: 'phase32', status: 'Planned', priority: 'P36' },
  { key: 'phase46', status: 'Planned', priority: 'P37' },
  { key: 'phase47', status: 'Planned', priority: 'P38' },
  { key: 'phase48', status: 'Planned', priority: 'P39' },
  { key: 'phase49', status: 'Planned', priority: 'P40' },
  { key: 'phase50', status: 'Planned', priority: 'P41' },
  { key: 'phase51', status: 'Planned', priority: 'P42' },
  { key: 'phase52', status: 'Planned', priority: 'P43' },
  { key: 'phase53', status: 'Planned', priority: 'P44' },
  { key: 'phase54', status: 'Planned', priority: 'P45' },
  { key: 'phase55', status: 'Planned', priority: 'P46' },
  { key: 'phase56', status: 'Planned', priority: 'P47' },
  { key: 'phase57', status: 'Planned', priority: 'P48' },
  { key: 'phase60', status: 'In Progress', priority: 'P51' },
  { key: 'phase61', status: 'Launched', priority: 'P52' },
  { key: 'phase62', status: 'Planned', priority: 'P53' },
  { key: 'phase63', status: 'Planned', priority: 'P54' },
  { key: 'phase64', status: 'Launched', priority: 'P55' },
  { key: 'phase65', status: 'Planned', priority: 'P56' },
]

const PRIORITY_COLORS: Record<string, string> = {
  'P0.1': 'bg-red-500/20 text-red-400',
  'P0.2': 'bg-red-500/20 text-red-400',
  'P0.3': 'bg-red-500/20 text-red-400',
  P1: 'bg-orange-500/20 text-orange-400',
  P2: 'bg-yellow-500/20 text-yellow-400',
  P3: 'bg-blue-500/20 text-blue-400',
  P4: 'bg-purple-500/20 text-purple-400',
  P5: 'bg-cyan-500/20 text-cyan-400',
  P6: 'bg-pink-500/20 text-pink-400',
  P7: 'bg-gray-500/20 text-gray-400',
  'P8.1': 'bg-teal-500/20 text-teal-400',
  'P8.2': 'bg-teal-500/20 text-teal-400',
  'P8.3': 'bg-teal-500/20 text-teal-400',
  'P8.4': 'bg-teal-500/20 text-teal-400',
  'P8.5': 'bg-teal-500/20 text-teal-400',
  P9: 'bg-indigo-500/20 text-indigo-400',
  'P9.1': 'bg-indigo-500/20 text-indigo-400',
  'P9.2': 'bg-indigo-500/20 text-indigo-400',
  'P9.3': 'bg-indigo-500/20 text-indigo-400',
  P10: 'bg-emerald-500/20 text-emerald-400',
  P11: 'bg-rose-500/20 text-rose-400',
  P12: 'bg-sky-500/20 text-sky-400',
  P13: 'bg-amber-500/20 text-amber-400',
  P14: 'bg-lime-500/20 text-lime-400',
  P15: 'bg-red-500/20 text-red-400',
  P16: 'bg-orange-500/20 text-orange-400',
  P17: 'bg-violet-500/20 text-violet-400',
  P18: 'bg-sky-500/20 text-sky-400',
  P19: 'bg-emerald-500/20 text-emerald-400',
  P20: 'bg-fuchsia-500/20 text-fuchsia-400',
  P21: 'bg-teal-500/20 text-teal-400',
  P22: 'bg-blue-500/20 text-blue-400',
  P23: 'bg-purple-500/20 text-purple-400',
  P24: 'bg-cyan-500/20 text-cyan-400',
  P25: 'bg-emerald-500/20 text-emerald-400',
  P26: 'bg-orange-500/20 text-orange-400',
  P27: 'bg-teal-500/20 text-teal-400',
  P28: 'bg-blue-500/20 text-blue-400',
  P29: 'bg-purple-500/20 text-purple-400',
  P30: 'bg-cyan-500/20 text-cyan-400',
  P31: 'bg-lime-500/20 text-lime-400',
  P32: 'bg-indigo-500/20 text-indigo-400',
  P33: 'bg-rose-500/20 text-rose-400',
  P34: 'bg-sky-500/20 text-sky-400',
  P35: 'bg-pink-500/20 text-pink-400',
  P36: 'bg-emerald-500/20 text-emerald-400',
  P37: 'bg-blue-500/20 text-blue-400',
  P38: 'bg-purple-500/20 text-purple-400',
  P39: 'bg-cyan-500/20 text-cyan-400',
  P40: 'bg-emerald-500/20 text-emerald-400',
  P41: 'bg-rose-500/20 text-rose-400',
  P42: 'bg-sky-500/20 text-sky-400',
  P43: 'bg-pink-500/20 text-pink-400',
  P44: 'bg-amber-500/20 text-amber-400',
  P45: 'bg-violet-500/20 text-violet-400',
  P46: 'bg-teal-500/20 text-teal-400',
  P47: 'bg-indigo-500/20 text-indigo-400',
  P48: 'bg-fuchsia-500/20 text-fuchsia-400',
  P49: 'bg-amber-500/20 text-amber-400',
  P50: 'bg-emerald-500/20 text-emerald-400',
  P51: 'bg-sky-500/20 text-sky-400',
  P52: 'bg-pink-500/20 text-pink-400',
  P53: 'bg-amber-500/20 text-amber-400',
  P54: 'bg-red-500/20 text-red-400',
  P55: 'bg-emerald-500/20 text-emerald-400',
  P56: 'bg-emerald-500/20 text-emerald-400',
}

const STATUS_WEIGHTS: Record<string, number> = {
  Launched: 100,
  'In Progress': 50,
  Planned: 0,
}

const ARCH_ICONS = [Camera, Wifi, Cpu, Server, Layout, HardDrive, Activity]
const ARCH_COLORS = ['#06b6d4', '#10b981', '#f59e0b', '#8b5cf6', '#3b82f6', '#ef4444', '#22d3ee']

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i]
}

export default function ImageServiceRoadmap() {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set())
  const [statusFilter, setStatusFilter] = useState<'all' | 'Launched' | 'In Progress' | 'Planned'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const togglePhase = (i: number) => {
    setExpandedPhases(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const expandAll = () => setExpandedPhases(new Set(PHASES.map((_, i) => i)))
  const collapseAll = () => setExpandedPhases(new Set())

  const { data: cameras = [] } = useQuery({
    queryKey: ['cameras'],
    queryFn: () => imageServiceApi.getCameras(),
    staleTime: 1000 * 60 * 2,
  })

  const { data: policies = [] } = useQuery({
    queryKey: ['retention-policies'],
    queryFn: () => imageServiceApi.getRetentionPolicies(),
    staleTime: 1000 * 60 * 5,
  })

  const camerasArr = Array.isArray(cameras?.data) ? cameras.data : (Array.isArray(cameras) ? cameras : [])
  const policiesArr = Array.isArray(policies?.data) ? policies.data : (Array.isArray(policies) ? policies : [])

  const totalCameras = camerasArr.length
  const activeCameras = camerasArr.filter((c: any) => c.status === 'active').length

  const archStats = [
    { label: t('imageService.cameras.title'), value: String(totalCameras), sub: `${activeCameras} active`, icon: Camera, color: '#06b6d4' },
    { label: t('imageService.retention.title'), value: String(policiesArr.length), sub: t('imageService.settings.systemInfo'), icon: Shield, color: '#f59e0b' },
  ]

  const progressPct = Math.round(
    PHASES.reduce((sum, p) => sum + (STATUS_WEIGHTS[p.status] ?? 0), 0) / PHASES.length,
  )
  const launchedCount = PHASES.filter((p) => p.status === 'Launched').length
  const inProgressCount = PHASES.filter((p) => p.status === 'In Progress').length
  const plannedCount = PHASES.filter((p) => p.status === 'Planned').length

  const filteredPhases = PHASES.map((p, originalIndex) => ({ ...p, originalIndex })).filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const title = t(`imageService.roadmap.${p.key}`).toLowerCase()
      const desc = t(`imageService.roadmap.${p.key}Desc`).toLowerCase()
      const priority = p.priority.toLowerCase()
      return title.includes(q) || desc.includes(q) || priority.includes(q)
    }
    return true
  })

  const archStack = t('imageService.roadmap.archStack', { returnObjects: true }) as { label: string; tech: string; desc: string }[]

  return (
    <div className="p-6">
      <div className="mb-6">
        <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
          iSmart CCTV · {t('imageService.roadmap.title')}
        </p>
        <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>
          {t('imageService.roadmap.title')}
        </h1>
        <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>
          {t('imageService.roadmap.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* Card 1 — System Architecture */}
        <div className={`${themeConfig.card} rounded-lg p-4 flex flex-col`}>
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-lg bg-cyan-500/10">
              <Microscope size={15} className="text-cyan-400" />
            </div>
            <div>
              <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>
                {t('imageService.roadmap.architecture')}
              </h3>
              <p className={`text-xs ${themeConfig.text.secondary}`}>
                {t('imageService.roadmap.architectureDesc')}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {archStats.map((s, i) => {
              const Icon = s.icon
              return (
                <div key={i} className={`px-3 py-2 rounded-lg ${themeConfig.progressTrack}`}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Icon size={12} style={{ color: s.color }} />
                    <span className={`text-[11px] ${themeConfig.text.secondary}`}>{s.label}</span>
                  </div>
                  <p className="text-base font-bold" style={{ color: s.color }}>{s.value}</p>
                </div>
              )
            })}
          </div>
          <div className="space-y-1.5 overflow-y-auto max-h-[300px] pr-1">
            {archStack.map((group, i) => {
              const Icon = ARCH_ICONS[i]
              return (
                <div key={i} className={`px-3 py-2 rounded-lg bg-white/5`}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Icon size={11} style={{ color: ARCH_COLORS[i] }} />
                    <span className={`text-[11px] font-semibold ${themeConfig.text.primary}`}>{group.label}</span>
                    <span className="text-[10px] text-cyan-400/70 ml-auto font-mono">{group.tech}</span>
                  </div>
                  <p className={`text-[11px] leading-relaxed ${themeConfig.text.secondary}`}>{group.desc}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Card 3 — System Rules */}
        <div className={`${themeConfig.card} rounded-lg p-4 flex flex-col`}>
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-lg bg-red-500/10">
              <BookText size={15} className="text-red-400" />
            </div>
            <div>
              <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>
                {t('imageService.roadmap.rules')}
              </h3>
              <p className={`text-xs ${themeConfig.text.secondary}`}>
                {t('imageService.roadmap.rulesDesc')}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 overflow-y-auto max-h-[360px] pr-1">
            {['priority1', 'priority2', 'priority3', 'priority4', 'priority5', 'imageService'].map((group, gi) => {
              const rules = t(`imageService.roadmap.rulesGroups.${group}`, { returnObjects: true }) as string[]
              const groupLabels = t(`imageService.roadmap.rulesGroupsLabels.${group}`, { returnObjects: true }) as { icon: string; label: string; color: string }
              return (
                <div key={gi} className={`px-3 py-2 rounded-lg ${themeConfig.progressTrack}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: groupLabels.color }} />
                    <span className={`text-[11px] font-semibold ${themeConfig.text.primary}`}>{groupLabels.label}</span>
                  </div>
                  <ul className="space-y-0.5">
                    {(Array.isArray(rules) ? rules : []).map((rule, ri) => (
                      <li key={ri} className={`text-[11px] ${themeConfig.text.secondary} flex items-start gap-1`}>
                        <span className="text-cyan-400 mt-0.5 shrink-0">▸</span>
                        <span className="line-clamp-2">{rule}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Card 2 — Development Phases */}
      <div className={`${themeConfig.card} rounded-lg p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <ArrowRight size={18} className="text-purple-400" />
            </div>
            <div>
              <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>
                {t('imageService.roadmap.phases')}
              </h3>
              <p className={`text-xs ${themeConfig.text.secondary}`}>
                {t('imageService.roadmap.phasesDesc')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder={t('common.search', 'ค้นหาเฟสงาน...')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1 rounded-lg text-xs bg-white/5 border border-white/10 text-white placeholder-gray-400 focus:outline-none focus:border-cyan-500 w-44"
              />
            </div>
            <div className="flex items-center gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${statusFilter === 'all' ? 'bg-cyan-500 text-white font-medium' : 'text-gray-400 hover:text-white'}`}
              >
                {t('common.all', 'ทั้งหมด')} ({PHASES.length})
              </button>
              <button
                onClick={() => setStatusFilter('Launched')}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${statusFilter === 'Launched' ? 'bg-green-500 text-white font-medium' : 'text-gray-400 hover:text-white'}`}
              >
                {t('imageService.roadmap.phasesLaunched', 'เปิดใช้งานแล้ว')} ({launchedCount})
              </button>
              <button
                onClick={() => setStatusFilter('In Progress')}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${statusFilter === 'In Progress' ? 'bg-blue-500 text-white font-medium' : 'text-gray-400 hover:text-white'}`}
              >
                {t('common.inProgress', 'กำลังพัฒนา')} ({inProgressCount})
              </button>
              <button
                onClick={() => setStatusFilter('Planned')}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${statusFilter === 'Planned' ? 'bg-gray-600 text-white font-medium' : 'text-gray-400 hover:text-white'}`}
              >
                {t('common.planned', 'มีแผนพัฒนา')} ({plannedCount})
              </button>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className={`mb-5 px-4 py-3 rounded-lg bg-white/5`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-semibold ${themeConfig.text.primary}`}>
              {t('imageService.roadmap.phasesProgress', { pct: progressPct })}
            </span>
            <span className={`text-xs ${themeConfig.text.secondary}`}>
              {launchedCount}/{PHASES.length} {t('imageService.roadmap.phasesLaunched')}
            </span>
          </div>
          <div className={`h-2 rounded-full ${themeConfig.progressTrack} overflow-hidden`}>
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <div className="flex justify-between items-center mb-3">
          <span className={`text-xs ${themeConfig.text.secondary}`}>
            {t('ui.imageServiceRoadmap.showing')}{' '}{filteredPhases.length}{' '}{t('common.of')}{' '}{PHASES.length}{' '}{t('ui.imageServiceRoadmap.phases')}
          </span>
          <div className="flex gap-2">
            <button onClick={expandAll} className="px-2 py-1 rounded text-xs text-cyan-400 hover:bg-cyan-500/10 transition-colors">
              {t('common.expandAll', 'ขยายทั้งหมด')}
            </button>
            <button onClick={collapseAll} className="px-2 py-1 rounded text-xs text-gray-400 hover:bg-gray-500/10 transition-colors">
              {t('common.collapseAll', 'ย่อทั้งหมด')}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {filteredPhases.map((p) => {
            const Icon = PHASE_ICONS[p.key]
            const statusClass = PHASE_STATUS_STYLES[p.status] ?? 'bg-gray-500/20 text-gray-400'
            const maturity = getMaturity(p.status)
            const isExpanded = expandedPhases.has(p.originalIndex)
            const tasks = Array.isArray(t(`imageService.roadmap.${p.key}Tasks`, { returnObjects: true })) ? t(`imageService.roadmap.${p.key}Tasks`, { returnObjects: true }) as string[] : []
            return (
              <div key={p.key} className={`rounded-lg bg-white/5 overflow-hidden`}>
                <button onClick={() => togglePhase(p.originalIndex)} className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors text-left">
                  <div className={`p-1.5 rounded-full ${statusClass}`}>
                    <Icon size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-medium ${themeConfig.text.primary}`}>
                        {t(`imageService.roadmap.${p.key}`)}
                      </p>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${PRIORITY_COLORS[p.priority]}`}>
                        {p.priority}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${MATURITY_STYLES[maturity]}`}
                        title={t(`imageService.roadmap.maturityDesc.${maturity}`)}
                      >
                        {t(`imageService.roadmap.maturity.${maturity}`)}
                      </span>
                    </div>
                    <p className={`text-xs ${themeConfig.text.secondary}`}>
                      {t(`imageService.roadmap.${p.key}Desc`)}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusClass}`}>
                    {t(`imageService.roadmap.${p.key}Status`)}
                  </span>
                  {isExpanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                </button>
                {isExpanded && tasks.length > 0 && (
                  <div className="px-4 pb-3 ml-9 space-y-0.5">
                    {tasks.map((task: string, ti: number) => (
                      <p key={ti} className={`text-xs ${themeConfig.text.secondary} flex items-start gap-1.5`}>
                        <span className="text-cyan-400 mt-0.5">▸</span>
                        {task}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
