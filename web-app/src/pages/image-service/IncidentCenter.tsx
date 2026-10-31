import { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/contexts/ThemeContext'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/App'
import { imageServiceApi } from '@/services/imageServiceApi'
import { TableSkeleton, ExportButton, SearchableSelect, Modal } from '@/components/ui'
import { formatDateTime, toBangkokDateAndTimeString } from '@/utils/dateUtils'
import { getLocalizedValue } from '@/utils/textUtils'
import {
  ClipboardList, Search, Wrench,
  AlertTriangle, Clock, X, Trash2,
  ChevronUp, ChevronDown, ChevronsUpDown,
  Play, Radio, BellOff, ShieldCheck, CheckCircle2, XCircle, RefreshCw, Film,
} from 'lucide-react'
import { WhepPlayer } from '@/components/cctv/WhepPlayer'

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400',
  high: 'bg-orange-500/20 text-orange-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  low: 'bg-green-500/20 text-green-400',
}

const WORKFLOW_STAGE_COLORS: Record<string, string> = {
  unassigned: 'bg-gray-500/20 text-gray-400',
  assigned: 'bg-blue-500/20 text-blue-400',
  in_progress: 'bg-purple-500/20 text-purple-400',
  waiting_parts: 'bg-amber-500/20 text-amber-400',
  waiting_vendor: 'bg-orange-500/20 text-orange-400',
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-500/20 text-blue-400',
  resolved: 'bg-green-500/20 text-green-400',
}

const WO_STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-500/20 text-blue-400',
  in_progress: 'bg-yellow-500/20 text-yellow-400',
  completed: 'bg-green-500/20 text-green-400',
}



