import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { Plus, Trash2, Pencil, CheckCircle, XCircle } from 'lucide-react';
import { Button, Modal } from '@/components/ui';

type TabType = 'camera_type' | 'camera_status' | 'capture_mode' | 'image_category' | 'defect_type' | 'inspection_type' | 'incident_reason' | 'incident_root_cause' | 'incident_resolution' | 'customer' | 'job_type' | 'production_line' | 'image_viewpoint';

const TABS: { key: TabType; labelKey: string }[] = [
  { key: 'camera_type', labelKey: 'imageService.masterdataManagement.tabCameraType' },
  { key: 'camera_status', labelKey: 'imageService.masterdataManagement.tabCameraStatus' },
  { key: 'capture_mode', labelKey: 'imageService.masterdataManagement.tabCaptureMode' },
  { key: 'image_category', labelKey: 'imageService.masterdataManagement.tabImageCategory' },
  { key: 'defect_type', labelKey: 'imageService.masterdataManagement.tabDefectType' },
  { key: 'inspection_type', labelKey: 'imageService.masterdataManagement.tabInspectionType' },
  { key: 'incident_reason', labelKey: 'imageService.masterdataManagement.tabIncidentReason' },
  { key: 'incident_root_cause', labelKey: 'imageService.masterdataManagement.tabIncidentRootCause' },
  { key: 'incident_resolution', labelKey: 'imageService.masterdataManagement.tabIncidentResolution' },
  { key: 'customer', labelKey: 'imageService.masterdataManagement.tabCustomer' },
  { key: 'job_type', labelKey: 'imageService.masterdataManagement.tabJobType' },
  { key: 'production_line', labelKey: 'imageService.masterdataManagement.tabProductionLine' },
  { key: 'image_viewpoint', labelKey: 'imageService.masterdataManagement.tabImageViewpoint' },
];

const LANG_FIELDS = ['nameTh', 'nameEn', 'nameCn', 'nameMm', 'nameJp'] as const;

const LANG_LABELS: Record<string, string> = {
  nameTh: 'TH', nameEn: 'EN', nameCn: 'CN', nameMm: 'MM', nameJp: 'JP',
};

