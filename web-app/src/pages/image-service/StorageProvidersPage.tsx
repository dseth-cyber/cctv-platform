import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTheme } from '@/contexts/ThemeContext'
import { useToast } from '@/contexts/ToastContext'
import { imageServiceApi } from '@/services/imageServiceApi'
import { Button, Modal, TableSkeleton, SearchableSelect } from '@/components/ui'
import { Plus, HardDrive, CheckCircle, XCircle, TestTube, Star, Trash2, Edit3, Server, Wifi, Clock, ToggleLeft, ToggleRight, Gauge, AlertTriangle, Sparkles } from 'lucide-react'

const PRESSURE_COLORS: Record<string, string> = {
  normal: 'bg-green-500/20 text-green-300',
  warning: 'bg-yellow-500/20 text-yellow-300',
  pressure: 'bg-orange-500/20 text-orange-300',
  critical: 'bg-red-500/20 text-red-300',
  emergency: 'bg-red-600/30 text-red-200',
}

function PressureBadge({ providerId }: { providerId: string }) {
  const { t } = useTranslation()
  const { data } = useQuery({
    queryKey: ['storage-pressure-state', providerId],
    queryFn: () => imageServiceApi.getStoragePressureState(providerId),
    staleTime: 30000,
    refetchInterval: 60000,
  })
  const state = data?.state ?? 'normal'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${PRESSURE_COLORS[state] ?? PRESSURE_COLORS.normal}`}>
      <Gauge size={10} />
      {t(`imageService.storageProviders.pressure.${state}`)}
      {typeof data?.percent === 'number' && data.percent > 0 ? ` (${data.percent.toFixed(1)}%)` : ''}
    </span>
  )
}

const TYPE_LABEL: Record<string, string> = {
  s3: 'storageProviders.s3',
  local: 'storageProviders.local',
  smb: 'storageProviders.smb',
  nfs: 'storageProviders.nfs',
  seaweedfs: 'storageProviders.seaweedfs',
}

const TYPE_ICON: Record<string, any> = {
  s3: Server,
  seaweedfs: Server,
  local: HardDrive,
  smb: HardDrive,
  nfs: HardDrive,
}

export default function StorageProvidersPage() {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<any | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, any>>({})
  const [cleanupTarget, setCleanupTarget] = useState<any | null>(null)

  const { data: providers, isLoading } = useQuery({
    queryKey: ['storage-providers'],
    queryFn: () => imageServiceApi.getStorageProviders(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.deleteStorageProvider(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-providers'] })
      toast.success(t('imageService.storageProviders.deleteSuccess'))
      setDeleteTarget(null)
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || t('common.error'))
    },
  })

  const testMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.testStorageProvider(id),
    onSuccess: (data: any, id) => {
      setTestResults(prev => ({ ...prev, [id]: data }))
      setTestingId(null)
      if (data?.ok) toast.success(t('imageService.storageProviders.testSuccess'))
      else toast.error(`${t('imageService.storageProviders.testFailed')}: ${data?.error ?? ''}`)
    },
    onError: (err: any, id) => {
      setTestingId(null)
      toast.error(err?.response?.data?.message || t('imageService.storageProviders.testFailed'))
    },
  })

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      imageServiceApi.updateStorageProvider(id, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-providers'] })
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || t('common.error'))
    },
  })

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) =>
      imageServiceApi.updateStorageProvider(id, { isDefault: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-providers'] })
      toast.success(t('imageService.storageProviders.defaultSet'))
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || t('common.error'))
    },
  })

  const handleTest = async (id: string) => {
    setTestingId(id)
    testMutation.mutate(id)
  }

  const handleDelete = () => {
    if (!deleteTarget) return
    deleteMutation.mutate(deleteTarget.id)
  }

  const handleEdit = (provider: any) => {
    setEditTarget(provider)
    setShowForm(true)
  }

  const typeIcon = (type: string) => {
    const Icon = TYPE_ICON[type] || HardDrive
    const color = type === 's3' || type === 'seaweedfs' ? 'text-blue-400' : 'text-amber-400'
    return <Icon size={16} className={color} />
  }

  const thClass = `px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${themeConfig.text.secondary}`
  const tdClass = `px-4 py-3 text-sm ${themeConfig.text.primary}`

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
            iSmart CCTV · {t('imageService.storageProviders.title')}
          </p>
          <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.storageProviders.title')}</h1>
          <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.storageProviders.subtitle')}</p>
        </div>
        <Button onClick={() => { setEditTarget(null); setShowForm(true) }}>
          <Plus size={16} className="mr-1" /> {t('imageService.storageProviders.newProvider')}
        </Button>
      </div>

      {isLoading ? (
        <TableSkeleton rows={4} cols={8} />
      ) : !providers?.length ? (
        <div className={`flex flex-col items-center justify-center py-20 ${themeConfig.text.secondary}`}>
          <HardDrive size={48} className="mb-4 opacity-30" />
          <p className="text-lg font-medium">{t('imageService.storageProviders.noProviders')}</p>
        </div>
      ) : (
        <div className={`rounded-lg overflow-hidden border ${themeConfig.card}`}>
          <table className="w-full">
            <thead className={themeConfig.name === 'light' ? 'bg-gray-100' : 'bg-white/5'}>
              <tr>
                <th className={thClass}>{t('imageService.storageProviders.providerName')}</th>
                <th className={thClass}>{t('imageService.storageProviders.providerType')}</th>
                <th className={thClass}>{t('imageService.storageProviders.status')}</th>
                <th className={thClass}>{t('imageService.storageProviders.default')}</th>
                <th className={thClass}>{t('imageService.storageProviders.health')}</th>
                <th className={thClass}>{t('imageService.storageProviders.pressure.title')}</th>
                <th className={thClass}>{t('imageService.storageProviders.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {providers.map((p: any) => {
                const testResult = testResults[p.id]
                return (
                  <tr key={p.id} className="hover:bg-white/5 transition-colors">
                    <td className={tdClass}>
                      <div className="flex items-center gap-2">
                        {typeIcon(p.type)}
                        <span className="font-medium">{p.name}</span>
                      </div>
                    </td>
                    <td className={tdClass}>
                      <span className="text-xs">{t(`imageService.${TYPE_LABEL[p.type] || TYPE_LABEL.local}`)}</span>
                    </td>
                    <td className={tdClass}>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        p.isActive ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
                      }`}>
                        {p.isActive ? <CheckCircle size={10} /> : <XCircle size={10} />}
                        {p.isActive ? t('imageService.storageProviders.active') : t('imageService.storageProviders.inactive')}
                      </span>
                    </td>
                    <td className={tdClass}>
                      {p.isDefault ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-500/20 text-cyan-300">
                          <Star size={10} /> {t('imageService.storageProviders.default')}
                        </span>
                      ) : (
                        <span className={`text-xs ${themeConfig.text.secondary}`}>—</span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {testResult ? (
                        <div className={`flex items-center gap-1.5 text-xs ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                          {testResult.ok ? <CheckCircle size={12} /> : <XCircle size={12} />}
                          <span>{testResult.ok ? `${testResult.latencyMs}ms` : testResult.error}</span>
                        </div>
                      ) : p.isActive ? (
                        <button onClick={() => handleTest(p.id)} className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
                          {testingId === p.id ? '...' : t('imageService.storageProviders.testConnection')}
                        </button>
                      ) : (
                        <span className={`text-xs ${themeConfig.text.secondary}`}>—</span>
                      )}
                    </td>
                    <td className={tdClass}>
                      <PressureBadge providerId={p.id} />
                    </td>
                    <td className={tdClass}>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setCleanupTarget(p)}
                          className="p-1.5 rounded text-amber-400 hover:bg-amber-500/20 transition-colors"
                          title={t('imageService.storageProviders.cleanup.title')}>
                          <Sparkles size={15} />
                        </button>
                        <button onClick={() => toggleActiveMutation.mutate({ id: p.id, isActive: !p.isActive })}
                          className={`p-1.5 rounded transition-colors ${p.isActive ? 'text-green-400 hover:bg-green-500/20' : 'text-gray-500 hover:bg-white/10'}`}
                          title={p.isActive ? t('imageService.storageProviders.disable') : t('imageService.storageProviders.enable')}>
                          {p.isActive ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                        </button>
                        {!p.isDefault && p.isActive && (
                          <button onClick={() => setDefaultMutation.mutate(p.id)}
                            className="p-1.5 rounded text-yellow-400 hover:bg-yellow-500/20 transition-colors"
                            title={t('imageService.storageProviders.setDefault')}>
                            <Star size={15} />
                          </button>
                        )}
                        <button onClick={() => handleEdit(p)}
                          className="p-1.5 rounded text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                          title={t('imageService.storageProviders.edit')}>
                          <Edit3 size={15} />
                        </button>
                        <button onClick={() => setDeleteTarget(p)} disabled={p.isDefault}
                          className={`p-1.5 rounded transition-colors ${p.isDefault ? 'text-gray-600 cursor-not-allowed' : 'text-red-400 hover:bg-red-500/20'}`}
                          title={t('common.delete')}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <StorageProviderFormModal
        key={editTarget?.id ?? 'new'}
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditTarget(null) }}
        editTarget={editTarget}
      />

      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)}
        title={t('common.deleteConfirm')}>
        <div className="p-1 space-y-4">
          <p className={`text-sm ${themeConfig.text.secondary}`}>{t('imageService.storageProviders.deleteConfirm')}</p>
          <p className={`text-sm font-medium ${themeConfig.text.primary}`}>{deleteTarget?.name}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
            <Button className="!bg-red-600 hover:!bg-red-700 text-white" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {t('common.delete')}
            </Button>
          </div>
        </div>
      </Modal>

      <CleanupModal provider={cleanupTarget} onClose={() => setCleanupTarget(null)} />
    </div>
  )
}

function CleanupModal({ provider, onClose }: { provider: any | null; onClose: () => void }) {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [trigger, setTrigger] = useState<'manual' | 'emergency'>('manual')
  const [plan, setPlan] = useState<any | null>(null)
  const [simulating, setSimulating] = useState(false)
  const [password, setPassword] = useState('')
  const [executing, setExecuting] = useState(false)

  const runSimulate = async (t2: 'manual' | 'emergency') => {
    if (!provider) return
    setSimulating(true)
    setPlan(null)
    try {
      const result = await imageServiceApi.simulateCleanup(provider.id, t2)
      setPlan(result)
    } catch (e: any) {
      if (!e?._handled) toast.error(t('common.error'))
    } finally {
      setSimulating(false)
    }
  }

  const handleOpenChange = (t2: 'manual' | 'emergency') => {
    setTrigger(t2)
    runSimulate(t2)
  }

  useEffect(() => {
    if (provider) runSimulate('manual')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider?.id])

  const handleExecute = async () => {
    if (!provider || !password) return
    setExecuting(true)
    try {
      const result = await imageServiceApi.executeCleanup(provider.id, trigger, password)
      toast.success(t('imageService.storageProviders.cleanup.executeSuccess', {
        count: result.filesDeleted,
        size: (result.bytesFreed / 1024 / 1024 / 1024).toFixed(2),
      }))
      queryClient.invalidateQueries({ queryKey: ['storage-pressure-state', provider.id] })
      setPassword('')
      setPlan(null)
      onClose()
    } catch (e: any) {
      if (e?.response?.status === 403 || e?.response?.status === 400) {
        toast.error(t('imageService.storageProviders.cleanup.passwordError'))
      } else if (!e?._handled) {
        toast.error(t('common.error'))
      }
    } finally {
      setExecuting(false)
    }
  }

  const handleClose = () => {
    setPlan(null)
    setPassword('')
    setTrigger('manual')
    onClose()
  }

  if (!provider) return null

  return (
    <Modal isOpen={!!provider} onClose={handleClose} title={`${t('imageService.storageProviders.cleanup.title')} — ${provider.name}`} size="2xl">
      <div className="space-y-4 p-1 max-w-full">
        <div className="flex gap-2">
          <button onClick={() => handleOpenChange('manual')}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${trigger === 'manual' ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-300' : `${themeConfig.cardBorder} ${themeConfig.text.secondary} hover:bg-white/5`}`}>
            {t('imageService.storageProviders.cleanup.modeManual')}
          </button>
          <button onClick={() => handleOpenChange('emergency')}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${trigger === 'emergency' ? 'bg-red-600/20 border-red-500/40 text-red-300' : `${themeConfig.cardBorder} ${themeConfig.text.secondary} hover:bg-white/5`}`}>
            {t('imageService.storageProviders.cleanup.modeEmergency')}
          </button>
        </div>

        {trigger === 'emergency' && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.storageProviders.cleanup.emergencyWarning')}</p>
          </div>
        )}

        {simulating ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full" />
          </div>
        ) : plan ? (
          <div className={`rounded-lg border ${themeConfig.cardBorder} ${themeConfig.card} p-4 space-y-3`}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className={themeConfig.text.secondary}>{t('imageService.storageProviders.cleanup.currentUsage')}</span>
                <p className={`font-semibold ${themeConfig.text.primary}`}>{plan.usagePercent.toFixed(1)}%</p>
              </div>
              <div>
                <span className={themeConfig.text.secondary}>{t('imageService.storageProviders.cleanup.afterCleanup')}</span>
                <p className="font-semibold text-green-400">{plan.wouldFreeToPercent.toFixed(1)}%</p>
              </div>
              <div>
                <span className={themeConfig.text.secondary}>{t('imageService.storageProviders.cleanup.filesToDelete')}</span>
                <p className={`font-semibold ${themeConfig.text.primary}`}>{plan.candidateCount.toLocaleString()}</p>
              </div>
              <div>
                <span className={themeConfig.text.secondary}>{t('imageService.storageProviders.cleanup.spaceToFree')}</span>
                <p className="font-semibold text-cyan-400">{(plan.candidateBytes / 1024 / 1024 / 1024).toFixed(2)}{' '}{t('ui.storageProvidersPage.gb')}</p>
              </div>
            </div>

            {Object.keys(plan.byFileType).length > 0 && (
              <div className="pt-2 border-t border-white/10">
                <p className={`text-xs font-medium mb-1.5 ${themeConfig.text.secondary}`}>{t('imageService.storageProviders.cleanup.byFileType')}</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(plan.byFileType).map(([type, v]: [string, any]) => (
                    <span key={type} className={`px-2 py-1 rounded text-xs ${themeConfig.card} border ${themeConfig.cardBorder}`}>
                      {type}: {v.count} ({(v.bytes / 1024 / 1024 / 1024).toFixed(2)}{' '}{t('ui.storageProvidersPage.gb2')}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {plan.affectedCameras.length > 0 && (
              <div className="pt-2 border-t border-white/10">
                <p className={`text-xs font-medium mb-1.5 ${themeConfig.text.secondary}`}>
                  {t('imageService.storageProviders.cleanup.affectedCameras', { count: plan.affectedCameras.length })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {plan.affectedCameras.map((c: any) => (
                    <span key={c.id} className={`px-2 py-1 rounded text-xs ${themeConfig.card} border ${themeConfig.cardBorder}`}>
                      {c.name}: {c.files} ({(c.bytes / 1024 / 1024 / 1024).toFixed(2)}{' '}{t('ui.storageProvidersPage.gb2')}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {plan.candidateCount === 0 && (
              <p className={`text-sm text-center py-2 ${themeConfig.text.secondary}`}>{t('imageService.storageProviders.cleanup.noCandidates')}</p>
            )}
          </div>
        ) : null}

        {plan && plan.candidateCount > 0 && (
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
              {t('imageService.storageProviders.cleanup.passwordConfirm')}
            </label>
            <input
              type="password" autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={t('imageService.storageProviders.cleanup.passwordPlaceholder')}
              className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-red-500/50`}
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
          <Button variant="secondary" onClick={handleClose}>{t('common.close')}</Button>
          {plan && plan.candidateCount > 0 && (
            <button
              onClick={handleExecute}
              disabled={executing || !password}
              className={`px-4 py-2 rounded-md text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors ${trigger === 'emergency' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}
            >
              {executing ? (
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <Sparkles size={14} />
              )}
              {trigger === 'emergency' ? t('imageService.storageProviders.cleanup.executeEmergency') : t('imageService.storageProviders.cleanup.executeManual')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function StorageProviderFormModal({ isOpen, onClose, editTarget }: { isOpen: boolean; onClose: () => void; editTarget: any | null }) {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()
  const toast = useToast()
  const queryClient = useQueryClient()
  const isEdit = !!editTarget

  const [name, setName] = useState(editTarget?.name || '')
  const [type, setType] = useState(editTarget?.type || 'local')
  const [endpoint, setEndpoint] = useState(editTarget?.config?.endpoint || '')
  const [port, setPort] = useState(editTarget?.config?.port?.toString() || '9000')
  const [accessKey, setAccessKey] = useState(editTarget?.config?.accessKey || '')
  const [secretKey, setSecretKey] = useState(editTarget?.config?.secretKey || '')
  const [bucket, setBucket] = useState(editTarget?.config?.bucket || '')
  const [useSSL, setUseSSL] = useState(editTarget?.config?.useSSL || false)
  const [region, setRegion] = useState(editTarget?.config?.region || '')
  const [basePath, setBasePath] = useState(editTarget?.config?.basePath || '')
  const [share, setShare] = useState(editTarget?.config?.share || '')
  const [smbDomain, setSmbDomain] = useState(editTarget?.config?.domain || '')
  const [smbUsername, setSmbUsername] = useState(editTarget?.config?.username || '')
  const [smbPassword, setSmbPassword] = useState(editTarget?.config?.password || '')
  const [nfsServer, setNfsServer] = useState(editTarget?.config?.server || '')
  const [nfsExportPath, setNfsExportPath] = useState(editTarget?.config?.exportPath || '')
  const [nfsMountOptions, setNfsMountOptions] = useState(editTarget?.config?.mountOptions || '')
  const [mountPath, setMountPath] = useState(editTarget?.config?.mountPath || '')
  const [description, setDescription] = useState(editTarget?.description || '')
  const [isDefault, setIsDefault] = useState(editTarget?.isDefault || false)
  const [priority, setPriority] = useState(editTarget?.priority?.toString() || '0')
  const [capacityGb, setCapacityGb] = useState(editTarget?.capacityBytes ? (Number(editTarget.capacityBytes) / 1024 / 1024 / 1024).toString() : '')
  const [pressureWarningPercent, setPressureWarningPercent] = useState(editTarget?.pressureWarningPercent?.toString() ?? '75')
  const [pressureStartPercent, setPressureStartPercent] = useState(editTarget?.pressureStartPercent?.toString() ?? '90')
  const [pressureStopPercent, setPressureStopPercent] = useState(editTarget?.pressureStopPercent?.toString() ?? '80')
  const [pressureCriticalPercent, setPressureCriticalPercent] = useState(editTarget?.pressureCriticalPercent?.toString() ?? '95')
  const [pressureEmergencyPercent, setPressureEmergencyPercent] = useState(editTarget?.pressureEmergencyPercent?.toString() ?? '98')
  const [backpressureStrategy, setBackpressureStrategy] = useState(editTarget?.backpressureStrategy ?? 'continue_polling')
  const [submitting, setSubmitting] = useState(false)
  const [detectedCapacity, setDetectedCapacity] = useState<{ totalBytes: number; freeBytes: number } | null>(null)

  const detectCapacityMutation = useMutation({
    mutationFn: () => imageServiceApi.refreshStorageProviderCapacity(editTarget.id),
    onSuccess: (data: any) => {
      if (!data.detectedTotalBytes) {
        toast.error(t('imageService.storageProviders.capacityDetectUnsupported'))
        return
      }
      setDetectedCapacity({ totalBytes: data.detectedTotalBytes, freeBytes: data.detectedFreeBytes })
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || t('common.error'))
    },
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => imageServiceApi.createStorageProvider(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-providers'] })
      toast.success(t('imageService.storageProviders.created'))
      onClose()
    },
    onError: (err: any) => { if (!err?._handled) toast.error(err?.response?.data?.message || t('common.error')); },
    onSettled: () => setSubmitting(false),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => imageServiceApi.updateStorageProvider(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-providers'] })
      toast.success(t('imageService.storageProviders.updated'))
      onClose()
    },
    onError: (err: any) => { if (!err?._handled) toast.error(err?.response?.data?.message || t('common.error')); },
    onSettled: () => setSubmitting(false),
  })

  const buildConfig = () => {
    switch (type) {
      case 's3':
      case 'seaweedfs':
        return { endpoint, port: parseInt(port, 10), accessKey, secretKey, bucket, useSSL, ...(region ? { region } : {}) }
      case 'local':
        return { basePath }
      case 'smb':
        return { share, username: smbUsername, password: smbPassword, ...(smbDomain ? { domain: smbDomain } : {}), ...(mountPath ? { mountPath } : {}) }
      case 'nfs':
        return { server: nfsServer, exportPath: nfsExportPath, ...(nfsMountOptions ? { mountOptions: nfsMountOptions } : {}), ...(mountPath ? { mountPath } : {}) }
      default:
        return {}
    }
  }

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error(t('ui.storageProvidersPage.nameIsRequired')); return }
    setSubmitting(true)
    const config = buildConfig()
    const capBytes = capacityGb ? Math.round(parseFloat(capacityGb) * 1024 * 1024 * 1024) : undefined
    const payload = {
      name: name.trim(), type, config, description: description.trim() || undefined, isDefault,
      priority: parseInt(priority, 10) || 0, capacityBytes: capBytes,
      pressureWarningPercent: parseFloat(pressureWarningPercent) || 75,
      pressureStartPercent: parseFloat(pressureStartPercent) || 90,
      pressureStopPercent: parseFloat(pressureStopPercent) || 80,
      pressureCriticalPercent: parseFloat(pressureCriticalPercent) || 95,
      pressureEmergencyPercent: parseFloat(pressureEmergencyPercent) || 98,
      backpressureStrategy,
    }
    if (isEdit) {
      updateMutation.mutate({ id: editTarget.id, data: payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  const inputClass = `w-full px-3 py-2 rounded-md text-sm border border-white/30 bg-white/10 backdrop-blur-md text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50`
  const labelClass = `block text-sm font-medium text-white mb-1`

  return (
    <Modal isOpen={isOpen} onClose={onClose}
      title={isEdit ? t('imageService.storageProviders.editProvider') : t('imageService.storageProviders.newProvider')}
      size="2xl">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto px-1">
        <div>
          <label className={labelClass}>{t('imageService.storageProviders.providerName')}</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputClass} placeholder={t('ui.storageProvidersPage.primaryStorage')} />
        </div>
        <div>
          <label className={labelClass}>{t('imageService.storageProviders.providerType')}</label>
          <SearchableSelect
            value={type}
            onChange={setType}
            options={[
              { value: 'local', label: t('imageService.storageProviders.local') },
              { value: 's3', label: t('imageService.storageProviders.s3') },
              { value: 'seaweedfs', label: t('imageService.storageProviders.seaweedfs') },
              { value: 'smb', label: t('imageService.storageProviders.smb') },
              { value: 'nfs', label: t('imageService.storageProviders.nfs') },
            ]}
          />
        </div>

        {(type === 's3' || type === 'seaweedfs') && (
          <>
            {type === 'seaweedfs' && (
              <p className={`text-xs px-3 py-2 rounded ${themeConfig.card} ${themeConfig.text.secondary}`}>
                {t('imageService.storageProviders.seaweedfsHint')}
              </p>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>{t('imageService.storageProviders.endpoint')}</label>
                <input type="text" value={endpoint} onChange={e => setEndpoint(e.target.value)} className={inputClass} placeholder={type === 'seaweedfs' ? 'seaweedfs-filer' : 'minio'} />
              </div>
              <div>
                <label className={labelClass}>{t('imageService.storageProviders.port')}</label>
                <input type="number" value={port} onChange={e => setPort(e.target.value)} className={inputClass} placeholder={type === 'seaweedfs' ? '8333' : '9000'} />
              </div>
            </div>
            <div>
              <label className={labelClass}>{t('imageService.storageProviders.bucket')}</label>
              <input type="text" value={bucket} onChange={e => setBucket(e.target.value)} className={inputClass} placeholder="images" />
            </div>
            <div>
              <label className={labelClass}>{t('imageService.storageProviders.region')}</label>
              <input type="text" value={region} onChange={e => setRegion(e.target.value)} className={inputClass} placeholder="us-east-1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>{t('imageService.storageProviders.accessKey')}</label>
                <input type="text" value={accessKey} onChange={e => setAccessKey(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>{t('imageService.storageProviders.secretKey')}</label>
                <input type="password" autoComplete="new-password" value={secretKey} onChange={e => setSecretKey(e.target.value)} className={inputClass} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="useSSL" checked={useSSL} onChange={e => setUseSSL(e.target.checked)}
                className="rounded border-white/30 bg-white/10" />
              <label htmlFor="useSSL" className="text-sm text-white">{t('imageService.storageProviders.useSSL')}</label>
            </div>
          </>
        )}

        {type === 'local' && (
          <div>
            <label className={labelClass}>{t('imageService.storageProviders.basePath')}</label>
            <input type="text" value={basePath} onChange={e => setBasePath(e.target.value)} className={inputClass} placeholder="/data/images" />
          </div>
        )}

        {type === 'smb' && (
          <>
            <div>
              <label className={labelClass}>{t('imageService.storageProviders.share')}</label>
              <input type="text" value={share} onChange={e => setShare(e.target.value)} className={inputClass} placeholder="//server/share" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>{t('imageService.storageProviders.username')}</label>
                <input type="text" value={smbUsername} onChange={e => setSmbUsername(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>{t('imageService.storageProviders.password')}</label>
                <input type="password" autoComplete="new-password" value={smbPassword} onChange={e => setSmbPassword(e.target.value)} className={inputClass} />
              </div>
            </div>
            <div>
              <label className={labelClass}>{t('imageService.storageProviders.domain')}</label>
              <input type="text" value={smbDomain} onChange={e => setSmbDomain(e.target.value)} className={inputClass} placeholder="WORKGROUP" />
            </div>
            <div>
              <label className={labelClass}>{t('imageService.storageProviders.mountPath')}</label>
              <input type="text" value={mountPath} onChange={e => setMountPath(e.target.value)} className={inputClass} placeholder="/mnt/host-storage/nas" />
              <p className="text-xs text-white/40 mt-1">{t('imageService.storageProviders.mountPathHint')}</p>
            </div>
          </>
        )}

        {type === 'nfs' && (
          <>
            <div>
              <label className={labelClass}>{t('imageService.storageProviders.nfsServer')}</label>
              <input type="text" value={nfsServer} onChange={e => setNfsServer(e.target.value)} className={inputClass} placeholder="10.0.0.10" />
            </div>
            <div>
              <label className={labelClass}>{t('imageService.storageProviders.nfsExportPath')}</label>
              <input type="text" value={nfsExportPath} onChange={e => setNfsExportPath(e.target.value)} className={inputClass} placeholder="/export/images" />
            </div>
            <div>
              <label className={labelClass}>{t('imageService.storageProviders.nfsMountOptions')}</label>
              <input type="text" value={nfsMountOptions} onChange={e => setNfsMountOptions(e.target.value)} className={inputClass} placeholder="vers=4.2,hard,intr" />
            </div>
            <div>
              <label className={labelClass}>{t('imageService.storageProviders.mountPath')}</label>
              <input type="text" value={mountPath} onChange={e => setMountPath(e.target.value)} className={inputClass} placeholder="/mnt/host-storage/nas" />
              <p className="text-xs text-white/40 mt-1">{t('imageService.storageProviders.mountPathHint')}</p>
            </div>
          </>
        )}

        <div>
          <label className={labelClass}>{t('imageService.storageProviders.description')}</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>{t('imageService.storageProviders.capacityGb')}</label>
          <div className="flex gap-2">
            <input type="number" value={capacityGb} onChange={e => setCapacityGb(e.target.value)} className={inputClass}
              placeholder={type === 'local' ? t('imageService.storageProviders.capacityAutoHint') : '500'} />
            {isEdit && type === 'seaweedfs' && (
              <Button type="button" variant="secondary" disabled={detectCapacityMutation.isPending}
                onClick={() => detectCapacityMutation.mutate()}>
                {detectCapacityMutation.isPending
                  ? t('imageService.storageProviders.capacityDetecting')
                  : t('imageService.storageProviders.capacityDetectButton')}
              </Button>
            )}
          </div>
          <p className={`text-xs mt-1 ${themeConfig.text.secondary}`}>
            {type === 'local'
              ? t('imageService.storageProviders.capacityAutoDesc')
              : type === 'seaweedfs'
                ? t('imageService.storageProviders.capacityDetectDesc')
                : t('imageService.storageProviders.capacityManualDesc')}
          </p>
          {detectedCapacity && (
            <div className={`mt-2 flex items-center justify-between gap-2 text-xs rounded-md px-3 py-2 ${themeConfig.name === 'light' ? 'bg-cyan-50 border border-cyan-200' : 'bg-cyan-500/10 border border-cyan-500/20'}`}>
              <span className={themeConfig.text.primary}>
                {t('imageService.storageProviders.capacityDetectedResult', {
                  total: (detectedCapacity.totalBytes / 1024 / 1024 / 1024).toFixed(1),
                  free: (detectedCapacity.freeBytes / 1024 / 1024 / 1024).toFixed(1),
                })}
              </span>
              <button type="button" className="text-cyan-400 hover:text-cyan-300 font-medium shrink-0"
                onClick={() => setCapacityGb((detectedCapacity.totalBytes / 1024 / 1024 / 1024).toFixed(0))}>
                {t('imageService.storageProviders.capacityUseDetected')}
              </button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>{t('imageService.storageProviders.priority')}</label>
            <input type="number" value={priority} onChange={e => setPriority(e.target.value)} className={inputClass} />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)}
                className="rounded border-white/30 bg-white/10" />
              <span className="text-sm text-white">{t('imageService.storageProviders.isDefault')}</span>
            </label>
          </div>
        </div>
        <div className="pt-2 border-t border-white/10">
          <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${themeConfig.text.secondary}`}>
            {t('imageService.storageProviders.pressure.sectionTitle')}
          </p>
          <p className={`text-xs mb-3 ${themeConfig.text.secondary}`}>{t('imageService.storageProviders.pressure.sectionDesc')}</p>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <label className={labelClass}>{t('imageService.storageProviders.pressure.warningThreshold')}</label>
              <input type="number" min={0} max={100} value={pressureWarningPercent} onChange={e => setPressureWarningPercent(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t('imageService.storageProviders.pressure.startThreshold')}</label>
              <input type="number" min={0} max={100} value={pressureStartPercent} onChange={e => setPressureStartPercent(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t('imageService.storageProviders.pressure.stopThreshold')}</label>
              <input type="number" min={0} max={100} value={pressureStopPercent} onChange={e => setPressureStopPercent(e.target.value)} className={inputClass} />
              <p className={`text-[11px] mt-1 ${themeConfig.text.secondary}`}>{t('imageService.storageProviders.pressure.stopHint')}</p>
            </div>
            <div>
              <label className={labelClass}>{t('imageService.storageProviders.pressure.criticalThreshold')}</label>
              <input type="number" min={0} max={100} value={pressureCriticalPercent} onChange={e => setPressureCriticalPercent(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t('imageService.storageProviders.pressure.emergencyThreshold')}</label>
              <input type="number" min={0} max={100} value={pressureEmergencyPercent} onChange={e => setPressureEmergencyPercent(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t('imageService.storageProviders.pressure.backpressureStrategy')}</label>
              <SearchableSelect
                value={backpressureStrategy}
                onChange={setBackpressureStrategy}
                options={[
                  { value: 'continue_polling', label: t('imageService.storageProviders.pressure.continuePolling') },
                  { value: 'stop_polling', label: t('imageService.storageProviders.pressure.stopPolling') },
                ]}
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
