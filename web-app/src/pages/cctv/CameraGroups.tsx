import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Edit, FolderTree, Plus, Trash2 } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { canManageAll, hasPermission } from '@/App';
import { imageServiceApi } from '@/services/imageServiceApi';
import { Button, Modal, SearchableSelect, TableSkeleton } from '@/components/ui';
import { useCctvCameras } from '@/hooks/useCctvCameras';

const emptyForm = () => ({ name: '', description: '', cameraIds: [] as string[] });

export default function CameraGroups() {
  const { t } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = canManageAll(user, 'cameras:update');

  const [modal, setModal] = useState<{ open: boolean; item?: any }>({ open: false });
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  const { data: groups = [], isLoading } = useQuery<any[]>({
    queryKey: ['camera-groups'],
    queryFn: () => imageServiceApi.getCameraGroups(),
  });
  const { data: cameras = [] } = useCctvCameras();
  const cameraOptions = (cameras as any[]).map((c) => ({
    value: c.id,
    label: c.device?.name ? `${c.name} · ${c.device.name}` : c.name,
  }));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['camera-groups'] });
    queryClient.invalidateQueries({ queryKey: ['cctv-cameras'] });
  };

  const openEdit = (item?: any) => {
    setForm(item ? { name: item.name, description: item.description ?? '', cameraIds: item.cameraIds } : emptyForm());
    setModal({ open: true, item });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      const payload = { name: form.name.trim(), description: form.description.trim() || null, cameraIds: form.cameraIds };
      if (modal.item) await imageServiceApi.updateCameraGroup(modal.item.id, payload);
      else await imageServiceApi.createCameraGroup(payload);
      toast.success(t('common.saveSuccess'));
      refresh();
      setModal({ open: false });
    } catch (err: any) {
      if (err?._handled) return;
      const nameTaken = err?.response?.data?.details?.code === 'CAMERA_GROUP_NAME_TAKEN';
      toast.error(nameTaken ? t('ui.cameraGroups.nameTaken') : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await imageServiceApi.deleteCameraGroup(deleteTarget.id);
      toast.success(t('ui.cameraGroups.deleted'));
      refresh();
      setDeleteTarget(null);
    } catch (err: any) {
      if (!err?._handled) toast.error(t('common.error'));
    }
  };

  const inputClass = `w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`;
  const labelClass = `block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`;

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('ui.cameraGroups.title')}</h1>
          <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('ui.cameraGroups.subtitle')}</p>
        </div>
        {canEdit && (
          <Button onClick={() => openEdit()}>
            <Plus size={16} className="mr-1.5" /> {t('ui.cameraGroups.new')}
          </Button>
        )}
      </div>

      {isLoading ? <TableSkeleton rows={4} /> : groups.length === 0 ? (
        <div className={`${themeConfig.card} rounded-lg p-10 text-center`}>
          <FolderTree size={36} className="mx-auto mb-3 text-cyan-400" />
          <p className={`text-sm ${themeConfig.text.secondary}`}>{t('ui.cameraGroups.empty')}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {groups.map((group) => (
            <div key={group.id} className={`${themeConfig.card} rounded-lg p-4 flex items-center justify-between gap-3`}>
              <div className="min-w-0">
                <h3 className={`text-base font-semibold truncate ${themeConfig.text.primary}`}>{group.name}</h3>
                {group.description && <p className={`text-xs mt-0.5 truncate ${themeConfig.text.secondary}`}>{group.description}</p>}
                <p className="text-xs mt-1 text-cyan-400">{t('ui.cameraGroups.cameraCount', { count: group.cameraIds.length })}</p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openEdit(group)} title={t('common.edit')} className="p-2 rounded-lg hover:bg-yellow-500/20">
                    <Edit size={15} className="text-yellow-500" />
                  </button>
                  <button onClick={() => setDeleteTarget(group)} title={t('common.delete')} className="p-2 rounded-lg hover:bg-red-500/20">
                    <Trash2 size={15} className="text-red-500" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={modal.open} onClose={() => setModal({ open: false })} title={modal.item ? t('ui.cameraGroups.edit') : t('ui.cameraGroups.new')}>
        <form onSubmit={handleSubmit} className="space-y-4 p-1 max-w-lg">
          <div>
            <label className={labelClass}>{t('ui.cameraGroups.name')} <span className="text-red-400">*</span></label>
            <input value={form.name} maxLength={64} required placeholder={t('ui.cameraGroups.namePlaceholder')}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>{t('ui.cameraGroups.description')}</label>
            <input value={form.description} maxLength={255}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>{t('ui.cameraGroups.cameras')}</label>
            <SearchableSelect isMulti options={cameraOptions} selectedValues={form.cameraIds}
              onMultiChange={(cameraIds) => setForm((p) => ({ ...p, cameraIds }))} placeholder={t('ui.cameraGroups.camerasPlaceholder')} />
            <p className={`text-xs mt-1 ${themeConfig.text.secondary}`}>{t('ui.cameraGroups.multiGroupHint')}</p>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <Button variant="secondary" type="button" onClick={() => setModal({ open: false })}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t('common.deleteConfirm')}>
        <div className="p-1 space-y-4">
          <p className={`text-sm font-medium ${themeConfig.text.primary}`}>{deleteTarget?.name}</p>
          <p className={`text-sm ${themeConfig.text.secondary}`}>{t('ui.cameraGroups.deleteHint')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
            <Button className="!bg-red-600 hover:!bg-red-700 text-white" onClick={handleDelete}>{t('common.delete')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
