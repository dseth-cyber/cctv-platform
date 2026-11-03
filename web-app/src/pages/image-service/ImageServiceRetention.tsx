import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { Plus, Edit, Trash2, Shield, Clock, Info } from 'lucide-react';
import { Modal, Button, TableSkeleton } from '@/components/ui';

const POLICY_NAME_KEYS: Record<string, { name: string; desc: string }> = {
  'Default Retention': { name: 'imageService.retention.defaultName', desc: 'imageService.retention.defaultDesc' },
  'Long-Term Retention': { name: 'imageService.retention.longTermName', desc: 'imageService.retention.longTermDesc' },
  'การจัดเก็บเริ่มต้น (Default)': { name: 'imageService.retention.defaultName', desc: 'imageService.retention.defaultDesc' },
  'การจัดเก็บระยะยาว (Long-Term)': { name: 'imageService.retention.longTermName', desc: 'imageService.retention.longTermDesc' },
};

const emptyForm = () => ({
  name: '', description: '',
  recordingRetentionDays: 30,
  isDefault: false,
});

export default function ImageServiceRetention() {
  const { t } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [modal, setModal] = useState<{ open: boolean; item?: any | null }>({ open: false });
  const [form, setForm] = useState(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ['retention-policies'],
    queryFn: () => imageServiceApi.getRetentionPolicies(),
    staleTime: 1000 * 60 * 2,
  });

  const openCreate = () => { setForm(emptyForm()); setModal({ open: true, item: null }); };
  const openEdit = (item: any) => {
    setForm({
      name: item.name, description: item.description ?? '',
      recordingRetentionDays: item.recordingRetentionDays,
      isDefault: item.isDefault ?? false,
    });
    setModal({ open: true, item });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.recordingRetentionDays) {
      toast.warning(t('common.requiredFields')); return;
    }
    try {
      setSubmitting(true);
      if (modal.item) {
        await imageServiceApi.updateRetentionPolicy(modal.item.id, form);
        toast.success(t('imageService.retention.updated'));
      } else {
        await imageServiceApi.createRetentionPolicy(form);
        toast.success(t('imageService.retention.created'));
      }
      queryClient.invalidateQueries({ queryKey: ['retention-policies'] });
      setModal({ open: false });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t('common.error'));
    } finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await imageServiceApi.deleteRetentionPolicy(deleteTarget.id);
      toast.success(t('imageService.retention.deleted'));
      queryClient.invalidateQueries({ queryKey: ['retention-policies'] });
      setDeleteTarget(null);
    } catch (err: any) {
      const msg = err.response?.data?.error?.message ?? '';
      if (msg.includes('cameras')) toast.warning(t('imageService.retention.deleteDisabled'));
      else toast.error(t('common.error'));
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
          iSmart CCTV · {t('imageService.retention.title')}
        </p>
        <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.retention.title')}</h1>
        <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.retention.subtitle')}</p>
      </div>

      <div className={`${themeConfig.card} rounded-lg p-4 mb-5 flex gap-3`}>
        <Info size={16} className="text-cyan-400 shrink-0 mt-0.5" />
        <ul className={`text-xs space-y-1 ${themeConfig.text.secondary}`}>
          <li>{t('imageService.retention.ruleExpire')}</li>
          <li>{t('imageService.retention.ruleQuarantine')}</li>
          <li>{t('imageService.retention.ruleDisk')}</li>
          <li>{t('imageService.retention.ruleLegalHold')}</li>
        </ul>
      </div>

      <div className="flex justify-end mb-5">
        <Button onClick={openCreate}>
          <Plus size={16} className="mr-1.5" /> {t('imageService.retention.newPolicy')}
        </Button>
      </div>

      {isLoading ? <TableSkeleton rows={5} /> : (
        <div className="grid gap-4">
          {policies.map((policy: any) => (
            <div key={policy.id} className={`${themeConfig.card} rounded-lg p-5`}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className={`text-base font-semibold flex items-center gap-2 ${themeConfig.text.primary}`}>
                    <Shield size={16} className="text-cyan-400" />
                    {t(POLICY_NAME_KEYS[policy.name]?.name ?? policy.name)}
                    {policy.isDefault && (
                      <span className="text-xs bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full font-normal border border-cyan-500/30">
                        {t('imageService.retention.defaultBadge') || t('ui.imageServiceRetention.default')}
                      </span>
                    )}
                  </h3>
                  {(POLICY_NAME_KEYS[policy.name] || policy.description) && (
                    <p className={`text-xs mt-0.5 ${themeConfig.text.secondary}`}>
                      {t(POLICY_NAME_KEYS[policy.name]?.desc ?? policy.description)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(policy)}
                    className="p-2 rounded-lg hover:bg-yellow-500/20"><Edit size={15} className="text-yellow-500" /></button>
                  <button onClick={() => setDeleteTarget(policy)}
                    className="p-2 rounded-lg hover:bg-red-500/20"><Trash2 size={15} className="text-red-500" /></button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className={`px-3 py-2.5 rounded-lg ${themeConfig.progressTrack} bg-opacity-50`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock size={13} className="text-cyan-400" />
                    <span className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.retention.recordingRetentionDays')}</span>
                  </div>
                  <span className="text-lg font-bold text-cyan-400">{policy.recordingRetentionDays}<span className="text-xs ml-0.5">{t('imageService.retention.days')}</span></span>
                </div>
              </div>

              {policy._count?.cameras > 0 && (
                <div className={`mt-3 text-xs ${themeConfig.text.secondary}`}>
                  {t('imageService.retention.camerasUsing')}: <span className={themeConfig.text.primary}>{policy._count.cameras}</span>
                </div>
              )}
            </div>
          ))}

          {policies.length === 0 && (
            <div className={`text-center py-12 ${themeConfig.text.secondary} text-sm`}>
              {t('imageService.cameras.title')} — {t('common.noData')}
            </div>
          )}
        </div>
      )}

      <Modal isOpen={modal.open} onClose={() => setModal({ open: false })}
        title={modal.item ? t('imageService.retention.editPolicy') : t('imageService.retention.newPolicy')}>
        <form onSubmit={handleSubmit} className="space-y-4 p-1 max-w-lg">
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
              {t('imageService.retention.policyName')} <span className="text-red-400">*</span>
            </label>
            <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              className={`w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`} required />
          </div>
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
              {t('imageService.retention.description')}
            </label>
            <textarea rows={2} value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              className={`w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary} resize-none`} />
          </div>
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
              {t('imageService.retention.recordingRetentionDays')} <span className="text-red-400">*</span>
            </label>
            <input type="number" min={1} max={3650} value={form.recordingRetentionDays}
              onChange={e => setForm(p => ({ ...p, recordingRetentionDays: parseInt(e.target.value) || 1 }))}
              className={`w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`} required />
            <p className={`text-xs mt-1.5 ${themeConfig.text.secondary}`}>{t('imageService.retention.recordingRetentionHint')}</p>
          </div>
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input type="checkbox" checked={form.isDefault}
              onChange={e => setForm(p => ({ ...p, isDefault: e.target.checked }))}
              className="w-4 h-4 rounded accent-cyan-500" />
            <span className={`text-sm font-medium ${themeConfig.text.primary}`}>
              {t('imageService.retention.isDefault') || t('ui.imageServiceRetention.setAsTheDefaultPolicyFor')}
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <Button variant="secondary" type="button" onClick={() => setModal({ open: false })}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={submitting}>{submitting ? t('common.saving') : t('common.save')}</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)}
        title={t('common.deleteConfirm')}>
        <div className="p-1 space-y-4">
          <p className={`text-sm ${themeConfig.text.secondary}`}>
            {t('imageService.retention.deleteConfirm')}
          </p>
          <p className={`text-sm font-medium ${themeConfig.text.primary}`}>{deleteTarget?.name}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
            <Button className="!bg-red-600 hover:!bg-red-700 text-white" onClick={handleDelete}>
              {t('common.delete')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