function formatMttr(minutes: number | null | undefined, ic: (k: string) => string): string {
  if (minutes == null) return '—'
  if (minutes < 60) return `${minutes}${ic('unitMinute')}`
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}${ic('unitHour')}`
  return `${(minutes / 1440).toFixed(1)}${ic('unitDay')}`
}

const CAMERA_STATUS_KEYS: Record<string, string> = {
  active: 'imageService.cameras.statusActive',
  maintenance: 'imageService.cameras.statusMaintenance',
  inactive: 'imageService.cameras.statusInactive',
  error: 'imageService.cameras.statusError',
}

const PRIORITY_KEYS: Record<string, string> = {
  critical: 'imageService.incidentCenter.priorityCritical',
  high: 'imageService.incidentCenter.priorityHigh',
  medium: 'imageService.incidentCenter.priorityMedium',
  low: 'imageService.incidentCenter.priorityLow',
}

function translatePriority(priority: string | null | undefined, t: any): string {
  if (!priority) return '—'
  return t(PRIORITY_KEYS[priority] || '', { defaultValue: priority })
}

// Backend-formatted durations ("4m 59s", "1.5h", "27s ago", "never") are built
// from plain English unit letters with no notion of the viewer's language —
// translate the unit letters (and "ago"/"never") in place, keeping the numbers.
function translateDuration(raw: string | null | undefined, t: any): string {
  if (!raw) return raw ?? ''
  if (raw === 'never') return t('imageService.incidentCenter.never')
  const hasAgo = /\s*ago$/.test(raw)
  let base = raw.replace(/\s*ago$/, '')
  base = base
    .replace(/(\d+(?:\.\d+)?)h\b/g, (_, n) => `${n}${t('imageService.incidentCenter.unitHour')}`)
    .replace(/(\d+(?:\.\d+)?)m\b/g, (_, n) => `${n}${t('imageService.incidentCenter.unitMinute')}`)
    .replace(/(\d+(?:\.\d+)?)s\b/g, (_, n) => `${n}${t('imageService.incidentCenter.unitSecond')}`)
    .replace(/(\d+(?:\.\d+)?)d\b/g, (_, n) => `${n}${t('imageService.incidentCenter.unitDay')}`)
  return hasAgo ? t('imageService.incidentCenter.durationAgo', { duration: base }) : base
}

// The camera health monitor (a backend cron job with no notion of a viewer's
// language) writes plain English sentences straight into CameraEvent.message,
// Incident.description and Incident.resolution. Same fix as Audit Log's
// localizeDescription(): pattern-match the known templates here and rebuild a
// translated string with the embedded values, instead of showing raw English.
function localizeHealthMonitorText(text: string | null | undefined, t: any): string | null {
  if (!text) return text ?? null

  let m = text.match(/^Camera "([^"]+)" went offline \(status: ([^,]+), last poll: (.+)\)$/)
  if (m) {
    const [, name, status, lastPoll] = m
    const statusLabel = t(CAMERA_STATUS_KEYS[status] || '', { defaultValue: status })
    return t('imageService.incidentCenter.evtWentOffline', { name, status: statusLabel, lastPoll: translateDuration(lastPoll, t) })
  }

  m = text.match(/^Auto-detected: no successful poll for over (\d+) minute\(s\)\.$/)
  if (m) return t('imageService.incidentCenter.descAutoDetected', { min: m[1] })

  m = text.match(/^Camera "([^"]+)" is responding again — confirming stability before marking online$/)
  if (m) return t('imageService.incidentCenter.evtRespondingAgain', { name: m[1] })

  m = text.match(/^Camera "([^"]+)" is back online\. Downtime: (.+)$/)
  if (m) return t('imageService.incidentCenter.evtBackOnlineWithDowntime', { name: m[1], duration: translateDuration(m[2], t) })

  m = text.match(/^Camera "([^"]+)" is back online$/)
  if (m) return t('imageService.incidentCenter.evtBackOnline', { name: m[1] })

  m = text.match(/^Camera reconnected automatically after (.+) offline\.$/)
  if (m) return t('imageService.incidentCenter.resolutionAutoReconnected', { duration: translateDuration(m[1], t) })

  m = text.match(/^Camera "([^"]+)" status changed: ([^\s]+) → ([^\s]+)$/)
  if (m) {
    const [, name, from, to] = m
    const fromLabel = t(CAMERA_STATUS_KEYS[from] || '', { defaultValue: from })
    const toLabel = t(CAMERA_STATUS_KEYS[to] || '', { defaultValue: to })
    return t('imageService.incidentCenter.evtStatusChanged', { name, from: fromLabel, to: toLabel })
  }

  return text
}

function AttachmentImage({ filename, alt }: { filename: string; alt: string }) {
  const [url, setUrl] = useState<string>('')
  const [zoom, setZoom] = useState(false)
  useEffect(() => {
    let active = true
    let objectUrl = ''
    imageServiceApi.getIncidentAttachmentBlob(filename)
      .then((blob: Blob) => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {})
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [filename])
  if (!url) return <div className="w-24 h-24 rounded-lg bg-white/5 animate-pulse" />
  return (
    <>
      <img src={url} alt={alt} onClick={() => setZoom(true)}
        className="w-24 h-24 rounded-lg object-cover border border-white/10 cursor-zoom-in hover:opacity-80 transition-opacity" />
      {zoom && createPortal(
        <div onClick={() => setZoom(false)}
          className="fixed inset-0 z-[99999] bg-black/85 flex items-center justify-center p-4 cursor-zoom-out">
          <img src={url} alt={alt} className="max-w-[95vw] max-h-[95vh] object-contain rounded-lg shadow-2xl" />
          <button onClick={() => setZoom(false)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white">
            <X size={20} />
          </button>
        </div>,
        document.body
      )}
    </>
  )
}

export default function IncidentCenter() {
  const { t: rawT, i18n } = useTranslation()
  const t = (k: string, ...args: any[]): string => (rawT as any)(k, ...args) as string
  const { themeConfig } = useTheme()
  const toast = useToast()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'list'>('list')
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [clearPassword, setClearPassword] = useState('')
  const [clearRetentionYears, setClearRetentionYears] = useState(0)
  const [clearing, setClearing] = useState(false)

  // List filters
  const [q, setQ] = useState('')
  const [filterCamera, setFilterCamera] = useState('')
  const [filterReason, setFilterReason] = useState('')
  const [filterRootCause, setFilterRootCause] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [sortCol, setSortCol] = useState('openedAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
    setPage(1)
  }


  // Detail modal
  const [detailId, setDetailId] = useState<string | null>(null)

  // Deep link support: /cctv/incidents?incident=INC-2026-000008 (used by the
  // Telegram/alert "Link:" line) — resolve the human-readable number to its DB id and
  // open the detail modal directly, instead of just landing on the list.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const number = searchParams.get('incident')
    if (!number) return
    imageServiceApi.searchIncidents({ q: number, limit: 5 }).then((res: any) => {
      const match = (res?.data ?? res?.items ?? []).find((i: any) => i.incidentNumber === number) ?? (res?.data ?? res?.items ?? [])[0]
      if (match) setDetailId(match.id)
    }).catch(() => {})
    // Drop the param from the URL so a manual refresh/close doesn't re-open it.
    setSearchParams((prev) => { prev.delete('incident'); return prev }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data: cameras = [] } = useQuery({
    queryKey: ['cameras-incident-list'],
    queryFn: () => imageServiceApi.getCameras(),
    staleTime: 60000,
  })
  const camerasArr = Array.isArray(cameras?.data) ? cameras.data : (Array.isArray(cameras) ? cameras : [])

  const { data: options } = useQuery({
    queryKey: ['incident-options'],
    queryFn: () => imageServiceApi.getIncidentOptions(),
    staleTime: 300000,
  })
  const reasons = options?.reasons ?? []
  const rootCauses = options?.rootCauses ?? []
  const resolutions = options?.resolutions ?? []

  const labelFor = (list: any[], code: string) => {
    const m = list.find((x: any) => x.code === code)
    return m ? getLocalizedValue(m, i18n.language) : code
  }

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['incidents-search', q, filterCamera, filterReason, filterRootCause, filterStatus, filterPriority, page, limit, sortCol, sortDir],
    queryFn: () => imageServiceApi.searchIncidents({
      q: q || undefined, cameraId: filterCamera || undefined, reason: filterReason || undefined,
      rootCause: filterRootCause || undefined, status: filterStatus || undefined,
      priority: filterPriority || undefined, page, limit,
      sortBy: sortCol, sortDir,
    }),
    enabled: tab === 'list',
    staleTime: 15000,
  })
  const incidents = listData?.data ?? []
  const pagination = listData?.pagination ?? { page: 1, totalPages: 1, total: 0 }


  useEffect(() => { setPage(1) }, [q, filterCamera, filterReason, filterRootCause, filterStatus, filterPriority, limit])

  const exportData = useMemo(() => incidents.map((i: any) => ({
    incidentNumber: i.incidentNumber,
    cameraName: i.cameraName,
    reason: labelFor(reasons, i.reason),
    rootCause: i.rootCause ? labelFor(rootCauses, i.rootCause) : '-',
    priority: translatePriority(i.priority, t),
    status: i.status,
    mttr: formatMttr(i.mttrMinutes, (k: string) => t(`imageService.incidentCenter.${k}`)),
    openedAt: i.openedAt ? formatDateTime(i.openedAt, i18n.language) : '-',
    creator: i.openedBy || '-',
    owner: i.assignedTo || '-',
  })), [incidents, reasons, rootCauses, i18n.language])

  const handleClearIncidents = async () => {
    if (!clearPassword) {
      toast.warning(t('imageService.incidentCenter.clearIncidentsConfirm', 'กรุณากรอกรหัสผ่านเพื่อยืนยันการลบ'));
      return;
    }
    setClearing(true);
    try {
      await imageServiceApi.clearAllIncidents(clearPassword, clearRetentionYears || undefined);
      toast.success(t('imageService.incidentCenter.clearIncidentsSuccess', 'ล้างประวัติ Incident ทั้งหมดเรียบร้อยแล้ว'));
      setClearDialogOpen(false);
      setClearPassword('');
      setClearRetentionYears(0);
      queryClient.invalidateQueries({ queryKey: ['incidents-search'] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-open-incidents-count'] });
    } catch (e: any) {
      if (!e?._handled) {
        toast.error(t('imageService.incidentCenter.clearIncidentsError', 'รหัสผ่านไม่ถูกต้อง หรือไม่สามารถดำเนินการได้'));
      }
    } finally {
      setClearing(false);
    }
  };

  const ic = (k: string, opts?: Record<string, any>) => t(`imageService.incidentCenter.${k}`, opts as any)

  const cameraOptions = [{ value: '', label: ic('filterCamera') }, ...camerasArr.map((c: any) => ({ value: c.id, label: c.name }))]
  const reasonOptions = [{ value: '', label: ic('filterReason') }, ...reasons.map((r: any) => ({ value: r.code, label: getLocalizedValue(r, i18n.language) }))]
  const rootCauseOptions = [{ value: '', label: ic('filterRootCause') }, ...rootCauses.map((r: any) => ({ value: r.code, label: getLocalizedValue(r, i18n.language) }))]
  const statusOptions = [
    { value: '', label: ic('filterStatus') },
    { value: 'open', label: ic('open') },
    { value: 'resolved', label: ic('resolved') },
  ]
  const priorityOptions = [
    { value: '', label: ic('filterPriority') },
    { value: 'critical', label: translatePriority('critical', t) },
    { value: 'high', label: translatePriority('high', t) },
    { value: 'medium', label: translatePriority('medium', t) },
    { value: 'low', label: translatePriority('low', t) },
  ]

  return (
    <div className="pt-6 px-6 pb-2.5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
        <div>
          <p className={`text-xs font-medium mb-0.5 uppercase tracking-widest ${themeConfig.text.secondary}`}>
            iSmart CCTV · {ic('title')}
          </p>
          <h2 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{ic('title')}</h2>
          <p className={`text-sm ${themeConfig.text.secondary}`}>{ic('subtitle')}</p>
        </div>
        {tab === 'list' && (
          <div className="flex items-center gap-2">
            {hasPermission(user, 'cameras:delete') && (
              <button
                onClick={() => setClearDialogOpen(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 transition-colors flex items-center gap-1.5"
              >
                <Trash2 size={13} />
                {ic('clearIncidents')}
              </button>
            )}
            <ExportButton
              filename="incidents"
              title={ic('title')}
              sections={[{
                title: ic('tabList'),
                columns: [
                  { key: 'incidentNumber', label: ic('colIncident') },
                  { key: 'cameraName', label: ic('filterCamera') },
                  { key: 'reason', label: ic('filterReason') },
                  { key: 'rootCause', label: ic('filterRootCause') },
                  { key: 'priority', label: ic('filterPriority') },
                  { key: 'status', label: ic('filterStatus') },
                  { key: 'mttr', label: ic('colMttr') },
                  { key: 'openedAt', label: ic('colOpened') },
                  { key: 'creator', label: ic('colCreator') },
                  { key: 'owner', label: ic('colOwner') },
                ],
                data: exportData,
              }]}
            />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className={`flex gap-1 mb-5 border-b ${themeConfig.cardBorder}`}>
        <button
          onClick={() => setTab('list')}
          className={`px-4 py-2 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${
            tab === 'list' ? 'border-cyan-400 text-cyan-300' : `border-transparent ${themeConfig.text.secondary} hover:text-white`
          }`}
        >
          <ClipboardList size={15} /> {ic('tabList')}
        </button>
      </div>

        <>
          {/* Filters */}
          <div className={`${themeConfig.card} rounded-xl p-4 mb-4`}>
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[220px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={ic('searchPlaceholder')}
                  className={`w-full pl-9 pr-3 py-2 rounded-lg text-sm border ${themeConfig.inputBorder} bg-white/5 ${themeConfig.text.primary} placeholder:text-gray-500 focus:outline-none focus:border-cyan-500`}
                />
              </div>
              <div className="w-44"><SearchableSelect value={filterCamera} onChange={setFilterCamera} options={cameraOptions} placeholder={ic('filterCamera')} /></div>
              <div className="w-44"><SearchableSelect value={filterReason} onChange={setFilterReason} options={reasonOptions} placeholder={ic('filterReason')} /></div>
              <div className="w-44"><SearchableSelect value={filterRootCause} onChange={setFilterRootCause} options={rootCauseOptions} placeholder={ic('filterRootCause')} /></div>
              <div className="w-36"><SearchableSelect value={filterStatus} onChange={setFilterStatus} options={statusOptions} placeholder={ic('filterStatus')} /></div>
              <div className="w-40"><SearchableSelect value={filterPriority} onChange={setFilterPriority} options={priorityOptions} placeholder={ic('filterPriority')} /></div>
            </div>
          </div>

          {/* Table */}
          <div className={`${themeConfig.card} rounded-xl p-4 flex flex-col`}>
            {listLoading ? (
              <TableSkeleton rows={8} cols={12} />
            ) : (
              <div className="overflow-x-auto overflow-y-auto relative" style={{ height: 'calc(100vh - 444px)', maxHeight: 'calc(100vh - 444px)' }}>
                <table className="w-full text-sm">
                  <thead className={`${themeConfig.tableHeader} sticky top-0 z-10 shadow-sm`}>
                    <tr>
                      {[
                        { key: null, label: '#', align: 'left' },
                        { key: 'incidentNumber', label: ic('colIncident'), align: 'left' },
                        { key: 'cameraName', label: ic('filterCamera'), align: 'left' },
                        { key: 'reason', label: ic('filterReason'), align: 'left' },
                        { key: 'rootCause', label: ic('filterRootCause'), align: 'left' },
                        { key: 'priority', label: ic('filterPriority'), align: 'left' },
                        { key: 'status', label: ic('filterStatus'), align: 'left' },
                        { key: null, label: ic('colMttr'), align: 'left' },
                        { key: 'openedAt', label: ic('colOpened'), align: 'left' },
                        { key: 'openedBy', label: ic('colCreator'), align: 'left' },
                        { key: 'assignedTo', label: ic('colOwner'), align: 'left' },
                        { key: null, label: t('common.actions', 'การดำเนินการ'), align: 'center' },
                      ].map((col, idx) => (
                        <th key={idx}
                          onClick={col.key ? () => handleSort(col.key as string) : undefined}
                          className={`px-3 py-2 text-xs font-semibold ${themeConfig.text.secondary} ${col.align === 'center' ? 'text-center' : 'text-left'} ${col.key ? 'cursor-pointer select-none hover:text-cyan-300' : ''}`}>
                          {col.key ? (
                            <div className="flex items-center gap-1">
                              {col.label}
                              {sortCol === col.key
                                ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" />
                                : <ChevronsUpDown size={11} className="opacity-25" />}
                            </div>
                          ) : col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className={themeConfig.tableDivide}>
                    {incidents.length === 0 ? (
                      <tr>
                        <td colSpan={12} className={`px-3 py-12 text-center text-xs ${themeConfig.text.secondary}`}>
                          {ic('noIncidents')}
                        </td>
                      </tr>
                    ) : (
                      incidents.map((i: any, idx: number) => (
                        <tr key={i.id} className={`${themeConfig.tableRow} cursor-pointer`} onClick={() => setDetailId(i.id)}>
                          <td className={`px-3 py-2 text-xs font-medium ${themeConfig.text.secondary}`}>{(page - 1) * limit + idx + 1}</td>
                          <td className={`px-3 py-2 text-xs font-mono font-medium ${themeConfig.text.primary}`}>{i.incidentNumber}</td>
                          <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>{i.cameraName}</td>
                          <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>{labelFor(reasons, i.reason)}</td>
                          <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>{i.rootCause ? labelFor(rootCauses, i.rootCause) : '—'}</td>
                          <td className="px-3 py-2"><span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium capitalize ${PRIORITY_COLORS[i.priority] || 'bg-gray-500/20 text-gray-400'}`}>{translatePriority(i.priority, t)}</span></td>
                          <td className="px-3 py-2"><span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium ${STATUS_COLORS[i.status] || 'bg-gray-500/20 text-gray-400'}`}>{i.status === 'open' ? ic('open') : ic('resolved')}</span></td>
                          <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>
                            {i.status === 'open'
                              ? <span className="text-amber-400">{formatMttr(i.openDurationMinutes, ic)} ({ic('ongoing')})</span>
                              : formatMttr(i.mttrMinutes, ic)}
                          </td>
                          <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>{i.openedAt ? formatDateTime(i.openedAt, i18n.language) : '—'}</td>
                          <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>{i.openedBy || '—'}</td>
                          <td className="px-3 py-2 text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className={themeConfig.text.secondary}>{i.assignedTo || '—'}</span>
                              {i.status === 'open' && (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${WORKFLOW_STAGE_COLORS[i.workflowStage] || WORKFLOW_STAGE_COLORS.unassigned}`}>
                                  {ic(`workflow.${i.workflowStage || 'unassigned'}`)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center whitespace-nowrap">
                            <button onClick={(e) => { e.stopPropagation(); setDetailId(i.id) }} className="text-xs text-cyan-400 hover:underline">{t('common.view', 'View')}</button>
                            {hasPermission(user, 'cameras:delete') && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation()
                                  if (!confirm(ic('confirmDeleteOne', { num: i.incidentNumber, defaultValue: `ลบ Incident ${i.incidentNumber}? รูปหลักฐานแนบจะถูกลบถาวรด้วย` }))) return
                                  try {
                                    await imageServiceApi.deleteIncident(i.id)
                                    toast.success(t('common.deleted', 'ลบแล้ว'))
                                    queryClient.invalidateQueries({ queryKey: ['incidents-search'] })
                                  } catch {
                                    toast.error(t('common.error', 'เกิดข้อผิดพลาด'))
                                  }
                                }}
                                title={t('common.delete', 'ลบ')}
                                className="ml-2 inline-flex p-1 rounded text-red-400 hover:bg-red-500/10"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Footer */}
            <div className={`flex flex-wrap items-center justify-between gap-4 p-4 border-t ${themeConfig.cardBorder} bg-white/[0.01] -mx-4 -mb-4 mt-4`}>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${themeConfig.text.secondary}`}>{t('common.showPerPage', 'แสดงต่อหน้า')}:</span>
                <div className="w-20">
                  <SearchableSelect
                    value={String(limit)}
                    onChange={(v) => {
                      setLimit(Number(v))
                      setPage(1)
                    }}
                    showSearch={false}
                    options={[10, 20, 50, 100].map(v => ({
                      value: String(v),
                      label: String(v)
                    }))}
                  />
                </div>
                <span className={`text-xs ${themeConfig.text.secondary} ml-2`}>
                  {t('imageService.incidentCenter.totalIncidents', 'ทั้งหมด {{count}} รายการ', { count: pagination.total })}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(1)}
                  className={`px-2.5 py-1.5 rounded text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30 disabled:hover:bg-transparent hover:bg-white/5 transition-colors`}
                >
                  « {t('common.first', 'หน้าแรก')}
                </button>
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  className={`px-2.5 py-1.5 rounded text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30 disabled:hover:bg-transparent hover:bg-white/5 transition-colors`}
                >
                  ‹ {t('common.prev', 'ก่อนหน้า')}
                </button>
                
                <div className="flex items-center gap-1 mx-1">
                  <input
                    type="number"
                    value={page}
                    min={1}
                    max={pagination.totalPages || 1}
                    onChange={(e) => {
                      const val = Number(e.target.value)
                      if (val >= 1 && val <= (pagination.totalPages || 1)) setPage(val)
                    }}
                    className={`w-10 px-1 py-1 rounded text-xs text-center border ${themeConfig.inputBorder} ${themeConfig.card} ${themeConfig.text.primary} focus:outline-none focus:border-cyan-500 bg-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                  />
                  <span className={`text-xs ${themeConfig.text.secondary}`}>/ {pagination.totalPages || 1}</span>
                </div>

                <button
                  disabled={page >= (pagination.totalPages || 1)}
                  onClick={() => setPage(p => p + 1)}
                  className={`px-2.5 py-1.5 rounded text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30 disabled:hover:bg-transparent hover:bg-white/5 transition-colors`}
                >
                  {t('common.next', 'ถัดไป')} ›
                </button>
                <button
                  disabled={page >= (pagination.totalPages || 1)}
                  onClick={() => setPage(pagination.totalPages || 1)}
                  className={`px-2.5 py-1.5 rounded text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30 disabled:hover:bg-transparent hover:bg-white/5 transition-colors`}
                >
                  {t('common.last', 'หน้าสุดท้าย')} »
                </button>
              </div>
            </div>
          </div>
        </>

      {detailId && (
        <IncidentDetailModal
          incidentId={detailId}
          onClose={() => setDetailId(null)}
          onSwitch={(id: string) => setDetailId(id)}
          labelReason={(c: string) => labelFor(reasons, c)}
          labelRootCause={(c: string) => labelFor(rootCauses, c)}
          labelResolution={(c: string) => labelFor(resolutions, c)}
          ic={ic}
        />
      )}

      {clearDialogOpen && (
        <Modal isOpen={clearDialogOpen} onClose={() => { setClearDialogOpen(false); setClearPassword('') }} title={t('imageService.incidentCenter.clearIncidentsTitle', 'ยืนยันล้างประวัติ Incident ทั้งหมด')}>
          <div className="space-y-4 p-1 max-w-md">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-400 mb-1">
                  {t('imageService.incidentCenter.clearIncidentsWarningTitle', 'คำเตือน (ระดับวิกฤต)')}
                </p>
                <p className={`text-xs ${themeConfig.text.secondary}`}>
                  {t('imageService.incidentCenter.clearIncidentsWarning', 'การดำเนินการนี้จะลบรายการ Incident ทั้งหมดออกจากระบบ และลบไฟล์รูปภาพที่แนบประกอบการเปลี่ยนสถานะกล้องทั้งหมดออกจากดิสก์อย่างถาวร ข้อมูลนี้จะไม่สามารถกู้คืนกลับมาได้อีก')}
                </p>
              </div>
            </div>

            <div>
              <label className={`block text-xs font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('imageService.incidentCenter.clearRetentionPeriod', 'ขอบเขตช่วงเวลาที่ต้องการลบ')}
              </label>
              <SearchableSelect
                value={String(clearRetentionYears)}
                onChange={v => setClearRetentionYears(Number(v))}
                placeholder={t('imageService.incidentCenter.clearRetentionPeriod', 'ขอบเขตช่วงเวลาที่ต้องการลบ')}
                options={[
                  { value: '0', label: t('imageService.incidentCenter.clearAll', 'ลบทั้งหมดทุกช่วงเวลา') },
                  ...[1, 2, 3, 5, 6, 7, 8, 9, 10].map(y => ({
                    value: String(y),
                    label: `${t('imageService.incidentCenter.clearOlderThan', 'ลบประวัติที่เก่ากว่า')} ${y} ${t('imageService.incidentCenter.years', 'ปี')}`
                  }))
                ]}
              />
            </div>

            <div>
              <label className={`block text-xs font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('imageService.incidentCenter.clearIncidentsConfirm', 'กรุณากรอกรหัสผ่านเพื่อยืนยันการลบ')}
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={clearPassword}
                onChange={e => setClearPassword(e.target.value)}
                placeholder={t('imageService.incidentCenter.clearIncidentsPasswordPlaceholder', 'รหัสผ่านของคุณ')}
                className={`w-full px-3 py-2 rounded-lg text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-red-500/50`}
              />
            </div>

            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => { setClearDialogOpen(false); setClearPassword('') }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${themeConfig.cardBorder} ${themeConfig.text.secondary} hover:bg-white/5`}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={clearing || !clearPassword}
                onClick={handleClearIncidents}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-500 text-white disabled:opacity-40 flex items-center gap-1.5"
              >
                {clearing ? (
                  <div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <Trash2 size={13} />
                )}
                {t('imageService.incidentCenter.clearIncidentsButton', 'ล้างประวัติ Incident')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}


/* ---------------- Detail Modal ---------------- */
function IncidentDetailModal({ incidentId, onClose, onSwitch, labelReason, labelRootCause, labelResolution, ic }: any) {
  const { i18n, t } = useTranslation()
  const { themeConfig } = useTheme()
  const { user } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const canUpdateWorkflow = hasPermission(user, 'cameras:update')
  const sc = (k: string) => t(`imageService.sopChecklists.${k}`)
  const [woBusy, setWoBusy] = useState(false)
  const [localWo, setLocalWo] = useState<{ number: string | null; status: string | null } | null>(null)

  const { data: incident, isLoading, refetch } = useQuery({
    queryKey: ['incident-detail', incidentId],
    queryFn: () => imageServiceApi.getIncidentDetail(incidentId),
    staleTime: 0,
  })

  const { data: related = [] } = useQuery({
    queryKey: ['incident-related', incidentId],
    queryFn: () => imageServiceApi.getRelatedIncidents(incidentId),
    staleTime: 30000,
  })



  const { data: cameraEvents = [] } = useQuery({
    queryKey: ['camera-events-for-incident', incident?.cameraId, incident?.openedAt],
    queryFn: () => imageServiceApi.getCameraEvents(incident.cameraId, {
      since: new Date(new Date(incident.openedAt).getTime() - 5 * 60 * 1000).toISOString(),
      until: incident.closedAt ? new Date(new Date(incident.closedAt).getTime() + 60 * 1000).toISOString() : undefined,
      limit: 50,
    }),
    enabled: !!incident?.cameraId && !!incident?.openedAt,
    staleTime: 15000,
  })

  const timelineEvents = useMemo(() => {
    if (!incident) return []
    const items: { at: string; label: string; kind: string }[] = [
      { at: incident.openedAt, label: sc('timelineOpened'), kind: 'opened' },
      ...cameraEvents.map((e: any) => ({ at: e.createdAt, label: localizeHealthMonitorText(e.message, t) ?? e.message, kind: e.eventType })),
    ]
    if (incident.closedAt) {
      items.push({ at: incident.closedAt, label: incident.autoResolved ? sc('timelineAutoResolved') : sc('timelineResolved'), kind: 'resolved' })
    }
    return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  }, [incident, cameraEvents, t])


  const [assigneeInput, setAssigneeInput] = useState('')
  useEffect(() => { setAssigneeInput(incident?.assignedTo || '') }, [incident?.id, incident?.assignedTo])

  const handleAssigneeSave = async () => {
    if (assigneeInput === (incident?.assignedTo || '')) return
    try {
      await imageServiceApi.updateIncidentWorkflow(incidentId, { assignedTo: assigneeInput || null })
      queryClient.invalidateQueries({ queryKey: ['incident-detail', incidentId] })
      queryClient.invalidateQueries({ queryKey: ['incidents-search'] })
    } catch (e: any) {
      if (!e?._handled) toast.error(t('common.error'))
    }
  }

  const handleWorkflowChange = async (stage: string) => {
    try {
      await imageServiceApi.updateIncidentWorkflow(incidentId, { workflowStage: stage })
      queryClient.invalidateQueries({ queryKey: ['incident-detail', incidentId] })
      queryClient.invalidateQueries({ queryKey: ['incidents-search'] })
    } catch (e: any) {
      if (!e?._handled) toast.error(t('common.error'))
    }
  }

  const handleAcknowledge = async () => {
    try {
      await imageServiceApi.updateIncidentWorkflow(incidentId, { acknowledge: true })
      queryClient.invalidateQueries({ queryKey: ['incident-detail', incidentId] })
      queryClient.invalidateQueries({ queryKey: ['incidents-search'] })
    } catch (e: any) {
      if (!e?._handled) toast.error(t('common.error'))
    }
  }

  useEffect(() => { setLocalWo(null) }, [incidentId])

  const woNumber = localWo?.number ?? incident?.workOrderNumber ?? null
  const woStatus = localWo?.status ?? incident?.workOrderStatus ?? null

  const handleCreateWo = async () => {
    setWoBusy(true)
    try {
      const updated = await imageServiceApi.createWorkOrder(incidentId)
      setLocalWo({ number: updated.workOrderNumber, status: updated.workOrderStatus })
      refetch()
    } finally { setWoBusy(false) }
  }

  const handleWoStatus = async (status: string) => {
    setWoBusy(true)
    try {
      const updated = await imageServiceApi.updateWorkOrderStatus(incidentId, status)
      setLocalWo({ number: updated.workOrderNumber, status: updated.workOrderStatus })
    } finally { setWoBusy(false) }
  }

  // CCTV Fast Actions
  const [showLiveStream, setShowLiveStream] = useState(false)
  const [probeLoading, setProbeLoading] = useState(false)
  const [probeResult, setProbeResult] = useState<any | null>(null)
  const [snoozeOpen, setSnoozeOpen] = useState(false)

  const handleToggleMaintenance = async () => {
    if (!incident?.cameraId) return
    const isMaint = incident.camera?.status === 'maintenance'
    const newStatus = isMaint ? 'active' : 'maintenance'
    try {
      await imageServiceApi.updateCamera(incident.cameraId, { status: newStatus })
      toast.success(newStatus === 'maintenance' ? t('ui.incidentCenter.cameraSwitchedToMaintenanceModeAlerts') : t('ui.incidentCenter.cameraRestoredToActiveMode'))
      refetch()
      queryClient.invalidateQueries({ queryKey: ['cctv-cameras-all'] })
      queryClient.invalidateQueries({ queryKey: ['cctv-dashboard-summary'] })
    } catch (err: any) {
      toast.error(err?.message || t('ui.incidentCenter.failedToUpdateCameraStatus'))
    }
  }

  const handleProbeCamera = async () => {
    if (!incident?.camera) return
    setProbeLoading(true)
    setProbeResult(null)
    try {
      const cam = incident.camera
      let host = cam.ipAddress || cam.device?.ipAddress
      let port = cam.device?.rtspPort || 554
      if (cam.rtspUrl) {
        const cleaned = cam.rtspUrl.replace(/^rtsp:\/\//i, '')
        const withoutAuth = cleaned.includes('@') ? cleaned.split('@')[1] : cleaned
        const hostAndPath = withoutAuth.split('/')[0]
        const [h, p] = hostAndPath.split(':')
        if (h) host = h
        if (p) port = parseInt(p, 10)
      }
      if (!host) throw new Error(t('ui.incidentCenter.noIpConfiguredForCamera'))
      const res = await imageServiceApi.probeDevice({ ipAddress: host, rtspPort: port })
      setProbeResult(res)
    } catch (err: any) {
      toast.error(err?.message || t('ui.incidentCenter.probeFailed'))
    } finally {
      setProbeLoading(false)
    }
  }

  const handleSnooze = async (hours: number) => {
    try {
      await imageServiceApi.snoozeAlert(incidentId, hours)
      toast.success(t('ui.incidentCenter.notificationsSnoozedForH', { hours }))
      setSnoozeOpen(false)
      refetch()
    } catch (err: any) {
      await imageServiceApi.updateIncidentWorkflow(incidentId, { acknowledge: true })
      toast.success(t('ui.incidentCenter.incidentAcknowledgedAndSnoozedForH', { hours }))
      setSnoozeOpen(false)
      refetch()
    }
  }

  const attachments: any[] = Array.isArray(incident?.attachments) ? incident.attachments : []

  const Field = ({ label, value }: { label: string; value: any }) => (
    value ? (
      <div>
        <p className={`text-[11px] uppercase tracking-wide ${themeConfig.text.secondary}`}>{label}</p>
        <p className={`text-sm ${themeConfig.text.primary} whitespace-pre-wrap`}>{value}</p>
      </div>
    ) : null
  )

  // Auto-resolved incidents store a plain English sentence here instead of a
  // real masterdata code (see localizeHealthMonitorText) — only fall back to
  // the masterdata code→label lookup when it's actually a code.
  const resolutionDisplay = (() => {
    if (!incident?.resolution) return null
    const localized = localizeHealthMonitorText(incident.resolution, t)
    return localized !== incident.resolution ? localized : labelResolution(incident.resolution)
  })()

  return (
    <Modal isOpen onClose={onClose} size="4xl" title={incident?.incidentNumber || ic('colIncident')}>
      {isLoading || !incident ? (
        <TableSkeleton rows={6} cols={2} />
      ) : (
        <div className="space-y-5">
          {/* Header badges */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`text-lg font-mono font-bold ${themeConfig.text.primary}`}>{incident.incidentNumber}</span>
            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[incident.status] || 'bg-gray-500/20 text-gray-400'}`}>{incident.status === 'open' ? ic('open') : ic('resolved')}</span>
            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium capitalize ${PRIORITY_COLORS[incident.priority] || 'bg-gray-500/20 text-gray-400'}`}>{translatePriority(incident.priority, t)}</span>
          </div>

          {/* CCTV Operations Quick Bar */}
          <div className="p-3 rounded-xl bg-slate-800/60 border border-white/10 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Radio size={14} className="text-cyan-400" />
                {t('ui.incidentCenter.cctvFastActions')}
              </span>
              <button
                type="button"
                onClick={() => setShowLiveStream(!showLiveStream)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors border ${
                  showLiveStream
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                }`}
              >
                <Play size={13} />
                {showLiveStream ? t('ui.incidentCenter.hideLiveStream') : t('ui.incidentCenter.watchLiveStream')}
              </button>

              <button
                type="button"
                onClick={handleProbeCamera}
                disabled={probeLoading}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw size={13} className={probeLoading ? 'animate-spin' : ''} />
                {probeLoading ? t('ui.incidentCenter.testingSocket') : t('ui.incidentCenter.probeSocket')}
              </button>

              {(() => {
                const bkk = toBangkokDateAndTimeString(incident.openedAt);
                return (
                  <Link
                    to={`/cctv/playback?cameraId=${incident.cameraId}&date=${bkk.date}&time=${bkk.time}`}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 flex items-center gap-1.5 transition-colors"
                    title={t('ui.incidentCenter.open24HourPlaybackAtThe')}
                  >
                    <Film size={13} />
                    <span>{t('ui.incidentCenter.jumpToPlayback')}</span>
                  </Link>
                );
              })()}
            </div>

            <div className="flex items-center gap-2 relative">
              <button
                type="button"
                onClick={handleToggleMaintenance}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors border ${
                  incident.camera?.status === 'maintenance'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                }`}
                title={t('ui.incidentCenter.suppressAutomatedOfflineAlertsDuringServicing')}
              >
                <Wrench size={13} />
                {incident.camera?.status === 'maintenance' ? t('ui.incidentCenter.exitMaintenance') : t('ui.incidentCenter.setMaintenanceMode')}
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSnoozeOpen(!snoozeOpen)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 flex items-center gap-1.5 transition-colors"
                >
                  <BellOff size={13} />
                  {t('ui.incidentCenter.snoozeAlerts')}
                </button>
                {snoozeOpen && (
                  <div className="absolute right-0 bottom-full mb-1 w-36 bg-slate-900 border border-white/15 rounded-xl shadow-2xl p-1 z-30 space-y-0.5">
                    {[1, 4, 8, 24].map((hrs) => (
                      <button
                        key={hrs}
                        type="button"
                        onClick={() => handleSnooze(hrs)}
                        className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-white/10 transition-colors"
                      >
                        {t('ui.incidentCenter.snooze')}{' '}{hrs} {hrs === 1 ? t('ui.incidentCenter.hour') : t('ui.incidentCenter.hours')}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Probe result banner */}
          {probeResult && (
            <div
              className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
                probeResult.reachable
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}
            >
              <div className="flex items-center gap-2">
                {probeResult.reachable ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                <span>{probeResult.message}</span>
              </div>
              <span className="font-mono font-bold">{probeResult.latencyMs} ms</span>
            </div>
          )}

          {/* Inline Live Stream Viewer */}
          {showLiveStream && incident?.cameraId && (
            <div className="rounded-xl overflow-hidden bg-black border border-white/20 aspect-video shadow-2xl relative">
              <WhepPlayer
                streamUrl={`/mediamtx/webrtc/${incident.camera?.streamPath || incident.cameraId}/whep`}
                cameraName={incident.camera?.name || t('ui.incidentCenter.camera')}
                streamProfile="main"
                autoPlay={true}
              />
            </div>
          )}

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-4">
            <Field label={ic('filterCamera')} value={incident.camera?.name} />
            <Field label={ic('filterReason')} value={labelReason(incident.reason)} />
            <Field
              label={ic('filterRootCause')}
              value={incident.rootCause ? (
                <span className="inline-flex items-center gap-1.5">
                  {labelRootCause(incident.rootCause)}
                  {incident.rootCauseConfidence && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      incident.rootCauseConfidence === 'high' ? 'bg-green-500/20 text-green-400' :
                      incident.rootCauseConfidence === 'medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {sc(`confidence.${incident.rootCauseConfidence}`)}
                    </span>
                  )}
                </span>
              ) : null}
            />
            <Field label={sc('detectionSource')} value={incident.detectionSource ? sc(`source.${incident.detectionSource}`) : sc('source.manual')} />
            <Field
              label={incident.status === 'open' ? ic('duration') : ic('colMttr')}
              value={incident.closedAt
                ? formatMttr(Math.round((new Date(incident.closedAt).getTime() - new Date(incident.openedAt).getTime()) / 60000), ic)
                : (incident.status === 'open'
                  ? <span className="text-amber-400">{formatMttr(Math.round((Date.now() - new Date(incident.openedAt).getTime()) / 60000), ic)} ({ic('ongoing')})</span>
                  : null)}
            />
            <Field label={ic('problemDesc')} value={incident.problemDesc} />
            <Field label={ic('resolution')} value={resolutionDisplay} />
            <Field label={ic('resolutionDesc')} value={incident.resolutionDesc} />
            <Field label={ic('description')} value={localizeHealthMonitorText(incident.description, t)} />
            <Field label={ic('correctiveAction')} value={incident.correctiveAction} />
            <Field label={ic('preventiveAction')} value={incident.preventiveAction} />
            <Field label={ic('colOpened')} value={incident.openedAt ? `${formatDateTime(incident.openedAt, i18n.language)} (${incident.openedBy || '—'})` : null} />
            <Field label={t('ui.incidentCenter.closed')} value={incident.closedAt ? `${formatDateTime(incident.closedAt, i18n.language)} (${incident.closedBy || '—'})` : null} />
            {incident.status === 'open' && canUpdateWorkflow ? (
              <div>
                <p className={`text-[11px] uppercase tracking-wide ${themeConfig.text.secondary}`}>{ic('colOwner')}</p>
                <input
                  value={assigneeInput}
                  onChange={(e) => setAssigneeInput(e.target.value)}
                  onBlur={handleAssigneeSave}
                  placeholder={ic('assignPlaceholder')}
                  className={`mt-1 w-full px-2.5 py-1.5 rounded-md text-sm border ${themeConfig.inputBorder} bg-white/5 ${themeConfig.text.primary} placeholder:text-gray-500 focus:outline-none focus:border-cyan-500`}
                />
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {['unassigned', 'assigned', 'in_progress', 'waiting_parts', 'waiting_vendor'].map((stage) => (
                    <button
                      key={stage}
                      onClick={() => handleWorkflowChange(stage)}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors whitespace-nowrap ${
                        incident.workflowStage === stage ? WORKFLOW_STAGE_COLORS[stage] : `${themeConfig.text.secondary} hover:bg-white/5`
                      }`}
                    >
                      {ic(`workflow.${stage}`)}
                    </button>
                  ))}
                </div>
                <div className="mt-2">
                  {incident.acknowledgedAt ? (
                    <p className={`text-[11px] ${themeConfig.text.secondary}`}>
                      {ic('acknowledgedBy', { name: incident.acknowledgedBy || '—', time: formatDateTime(incident.acknowledgedAt, i18n.language) })}
                    </p>
                  ) : (
                    <button
                      onClick={handleAcknowledge}
                      className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
                    >
                      {ic('acknowledge')}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <Field label={ic('colOwner')} value={incident.assignedTo || '—'} />
            )}
            <Field label={ic('observers')} value={Array.isArray(incident.observers) && incident.observers.length > 0 ? incident.observers.join(', ') : null} />
          </div>

          {/* Attachments */}
          {attachments.length > 0 && (
            <div>
              <p className={`text-[11px] uppercase tracking-wide mb-2 ${themeConfig.text.secondary}`}>{t('ui.incidentCenter.attachments')}</p>
              <div className="flex flex-wrap gap-2">
                {attachments.map((a: any, idx: number) => {
                  const filename = a.filename || (typeof a === 'string' ? a.split('/').pop() : null)
                  if (!filename) return null
                  return <AttachmentImage key={idx} filename={filename} alt={a.originalName || filename} />
                })}
              </div>
            </div>
          )}

          {/* Maintenance / Work Order */}
          <div className={`rounded-lg p-4 bg-white/5`}>
            <p className={`text-sm font-semibold mb-2 flex items-center gap-2 ${themeConfig.text.primary}`}><Wrench size={15} className="text-cyan-400" /> {ic('maintenance')}</p>
            {woNumber ? (
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`text-sm font-mono ${themeConfig.text.primary}`}>{ic('workOrder')}: {woNumber}</span>
                <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${WO_STATUS_COLORS[woStatus || 'open'] || 'bg-gray-500/20 text-gray-400'}`}>
                  {woStatus === 'completed' ? ic('woCompleted') : woStatus === 'in_progress' ? ic('woInProgress') : ic('woOpen')}
                </span>
                <select
                  value={woStatus || 'open'} disabled={woBusy}
                  onChange={(e) => handleWoStatus(e.target.value)}
                  className={`px-2 py-1 rounded-lg text-xs border ${themeConfig.inputBorder} bg-slate-800 ${themeConfig.text.primary} focus:outline-none`}
                >
                  <option className="bg-slate-800 text-slate-100" value="open">{ic('woOpen')}</option>
                  <option className="bg-slate-800 text-slate-100" value="in_progress">{ic('woInProgress')}</option>
                  <option className="bg-slate-800 text-slate-100" value="completed">{ic('woCompleted')}</option>
                </select>
              </div>
            ) : (
              <button onClick={handleCreateWo} disabled={woBusy}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5">
                <Wrench size={13} /> {ic('createWorkOrder')}
              </button>
            )}
          </div>


          {/* Timeline (P35) */}
          {timelineEvents.length > 0 && (
            <div>
              <p className={`text-sm font-semibold mb-2 flex items-center gap-1.5 ${themeConfig.text.primary}`}>
                <Clock size={14} className="text-cyan-400" /> {sc('timeline')}
              </p>
              <div className="relative border-l-2 border-white/10 pl-4 space-y-3">
                {timelineEvents.map((e, idx) => (
                  <div key={idx} className="relative">
                    <span className={`absolute -left-[21px] top-0.5 w-2.5 h-2.5 rounded-full ${
                      e.kind === 'offline' ? 'bg-red-500' : e.kind === 'online' ? 'bg-green-400' : e.kind === 'recovering' ? 'bg-amber-400' : e.kind === 'resolved' ? 'bg-cyan-400' : 'bg-gray-400'
                    }`} />
                    <p className={`text-[11px] ${themeConfig.text.secondary}`}>{formatDateTime(e.at, i18n.language)}</p>
                    <p className={`text-xs ${themeConfig.text.primary}`}>{e.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Related incidents */}
          {related.length > 0 && (
            <div>
              <p className={`text-sm font-semibold mb-2 ${themeConfig.text.primary}`}>{ic('relatedIncidents')}</p>
              <div className="space-y-1">
                {related.map((r: any) => (
                  <button key={r.id} onClick={() => onSwitch(r.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-between gap-2`}>
                    <span className={`text-xs font-mono ${themeConfig.text.primary}`}>{r.incidentNumber}</span>
                    <span className={`text-xs ${themeConfig.text.secondary}`}>{r.cameraName} · {labelReason(r.reason)}</span>
                    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[r.status] || 'bg-gray-500/20 text-gray-400'}`}>{r.status === 'open' ? ic('open') : ic('resolved')}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </Modal>
  )
}
