import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTheme } from '@/contexts/ThemeContext'
import { useToast } from '@/contexts/ToastContext'
import { imageServiceApi } from '@/services/imageServiceApi'
import { Button, Modal, TableSkeleton, SearchableSelect } from '@/components/ui'
import { Plus, Layers, Edit3, Trash2, CheckCircle, XCircle, ArrowRight, AlertTriangle } from 'lucide-react'

export default function StorageProfilesPage() {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<any | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)

  const { data: profiles, isLoading } = useQuery({
    queryKey: ['storage-profiles'],
    queryFn: () => imageServiceApi.getStorageProfiles(),
  })

  const { data: providers } = useQuery({
    queryKey: ['storage-providers'],
    queryFn: () => imageServiceApi.getStorageProviders(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.deleteStorageProfile(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-profiles'] })
      toast.success('Profile deleted')
      setDeleteTarget(null)
    },
    onError: (err: any) => { if (!err?._handled) toast.error(err?.response?.data?.message || t('common.error')); },
  })

  const handleEdit = (profile: any) => {
    setEditTarget(profile)
    setShowForm(true)
  }

  const handleDelete = () => {
    if (!deleteTarget) return
    deleteMutation.mutate(deleteTarget.id)
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
            Image Service · {t('imageService.storageProfiles.title')}
          </p>
          <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.storageProfiles.title')}</h1>
          <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.storageProfiles.subtitle')}</p>
        </div>
        <Button onClick={() => { setEditTarget(null); setShowForm(true) }}>
          <Plus size={16} className="mr-1" /> {t('imageService.storageProfiles.newProfile')}
        </Button>
      </div>

      <div className="flex items-start gap-3 p-3 mb-6 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.storageProfiles.notWiredWarning')}</p>
      </div>

      {isLoading ? (
        <TableSkeleton rows={4} cols={6} />
      ) : !profiles?.length ? (
        <div className={`flex flex-col items-center justify-center py-20 ${themeConfig.text.secondary}`}>
          <Layers size={48} className="mb-4 opacity-30" />
          <p className="text-lg font-medium">{t('imageService.storageProfiles.noProfiles')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className={`${themeConfig.tableHeader}`}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">{t('imageService.storageProfiles.code')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('imageService.storageProfiles.name')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('imageService.storageProfiles.provider')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('imageService.storageProfiles.rules')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('imageService.storageProfiles.sortOrder')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('imageService.storageProfiles.status')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className={themeConfig.tableRow}>
              {profiles.map((p: any, i: number) => (
                <tr key={p.id} className={`${themeConfig.tableBorder} ${i % 2 === 0 ? '' : 'bg-white/[0.02]'}`}>
                  <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                  <td className="px-4 py-3 font-medium">{p.nameEn}</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1">
                      {p.provider?.name || p.providerId?.slice(0, 8)}
                      <ArrowRight size={12} className="opacity-50" />
                      <span className="text-[10px] uppercase opacity-60">{p.provider?.type}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {Array.isArray(p.routingRules) ? (
                      <span className="text-xs opacity-70">{p.routingRules.length} rule{p.routingRules.length !== 1 ? 's' : ''}</span>
                    ) : (
                      <span className="text-xs opacity-40">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">{p.sortOrder}</td>
                  <td className="px-4 py-3 text-center">
                    {p.isActive ? (
                      <CheckCircle size={14} className="inline text-green-400" />
                    ) : (
                      <XCircle size={14} className="inline text-red-400" />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="secondary" size="sm" onClick={() => handleEdit(p)}>
                        <Edit3 size={14} />
                      </Button>
                      <Button variant="secondary" size="sm" className="!text-red-400 hover:!bg-red-500/20" onClick={() => setDeleteTarget(p)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <StorageProfileFormModal
        key={editTarget?.id ?? 'new'}
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditTarget(null) }}
        editTarget={editTarget}
        providers={providers || []}
      />

      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t('common.deleteConfirm')}>
        <div className="p-1 space-y-4">
          <p className={`text-sm ${themeConfig.text.secondary}`}>Are you sure you want to delete this profile?</p>
          <p className={`text-sm font-medium ${themeConfig.text.primary}`}>{deleteTarget?.nameEn}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
            <Button className="!bg-red-600 hover:!bg-red-700 text-white" onClick={handleDelete}>{t('common.delete')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function StorageProfileFormModal({ isOpen, onClose, editTarget, providers }: { isOpen: boolean; onClose: () => void; editTarget: any | null; providers: any[] }) {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()
  const toast = useToast()
  const queryClient = useQueryClient()
  const isEdit = !!editTarget

  const [code, setCode] = useState(editTarget?.code || '')
  const [nameTh, setNameTh] = useState(editTarget?.nameTh || '')
  const [nameEn, setNameEn] = useState(editTarget?.nameEn || '')
  const [nameCn, setNameCn] = useState(editTarget?.nameCn || '')
  const [nameMm, setNameMm] = useState(editTarget?.nameMm || '')
  const [nameJp, setNameJp] = useState(editTarget?.nameJp || '')
  const [description, setDescription] = useState(editTarget?.description || '')
  const [providerId, setProviderId] = useState(editTarget?.providerId || (providers[0]?.id || ''))
  const [sortOrder, setSortOrder] = useState(editTarget?.sortOrder?.toString() || '0')
  const [isActive, setIsActive] = useState(editTarget?.isActive ?? true)
  const [submitting, setSubmitting] = useState(false)

  const createMutation = useMutation({
    mutationFn: (data: any) => imageServiceApi.createStorageProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-profiles'] })
      toast.success('Profile created')
      onClose()
    },
    onError: (err: any) => { if (!err?._handled) toast.error(err?.response?.data?.message || t('common.error')); },
    onSettled: () => setSubmitting(false),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => imageServiceApi.updateStorageProfile(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-profiles'] })
      toast.success('Profile updated')
      onClose()
    },
    onError: (err: any) => { if (!err?._handled) toast.error(err?.response?.data?.message || t('common.error')); },
    onSettled: () => setSubmitting(false),
  })

  const handleSubmit = async () => {
    if (!code.trim() || !nameEn.trim()) { toast.error('Code and Name (EN) are required'); return }
    setSubmitting(true)
    const payload = {
      code: code.trim(), nameTh, nameEn: nameEn.trim(), nameCn, nameMm, nameJp,
      description: description.trim() || undefined, providerId, sortOrder: parseInt(sortOrder, 10) || 0, isActive, routingRules: [],
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
      title={isEdit ? t('imageService.storageProfiles.editProfile') : t('imageService.storageProfiles.newProfile')}
      size="2xl">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto px-1">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>{t('imageService.storageProfiles.code')}</label>
            <input type="text" value={code} onChange={e => setCode(e.target.value)} className={inputClass} placeholder="default-profile" />
          </div>
          <div>
            <label className={labelClass}>{t('imageService.storageProfiles.provider')}</label>
            <SearchableSelect
              value={providerId}
              onChange={setProviderId}
              options={providers.filter((p: any) => p.isActive).map((p: any) => ({ value: p.id, label: `${p.name} (${p.type})` }))}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={labelClass}>{t('imageService.storageProfiles.nameEn')}</label><input type="text" value={nameEn} onChange={e => setNameEn(e.target.value)} className={inputClass} /></div>
          <div><label className={labelClass}>{t('imageService.storageProfiles.nameTh')}</label><input type="text" value={nameTh} onChange={e => setNameTh(e.target.value)} className={inputClass} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={labelClass}>{t('imageService.storageProfiles.nameCn')}</label><input type="text" value={nameCn} onChange={e => setNameCn(e.target.value)} className={inputClass} /></div>
          <div><label className={labelClass}>{t('imageService.storageProfiles.nameMm')}</label><input type="text" value={nameMm} onChange={e => setNameMm(e.target.value)} className={inputClass} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={labelClass}>{t('imageService.storageProfiles.nameJp')}</label><input type="text" value={nameJp} onChange={e => setNameJp(e.target.value)} className={inputClass} /></div>
          <div>
            <label className={labelClass}>{t('imageService.storageProfiles.sortOrder')}</label>
            <input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>{t('imageService.storageProfiles.description')}</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={inputClass} />
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="isActive" checked={isActive} onChange={e => setIsActive(e.target.checked)}
            className="rounded border-white/30 bg-white/10" />
          <label htmlFor="isActive" className="text-sm text-white">{t('imageService.storageProfiles.isActive')}</label>
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