export default function MasterdataManagement() {
  const { t } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [searchParams] = useSearchParams();
  const initialTab = TABS.some((tb) => tb.key === searchParams.get('type'))
    ? (searchParams.get('type') as TabType) : 'camera_type';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [modal, setModal] = useState<{ open: boolean; editing?: any }>({ open: false });
  const [form, setForm] = useState<Record<string, any>>({ code: '', nameTh: '', nameEn: '', nameCn: '', nameMm: '', nameJp: '', description: '', sortOrder: 0, isActive: true, isDefault: false });

  const { data, isLoading } = useQuery({
    queryKey: ['masterdata', activeTab],
    queryFn: () => imageServiceApi.getMasterdata({ type: activeTab }),
    staleTime: 1000 * 30,
  });

  const items: any[] = (data as any)?.data ?? [];

  const createMutation = useMutation({
    // Invalidate queries so default value updates immediately on cameras form too
    mutationFn: (d: any) => imageServiceApi.createMasterdata(d),
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ['masterdata'] }); 
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
      toast.success(t('common.saveSuccess')); 
      setModal({ open: false }); 
    },
    onError: (e: any) => { if (!e?._handled) toast.error(t('common.error')); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => imageServiceApi.updateMasterdata(id, data),
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ['masterdata'] }); 
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
      toast.success(t('common.saveSuccess')); 
      setModal({ open: false }); 
    },
    onError: (e: any) => { if (!e?._handled) toast.error(t('common.error')); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.deleteMasterdata(id),
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ['masterdata'] }); 
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
      toast.success(t('common.saveSuccess')); 
    },
    onError: (e: any) => { if (!e?._handled) toast.error(t('common.error')); },
  });

  const openNew = () => {
    setForm({ code: '', nameTh: '', nameEn: '', nameCn: '', nameMm: '', nameJp: '', description: '', sortOrder: 0, isActive: true, isDefault: false });
    setModal({ open: true, editing: undefined });
  };

  const openEdit = (item: any) => {
    setForm({ code: item.code, nameTh: item.nameTh ?? '', nameEn: item.nameEn ?? '', nameCn: item.nameCn ?? '', nameMm: item.nameMm ?? '', nameJp: item.nameJp ?? '', description: item.description ?? '', sortOrder: item.sortOrder, isActive: item.isActive, isDefault: !!item.isDefault });
    setModal({ open: true, editing: item });
  };

  const handleSave = () => {
    const payload = { ...form, type: activeTab, sortOrder: parseInt(form.sortOrder) || 0 };
    if (modal.editing) {
      updateMutation.mutate({ id: modal.editing.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const inputClass = `w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`;

  return (
    <div className="p-6">
      <div className="mb-6">
        <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>Image Service · {t('imageService.masterdataManagement.title')}</p>
        <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.title')}</h1>
        <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.masterdataManagement.subtitle')}</p>
      </div>

      <div className={`flex flex-wrap gap-1 mb-5 px-1 py-1 rounded-lg ${themeConfig.card}`}>
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === tab.key ? 'bg-cyan-500/15 text-cyan-300' : `${themeConfig.text.secondary} hover:text-white`}`}>
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      <div className={`${themeConfig.card} rounded-lg overflow-hidden`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <span className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t(TABS.find(t => t.key === activeTab)?.labelKey ?? 'imageService.masterdataManagement.tabCameraType')}</span>
          <Button onClick={openNew} size="sm"><Plus size={14} className="mr-1" /> {t('imageService.masterdataManagement.add')}</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className={themeConfig.tableHeader}>
              <tr>
                <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.tableCode')}</th>
                <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>TH</th>
                <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>EN</th>
                <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>CN</th>
                <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>MM</th>
                <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>JP</th>
                <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.tableSort')}</th>
                <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.tableActive')}</th>
                <th className={`px-4 py-3 text-center text-sm font-semibold ${themeConfig.text.primary}`}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={9} className={`px-4 py-8 text-center text-sm ${themeConfig.text.secondary}`}>{t('common.noData')}</td></tr>
              ) : items.map((item: any) => (
                <tr key={item.id} className={`border-t ${themeConfig.tableBorder} hover:bg-white/5 transition-colors`}>
                  <td className={`px-4 py-3 text-sm font-mono font-medium ${themeConfig.text.primary}`}>
                    {item.code}
                    {item.isDefault && (
                      <span className="ml-2 px-1.5 py-0.5 text-[10px] font-semibold bg-cyan-500/20 text-cyan-300 rounded border border-cyan-500/30">
                        {t('imageService.masterdataManagement.formDefault')}
                      </span>
                    )}
                  </td>
                  <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{item.nameTh || '—'}</td>
                  <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{item.nameEn || '—'}</td>
                  <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{item.nameCn || '—'}</td>
                  <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{item.nameMm || '—'}</td>
                  <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{item.nameJp || '—'}</td>
                  <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{item.sortOrder}</td>
                  <td className="px-4 py-3">
                    {item.isActive ? <CheckCircle size={15} className="text-green-400" /> : <XCircle size={15} className="text-gray-500" />}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                       <button onClick={() => openEdit(item)} className="p-1.5 rounded-md hover:bg-cyan-500/10 text-cyan-400 transition-colors">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => deleteMutation.mutate(item.id)} className="p-1.5 rounded-md hover:bg-red-500/10 text-red-400 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={modal.open} onClose={() => setModal({ open: false })}
        title={modal.editing ? t('imageService.masterdataManagement.edit') : t('imageService.masterdataManagement.add')}>
        <div className="space-y-4">
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.formCode')}</label>
            <input value={form.code} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, code: e.target.value }))}
              className={inputClass} placeholder="unique_code" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            {LANG_FIELDS.map(field => (
              <div key={field}>
                <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.nameLabel', { lang: LANG_LABELS[field] })}</label>
                <input value={form[field]} onChange={e => setForm(f2 => ({ ...f2, [field]: e.target.value }))}
                  className={inputClass} />
              </div>
            ))}
          </div>
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.formDescription')}</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2} className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.formSortOrder')}</label>
              <input type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))}
                className={inputClass} />
            </div>
            <div className="flex items-end pb-2 gap-4 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.isActive}
                  onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                  className="rounded border-gray-600 text-cyan-500 focus:ring-cyan-500/50" />
                <span className={`text-sm ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.formActive')}</span>
              </label>
              {activeTab === 'camera_type' && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.isDefault}
                    onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))}
                    className="rounded border-gray-600 text-cyan-500 focus:ring-cyan-500/50" />
                  <span className={`text-sm ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.formDefault')}</span>
                </label>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModal({ open: false })}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} disabled={!form.code}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
