import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTheme } from '@/contexts/ThemeContext'
import { useToast } from '@/contexts/ToastContext'
import { imageServiceApi } from '@/services/imageServiceApi'
import { getLocalizedValue } from '@/utils/textUtils'
import { Button, Modal, TableSkeleton, SearchableSelect } from '@/components/ui'
import { Plus, LayoutTemplate, Edit3, Trash2, CheckCircle, XCircle, Star } from 'lucide-react'

const SOURCE_EXTENSIONS = ['tif', 'tiff', 'ptif', 'ptiff', 'jpg', 'jpeg', 'png', 'bmp']

export default function CameraTemplates() {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<any | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)

  const { data: templates, isLoading } = useQuery({
    queryKey: ['camera-templates'],
    queryFn: () => imageServiceApi.getCameraTemplates(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.deleteCameraTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['camera-templates'] })
      toast.success(t('imageService.cameraTemplates.deleted'))
      setDeleteTarget(null)
    },
    onError: (err: any) => { if (!err?._handled) toast.error(err?.response?.data?.message || t('common.error')) },
  })

  const handleEdit = (tpl: any) => { setEditTarget(tpl); setShowForm(true) }
  const handleDelete = () => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id) }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
            Image Service · {t('imageService.cameraTemplates.title')}
          </p>
          <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.cameraTemplates.title')}</h1>
          <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.cameraTemplates.subtitle')}</p>
        </div>
        <Button onClick={() => { setEditTarget(null); setShowForm(true) }}>
          <Plus size={16} className="mr-1" /> {t('imageService.cameraTemplates.newTemplate')}
        </Button>
      </div>

      {isLoading ? (
        <TableSkeleton rows={4} cols={7} />
      ) : !templates?.length ? (
        <div className={`flex flex-col items-center justify-center py-20 ${themeConfig.text.secondary}`}>
          <LayoutTemplate size={48} className="mb-4 opacity-30" />
          <p className="text-lg font-medium">{t('imageService.cameraTemplates.noTemplates')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className={`${themeConfig.tableHeader}`}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">{t('imageService.cameraTemplates.name')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('imageService.cameraTemplates.acceptedExtensions')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('imageService.cameraTemplates.convertToPng')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('imageService.cameraTemplates.generateThumbnail')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('imageService.cameraTemplates.cameras')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('imageService.cameraTemplates.status')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className={themeConfig.tableRow}>
              {templates.map((tpl: any, i: number) => (
                <tr key={tpl.id} className={`${themeConfig.tableBorder} ${i % 2 === 0 ? '' : 'bg-white/[0.02]'}`}>
                  <td className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-1.5">
                      {tpl.isDefault && <Star size={13} className="text-amber-400 fill-amber-400" />}
                      {tpl.name}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(tpl.acceptedExtensions || []).map((e: string) => (
                        <span key={e} className="px-1.5 py-0.5 rounded text-[10px] bg-white/10 uppercase">{e}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">{tpl.convertToPng ? <CheckCircle size={14} className="inline text-green-400" /> : <XCircle size={14} className="inline text-white/30" />}</td>
                  <td className="px-4 py-3 text-center">{tpl.generateThumbnail ? <CheckCircle size={14} className="inline text-green-400" /> : <XCircle size={14} className="inline text-white/30" />}</td>
                  <td className="px-4 py-3 text-center">{tpl._count?.cameras ?? 0}</td>
                  <td className="px-4 py-3 text-center">{tpl.isActive ? <CheckCircle size={14} className="inline text-green-400" /> : <XCircle size={14} className="inline text-red-400" />}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="secondary" size="sm" onClick={() => handleEdit(tpl)}><Edit3 size={14} /></Button>
                      <Button variant="secondary" size="sm" className="!text-red-400 hover:!bg-red-500/20" onClick={() => setDeleteTarget(tpl)}><Trash2 size={14} /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CameraTemplateFormModal
        key={editTarget?.id ?? 'new'}
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditTarget(null) }}
        editTarget={editTarget}
      />

      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t('common.deleteConfirm')}>
        <div className="p-1 space-y-4">
          <p className={`text-sm ${themeConfig.text.secondary}`}>{t('imageService.cameraTemplates.deleteConfirm')}</p>
          <p className={`text-sm font-medium ${themeConfig.text.primary}`}>{deleteTarget?.name}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
            <Button className="!bg-red-600 hover:!bg-red-700 text-white" onClick={handleDelete}>{t('common.delete')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function CameraTemplateFormModal({ isOpen, onClose, editTarget }: { isOpen: boolean; onClose: () => void; editTarget: any | null }) {
  const { t, i18n } = useTranslation()
  const { themeConfig } = useTheme()
  const toast = useToast()
  const queryClient = useQueryClient()
  const isEdit = !!editTarget

  const [name, setName] = useState(editTarget?.name || '')
  const [description, setDescription] = useState(editTarget?.description || '')
  const [acceptedExtensions, setAcceptedExtensions] = useState<string[]>(editTarget?.acceptedExtensions?.length ? editTarget.acceptedExtensions : ['tif', 'tiff', 'ptif', 'ptiff'])
  const [convertToPng, setConvertToPng] = useState(editTarget?.convertToPng ?? true)
  const [keepSmaller, setKeepSmaller] = useState(editTarget?.keepSmaller ?? true)
  const [generateThumbnail, setGenerateThumbnail] = useState(editTarget?.generateThumbnail ?? true)
  const [thumbnailSize, setThumbnailSize] = useState(editTarget?.thumbnailSize?.toString() || '512')
  const [compressionQuality, setCompressionQuality] = useState(editTarget?.compressionQuality?.toString() || '85')
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState(editTarget?.pollIntervalSeconds?.toString() || '30')
  const [captureMode, setCaptureMode] = useState(editTarget?.captureMode || 'periodic')
  const [retentionPolicyId, setRetentionPolicyId] = useState(editTarget?.retentionPolicyId || '')
  const [isDefault, setIsDefault] = useState(editTarget?.isDefault ?? false)
  const [sortOrder, setSortOrder] = useState(editTarget?.sortOrder?.toString() || '0')
  const [isActive, setIsActive] = useState(editTarget?.isActive ?? true)
  const [submitting, setSubmitting] = useState(false)

  const { data: policies = [] } = useQuery({
    queryKey: ['retention-policies'],
    queryFn: () => imageServiceApi.getRetentionPolicies({ silent403: true }),
    staleTime: 1000 * 60 * 5,
  })

  const { data: captureModesRaw } = useQuery({
    queryKey: ['masterdata-capture-modes'],
    queryFn: () => imageServiceApi.getMasterdata({ type: 'capture_mode' }, { silent403: true }),
    staleTime: 1000 * 60 * 5,
  })
  const captureModes = (captureModesRaw?.data ?? captureModesRaw ?? []) as any[]

  const createMutation = useMutation({
    mutationFn: (data: any) => imageServiceApi.createCameraTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['camera-templates'] })
      toast.success(t('imageService.cameraTemplates.created'))
      onClose()
    },
    onError: (err: any) => { if (!err?._handled) toast.error(err?.response?.data?.message || t('common.error')) },
    onSettled: () => setSubmitting(false),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => imageServiceApi.updateCameraTemplate(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['camera-templates'] })
      toast.success(t('imageService.cameraTemplates.updated'))
      onClose()
    },
    onError: (err: any) => { if (!err?._handled) toast.error(err?.response?.data?.message || t('common.error')) },
    onSettled: () => setSubmitting(false),
  })

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error(t('common.requiredFields')); return }
    setSubmitting(true)
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      acceptedExtensions,
      convertToPng, keepSmaller, generateThumbnail,
      thumbnailSize: parseInt(thumbnailSize, 10) || 512,
      compressionQuality: parseInt(compressionQuality, 10) || 85,
      pollIntervalSeconds: parseInt(pollIntervalSeconds, 10) || 30,
      captureMode,
      retentionPolicyId: retentionPolicyId || null,
      isDefault,
      sortOrder: parseInt(sortOrder, 10) || 0,
      isActive,
    }
    if (isEdit) updateMutation.mutate({ id: editTarget.id, data: payload })
    else createMutation.mutate(payload)
  }

  const inputClass = `w-full px-3 py-2 rounded-md text-sm border border-white/30 bg-white/10 backdrop-blur-md text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50`
  const labelClass = `block text-sm font-medium text-white mb-1`

  return (
    <Modal isOpen={isOpen} onClose={onClose}
      title={isEdit ? t('imageService.cameraTemplates.editTemplate') : t('imageService.cameraTemplates.newTemplate')}
      size="2xl">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto px-1">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>{t('imageService.cameraTemplates.name')}</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>{t('imageService.cameraTemplates.sortOrder')}</label>
            <input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>{t('imageService.cameraTemplates.description')}</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>{t('imageService.cameraTemplates.acceptedExtensions')}</label>
          <div className="flex flex-wrap gap-1.5">
            {SOURCE_EXTENSIONS.map(ext => {
              const active = acceptedExtensions.includes(ext)
              return (
                <button key={ext} type="button"
                  onClick={() => setAcceptedExtensions(prev => active ? prev.filter(x => x !== ext) : [...prev, ext])}
                  className={`px-3 py-1 rounded-full text-xs border ${active ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200' : 'border-white/30 text-white/60'}`}>
                  {ext}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <label className="flex items-center gap-2 text-sm text-white">
            <input type="checkbox" checked={convertToPng} onChange={e => setConvertToPng(e.target.checked)} className="rounded border-white/30 bg-white/10" />
            {t('imageService.cameraTemplates.convertToPng')}
          </label>
          <label className="flex items-center gap-2 text-sm text-white">
            <input type="checkbox" checked={keepSmaller} onChange={e => setKeepSmaller(e.target.checked)} className="rounded border-white/30 bg-white/10" />
            {t('imageService.cameraTemplates.keepSmaller')}
          </label>
          <label className="flex items-center gap-2 text-sm text-white">
            <input type="checkbox" checked={generateThumbnail} onChange={e => setGenerateThumbnail(e.target.checked)} className="rounded border-white/30 bg-white/10" />
            {t('imageService.cameraTemplates.generateThumbnail')}
          </label>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>{t('imageService.cameraTemplates.thumbnailSize')}</label>
            <input type="number" value={thumbnailSize} onChange={e => setThumbnailSize(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>{t('imageService.cameraTemplates.compressionQuality')}</label>
            <input type="number" value={compressionQuality} onChange={e => setCompressionQuality(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>{t('imageService.cameraTemplates.pollIntervalSeconds')}</label>
            <input type="number" value={pollIntervalSeconds} onChange={e => setPollIntervalSeconds(e.target.value)} className={inputClass} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>{t('imageService.cameraTemplates.captureMode')}</label>
            <SearchableSelect value={captureMode} onChange={setCaptureMode}
              options={captureModes.filter((cm: any) => cm.isActive).length > 0
                ? captureModes.filter((cm: any) => cm.isActive).map((cm: any) => ({ value: cm.code, label: getLocalizedValue(cm, i18n.language) }))
                : ['periodic', 'on_demand', 'continuous'].map(m => ({ value: m, label: m }))} />
          </div>
          <div>
            <label className={labelClass}>{t('imageService.cameraTemplates.retentionPolicy')}</label>
            <SearchableSelect value={retentionPolicyId} onChange={setRetentionPolicyId}
              placeholder={t('common.select')}
              options={[{ value: '', label: '-' }, ...(policies as any[]).map((p: any) => ({ value: p.id, label: p.name }))]} />
          </div>
        </div>

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm text-white">
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} className="rounded border-white/30 bg-white/10" />
            {t('imageService.cameraTemplates.isDefault')}
          </label>
          <label className="flex items-center gap-2 text-sm text-white">
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="rounded border-white/30 bg-white/10" />
            {t('imageService.cameraTemplates.isActive')}
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={submitting}>{submitting ? t('common.saving') : t('common.save')}</Button>
        </div>
      </div>
    </Modal>
  )
}
