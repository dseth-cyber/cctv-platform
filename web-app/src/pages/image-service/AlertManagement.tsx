import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PlaceFilterChip, usePlaceParams } from '@/components/cctv/PlaceFilterChip'
import { useTheme } from '@/contexts/ThemeContext'
import { useToast } from '@/contexts/ToastContext'
import { imageServiceApi } from '@/services/imageServiceApi'
import { formatDateTime } from '@/utils/dateUtils'
import { translateAlertTitle, translateAlertMessage, getLocalizedValue, type IncidentLabelMaps } from '@/utils/textUtils'
import { Modal, Button, SearchableSelect, TableSkeleton } from '@/components/ui'
import { Search, Bell, Eye, CheckCircle, XCircle, ChevronUp, ChevronDown, ChevronsUpDown, Trash2, AlertTriangle } from 'lucide-react'

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400',
  emergency: 'bg-red-600/20 text-red-500',
  warning: 'bg-yellow-500/20 text-yellow-400',
  info: 'bg-blue-500/20 text-blue-400',
}

export default function AlertManagement() {
  const { t, i18n } = useTranslation()
  const { themeConfig } = useTheme()
  const toast = useToast()
  const queryClient = useQueryClient()
  const place = usePlaceParams()

  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [severity, setSeverity] = useState('')
  const [resolved, setResolved] = useState('all')
  const [sortCol, setSortCol] = useState('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [viewing, setViewing] = useState<any>(null)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [clearPassword, setClearPassword] = useState('')
  const [clearing, setClearing] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['alerts', place.siteId, place.zoneId, page, limit, severity, resolved, sortCol, sortDir],
    queryFn: async () => {
      const res = await imageServiceApi.getAlerts({
        siteId: place.siteId,
        zoneId: place.zoneId,
        severity: severity || undefined,
        resolved: resolved === 'all' ? undefined : resolved === 'resolved' ? true : false,
        page,
        limit,
        sortBy: sortCol,
        sortDir,
      })
      return { items: res.data ?? [], total: res.pagination?.total ?? 0, totalPages: res.pagination?.totalPages ?? 0 }
    },
    staleTime: 1000 * 30,
    placeholderData: (prev) => prev,
  })

  // Reason/Resolution codes embedded in camera status-change alert messages are
  // masterdata-backed — resolve them to the viewer's language here rather than
  // showing the raw code (e.g. "completed").
  const { data: incidentOptions } = useQuery({
    queryKey: ['incident-options'],
    queryFn: () => imageServiceApi.getIncidentOptions({ silent403: true }),
    staleTime: 1000 * 60 * 5,
  })
  const incidentLabels = useMemo<IncidentLabelMaps>(() => ({
    reasons: Object.fromEntries((incidentOptions?.reasons ?? []).map((r: any) => [r.code, getLocalizedValue(r, i18n.language)])),
    resolutions: Object.fromEntries((incidentOptions?.resolutions ?? []).map((r: any) => [r.code, getLocalizedValue(r, i18n.language)])),
    rootCauses: Object.fromEntries((incidentOptions?.rootCauses ?? []).map((r: any) => [r.code, getLocalizedValue(r, i18n.language)])),
  }), [incidentOptions, i18n.language])

  const items = data?.items ?? []
  const totalPages = data?.totalPages ?? 0

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
    setPage(1)
  }

  const handleAcknowledge = async (id: string) => {
    try {
      await imageServiceApi.acknowledgeAlert(id)
      toast.success(t('imageService.alerts.acknowledged'))
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')) }
  }

  const handleResolve = async (id: string) => {
    try {
      await imageServiceApi.resolveAlert(id)
      toast.success(t('imageService.alerts.resolved'))
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')) }
  }

  const handleClearAllAlerts = async () => {
    if (!clearPassword) {
      toast.warning(t('imageService.alerts.clearAllPasswordConfirm', 'กรุณากรอกรหัสผ่านเพื่อยืนยันการล้างแจ้งเตือน'))
      return
    }
    setClearing(true)
    try {
      const res = await imageServiceApi.clearAllAlerts(clearPassword)
      toast.success(t('imageService.alerts.clearAllSuccess', { count: res.cleared }))
      setClearDialogOpen(false)
      setClearPassword('')
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      queryClient.invalidateQueries({ queryKey: ['navbar-alerts'] })
    } catch (e: any) {
      if (!e?._handled) toast.error(t('imageService.alerts.clearAllPasswordError', 'รหัสผ่านไม่ถูกต้อง หรือไม่สามารถดำเนินการได้'))
    } finally {
      setClearing(false)
    }
  }

  const thCls = (col: string) =>
    `px-4 py-3 text-left text-sm font-semibold cursor-pointer select-none hover:text-cyan-300 ${themeConfig.text.primary}`

  const severityOptions = [
    { value: 'critical', label: t('imageService.alerts.critical') },
    { value: 'warning', label: t('imageService.alerts.warning') },
    { value: 'info', label: t('imageService.alerts.info') },
  ]
  const resolvedOptions = [
    { value: 'open', label: t('imageService.alerts.open') },
    { value: 'resolved', label: t('imageService.alerts.resolved') },
    { value: 'all', label: t('imageService.alerts.all') },
  ]

  return (
    <div className="pt-6 px-6 pb-2.5">
      <div className="mb-6">
        <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
          iSmart CCTV · {t('imageService.alerts.title')}
        </p>
        <div className="mb-2"><PlaceFilterChip /></div>
        <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.alerts.title')}</h1>
        <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.alerts.subtitle')}</p>
      </div>

      <div className={`${themeConfig.card} rounded-lg p-4 mb-5`}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-40">
            <SearchableSelect value={severity} onChange={v => { setSeverity(v); setPage(1) }}
              placeholder={t('imageService.alerts.allSeverity')} options={severityOptions} />
          </div>
          <div className="w-40">
            <SearchableSelect value={resolved} onChange={v => { setResolved(v); setPage(1) }}
              placeholder={t('imageService.alerts.status')} options={resolvedOptions} />
          </div>
          <div className="ml-auto">
            <Button variant="secondary" onClick={() => setClearDialogOpen(true)}>
              <Trash2 size={14} className="mr-1.5 inline" />
              {t('imageService.alerts.clearAll') !== 'imageService.alerts.clearAll' ? t('imageService.alerts.clearAll') : t('common.clearAll')}
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? <TableSkeleton rows={8} /> : (
        <>
          {/* Mobile card list */}
          <div className="md:hidden space-y-2">
            {items.map((item: any, idx: number) => (
              <div key={item.id} className={`${themeConfig.card} rounded-lg p-3`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${SEVERITY_COLORS[item.severity] ?? 'bg-gray-500/20 text-gray-400'}`}>
                        {t(`imageService.alerts.${item.severity}`)}
                      </span>
                      <span className={`text-[10px] ${themeConfig.text.secondary}`}>#{(page - 1) * limit + idx + 1}</span>
                    </div>
                    <p className={`text-sm font-medium ${themeConfig.text.primary} break-words`}>{translateAlertTitle(item.title, t)}{item.resolvedAt && <span data-alert-closed className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-300">{t('imageService.alerts.closedBadge')}</span>}</p>
                    <p className={`text-[11px] mt-1 ${themeConfig.text.secondary}`}>
                      {item.source ?? '—'} · {formatDateTime(item.createdAt, i18n.language)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 mt-2 pt-2 border-t border-white/5">
                  <button onClick={() => { setDetailId(item.id); setViewing(item) }}
                    className="p-2 rounded-lg hover:bg-cyan-500/20"><Eye size={16} className="text-cyan-400" /></button>
                  {!item.acknowledgedAt && (
                    <button onClick={() => handleAcknowledge(item.id)}
                      className="p-2 rounded-lg hover:bg-blue-500/20"><CheckCircle size={16} className="text-blue-400" /></button>
                  )}
                  {!item.resolvedAt && (
                    <button onClick={() => handleResolve(item.id)}
                      className="p-2 rounded-lg hover:bg-green-500/20"><XCircle size={16} className="text-green-400" /></button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className={`${themeConfig.card} rounded-lg overflow-hidden hidden md:block`}>
            <div className="overflow-x-auto overflow-y-auto relative" style={{ height: 'calc(100vh - 355px)' }}>
              <table className="w-full">
                <thead className={`${themeConfig.tableHeader} sticky top-0 z-10 shadow-sm`}>
                <tr>
                  <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>#</th>
                  <th onClick={() => handleSort('severity')} className={thCls('severity')}>
                    <div className="flex items-center gap-1">{t('imageService.alerts.severity')}
                      {sortCol === 'severity' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                  </th>
                  <th onClick={() => handleSort('title')} className={thCls('title')}>
                    <div className="flex items-center gap-1">{t('imageService.alerts.alert')}
                      {sortCol === 'title' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                  </th>
                  <th onClick={() => handleSort('source')} className={thCls('source')}>
                    <div className="flex items-center gap-1">{t('imageService.alerts.source')}
                      {sortCol === 'source' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                  </th>
                  <th onClick={() => handleSort('createdAt')} className={thCls('createdAt')}>
                    <div className="flex items-center gap-1">{t('imageService.alerts.createdAt')}
                      {sortCol === 'createdAt' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                  </th>
                  <th className={`px-4 py-3 text-center text-sm font-semibold ${themeConfig.text.primary}`}>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${themeConfig.tableDivide}`}>
                {items.map((item: any, idx: number) => (
                  <tr key={item.id} className={`border-b ${themeConfig.tableBorder} ${themeConfig.tableRow}`}>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.primary}`}>{(page - 1) * limit + idx + 1}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_COLORS[item.severity] ?? 'bg-gray-500/20 text-gray-400'}`}>
                        {t(`imageService.alerts.${item.severity}`)}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.primary} max-w-[320px] truncate`}>{translateAlertTitle(item.title, t)}{item.resolvedAt && <span data-alert-closed className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-300">{t('imageService.alerts.closedBadge')}</span>}</td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{item.source ?? '—'}</td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>
                      {formatDateTime(item.createdAt, i18n.language)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => { setDetailId(item.id); setViewing(item) }}
                          className="p-2 rounded-lg hover:bg-cyan-500/20"><Eye size={15} className="text-cyan-400" /></button>
                        {!item.acknowledgedAt && (
                          <button onClick={() => handleAcknowledge(item.id)}
                            className="p-2 rounded-lg hover:bg-blue-500/20"><CheckCircle size={15} className="text-blue-400" /></button>
                        )}
                        {!item.resolvedAt && (
                          <button onClick={() => handleResolve(item.id)}
                            className="p-2 rounded-lg hover:bg-green-500/20"><XCircle size={15} className="text-green-400" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer for Desktop */}
          <div className={`flex flex-wrap items-center justify-between gap-4 p-4 border-t ${themeConfig.cardBorder} bg-white/[0.01]`}>
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
                {t('imageService.alerts.totalAlerts', 'ทั้งหมด {{count}} รายการ', { count: data?.total ?? 0 })}
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
                  max={totalPages || 1}
                  onChange={(e) => {
                    const val = Number(e.target.value)
                    if (val >= 1 && val <= (totalPages || 1)) setPage(val)
                  }}
                  className={`w-10 px-1 py-1 rounded text-xs text-center border ${themeConfig.inputBorder} ${themeConfig.card} ${themeConfig.text.primary} focus:outline-none focus:border-cyan-500 bg-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                />
                <span className={`text-xs ${themeConfig.text.secondary}`}>/ {totalPages || 1}</span>
              </div>

              <button
                disabled={page >= (totalPages || 1)}
                onClick={() => setPage(p => p + 1)}
                className={`px-2.5 py-1.5 rounded text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30 disabled:hover:bg-transparent hover:bg-white/5 transition-colors`}
              >
                {t('common.next', 'ถัดไป')} ›
              </button>
              <button
                disabled={page >= (totalPages || 1)}
                onClick={() => setPage(totalPages || 1)}
                className={`px-2.5 py-1.5 rounded text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30 disabled:hover:bg-transparent hover:bg-white/5 transition-colors`}
              >
                {t('common.last', 'หน้าสุดท้าย')} »
              </button>
            </div>
          </div>
        </div>

        {items.length === 0 && (
          <div className={`text-center py-12 ${themeConfig.text.secondary} text-sm`}>
            {t('imageService.alerts.noAlerts')}
          </div>
        )}

        {/* Pagination Footer for Mobile */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-5 md:hidden">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className={`px-3 py-1.5 rounded-lg text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30`}>
              {t('common.prev')}
            </button>
            <span className={`text-xs ${themeConfig.text.secondary}`}>{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className={`px-3 py-1.5 rounded-lg text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30`}>
              {t('common.next')}
            </button>
          </div>
        )}
        </>
      )}

      <Modal isOpen={!!viewing} onClose={() => setViewing(null)} title={t('imageService.alerts.detail')}>
        {viewing && (
          <div className="space-y-4 p-1 max-w-xl">
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-cyan-400" />
              <h3 className={`text-base font-semibold ${themeConfig.text.primary}`}>{translateAlertTitle(viewing.title, t)}</h3>
            </div>
            <p className={`text-sm ${themeConfig.text.secondary}`}>{translateAlertMessage(viewing.message, t, incidentLabels, i18n.language)}</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {[
                [t('imageService.alerts.severity'), viewing.severity],
                [t('imageService.alerts.source'), viewing.source ?? '—'],
                [t('imageService.alerts.type'), viewing.alertType],
                [t('imageService.alerts.createdAt'), formatDateTime(viewing.createdAt, i18n.language)],
                [t('imageService.alerts.acknowledgedAt'), viewing.acknowledgedAt ? formatDateTime(viewing.acknowledgedAt, i18n.language) : '—'],
                [t('imageService.alerts.resolvedAt'), viewing.resolvedAt ? formatDateTime(viewing.resolvedAt, i18n.language) : '—'],
              ].map(([k, v], i) => (
                <div key={i} className={`px-3 py-2 rounded-lg ${themeConfig.card}`}>
                  <span className={themeConfig.text.secondary}>{k}</span>
                  <p className={`font-medium mt-0.5 ${themeConfig.text.primary}`}>{v}</p>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
              {!viewing.acknowledgedAt && (
                <Button onClick={() => { handleAcknowledge(viewing.id); setViewing(null) }}>{t('imageService.alerts.acknowledge')}</Button>
              )}
              {!viewing.resolvedAt && (
                <Button onClick={() => { handleResolve(viewing.id); setViewing(null) }} className="!bg-green-600 hover:!bg-green-700 text-white">
                  {t('imageService.alerts.resolve')}
                </Button>
              )}
              <Button variant="secondary" onClick={() => setViewing(null)}>{t('common.close')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {clearDialogOpen && (
        <Modal isOpen={clearDialogOpen} onClose={() => { setClearDialogOpen(false); setClearPassword('') }} title={t('imageService.alerts.clearAllTitle', 'ยืนยันล้างแจ้งเตือนทั้งหมด')}>
          <div className="space-y-4 p-1 max-w-md">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-400 mb-1">
                  {t('imageService.alerts.clearAllWarningTitle', 'คำเตือน')}
                </p>
                <p className={`text-xs ${themeConfig.text.secondary}`}>
                  {t('imageService.alerts.clearAllWarning', 'การดำเนินการนี้จะล้างการแจ้งเตือนที่ยังไม่ได้แก้ไขทั้งหมดออกจากระบบอย่างถาวร ข้อมูลนี้จะไม่สามารถกู้คืนกลับมาได้อีก')}
                </p>
              </div>
            </div>

            <div>
              <label className={`block text-xs font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('imageService.alerts.clearAllPasswordConfirm', 'กรุณากรอกรหัสผ่านเพื่อยืนยันการล้างแจ้งเตือน')}
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={clearPassword}
                onChange={e => setClearPassword(e.target.value)}
                placeholder={t('imageService.alerts.clearAllPasswordPlaceholder', 'รหัสผ่านของคุณ')}
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
                onClick={handleClearAllAlerts}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-500 text-white disabled:opacity-40 flex items-center gap-1.5"
              >
                {clearing ? (
                  <div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <Trash2 size={13} />
                )}
                {t('imageService.alerts.clearAll') !== 'imageService.alerts.clearAll' ? t('imageService.alerts.clearAll') : t('common.clearAll')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
