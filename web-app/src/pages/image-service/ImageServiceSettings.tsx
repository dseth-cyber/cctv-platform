import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import {
  Save, RotateCcw, Eye, EyeOff, RefreshCw, Bell,
  Shield, Database, Server, Plus, Trash2, MessageCircle, Pencil,
} from 'lucide-react';
import { Button, Modal, SearchableSelect } from '@/components/ui';

const SETTINGS_KEY = 'image-service-settings';

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveSettings(settings: Record<string, unknown>) {
  const existing = loadSettings();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...existing, ...settings }));
}

export default function ImageServiceSettings() {
  const { t, i18n } = useTranslation();
  const { themeConfig, theme, setTheme } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [pollInterval, setPollInterval] = useState(() => loadSettings().pollInterval ?? 30);
  const [retryMax, setRetryMax] = useState(() => loadSettings().retryMax ?? 3);
  const [alertEmail, setAlertEmail] = useState(() => loadSettings().alertEmail ?? '');
  const [webhookUrl, setWebhookUrl] = useState(() => loadSettings().webhookUrl ?? '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ruleModal, setRuleModal] = useState<{ open: boolean; editing?: any }>({ open: false });
  const [ruleToDelete, setRuleToDelete] = useState<any>(null);
  const [ruleForm, setRuleForm] = useState({ name: '', alertType: '', channels: [] as string[], cooldown: 60, enabled: true });

  const { data: overview } = useQuery({
    queryKey: ['image-service-overview'],
    queryFn: () => imageServiceApi.getOverview(),
    staleTime: 1000 * 60 * 5,
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts-settings'],
    queryFn: () => imageServiceApi.getAlerts(undefined, { silent403: true }),
    staleTime: 1000 * 60,
  });

  const alertsArr = Array.isArray(alerts?.data) ? alerts.data : (Array.isArray(alerts) ? alerts : []);

  const { data: alertRules } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: () => imageServiceApi.getAlertRules(undefined, { silent403: true }),
    staleTime: 1000 * 60,
  });

  const rulesArr = Array.isArray((alertRules as any)?.data) ? (alertRules as any).data : [];

  const createRuleMutation = useMutation({
    mutationFn: (data: any) => imageServiceApi.createAlertRule(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['alert-rules'] }); toast.success(t('imageService.settings.ruleCreated', 'Rule created')); setRuleModal({ open: false }); },
    onError: (e: any) => { if (!e?._handled) toast.error(t('common.error')); },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.deleteAlertRule(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['alert-rules'] }); toast.success(t('imageService.settings.ruleDeleted', 'Rule deleted')); },
    onError: (e: any) => { if (!e?._handled) toast.error(t('common.error')); },
  });

  const handleSaveRule = () => {
    const data: any = {
      name: ruleForm.name,
      alertType: ruleForm.alertType,
      cooldownMinutes: ruleForm.cooldown,
      enabled: ruleForm.enabled,
      notificationChannels: ruleForm.channels,
    };
    if (ruleModal.editing) {
      imageServiceApi.updateAlertRule(ruleModal.editing.id, data).then(() => {
        queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
        toast.success(t('imageService.settings.ruleUpdated', 'Rule updated'));
        setRuleModal({ open: false });
      }).catch((e: any) => { if (!e?._handled) toast.error(t('common.error')); });
    } else {
      createRuleMutation.mutate(data);
    }
  };

  const openNewRule = () => {
    setRuleForm({ name: '', alertType: '', channels: [], cooldown: 60, enabled: true });
    setRuleModal({ open: true, editing: undefined });
  };

  const openEditRule = (rule: any) => {
    setRuleForm({
      name: rule.name ?? '',
      alertType: rule.alertType ?? '',
      channels: Array.isArray(rule.notificationChannels) ? [...rule.notificationChannels] : [],
      cooldown: rule.cooldownMinutes ?? 60,
      enabled: rule.enabled ?? true,
    });
    setRuleModal({ open: true, editing: rule });
  };

  const CHANNEL_OPTIONS = [
    { value: 'telegram', label: 'Telegram' },
    { value: 'line', label: 'Line' },
  ];

  // Every value here must exist in the Prisma AlertType enum (schema.prisma) — this list
  // intentionally covers all 12, not just the ones actually wired up to createAlert()
  // calls yet, so a rule can be pre-created before the emitting code ships. Currently
  // wired up (will actually fire): storage_warning, disk_space, camera_offline,
  // camera_no_new_images, storage_cleanup, incident_escalation, auth_anomaly. NOT wired
  // up anywhere yet (a rule for these will sit dormant — nothing in the codebase creates
  // an alert with that type): processing_failure, rate_limit_exceeded,
  // retention_violation, ingest_lag, checksum_mismatch.
  const ALERT_TYPE_OPTIONS = [
    { value: 'storage_warning', label: t('imageService.settings.alertTypes.storage_warning', 'Storage Warning') },
    { value: 'disk_space', label: t('imageService.settings.alertTypes.disk_space', 'Disk Space') },
    { value: 'camera_offline', label: t('imageService.settings.alertTypes.camera_offline', 'Camera Offline') },
    { value: 'camera_no_new_images', label: t('imageService.settings.alertTypes.camera_no_new_images', 'Camera Producing No New Images') },
    { value: 'storage_cleanup', label: t('imageService.settings.alertTypes.storage_cleanup', 'Storage Cleanup') },
    { value: 'incident_escalation', label: t('imageService.settings.alertTypes.incident_escalation', 'Incident Escalation') },
    { value: 'auth_anomaly', label: t('imageService.settings.alertTypes.auth_anomaly', 'Suspicious Login Activity') },
    { value: 'processing_failure', label: t('imageService.settings.alertTypes.processing_failure', 'Processing Failure') },
    { value: 'rate_limit_exceeded', label: t('imageService.settings.alertTypes.rate_limit_exceeded', 'Rate Limit Exceeded') },
    { value: 'retention_violation', label: t('imageService.settings.alertTypes.retention_violation', 'Retention Violation') },
    { value: 'ingest_lag', label: t('imageService.settings.alertTypes.ingest_lag', 'Ingest Lag') },
    { value: 'checksum_mismatch', label: t('imageService.settings.alertTypes.checksum_mismatch', 'Checksum Mismatch') },
  ];

  const handleSaveGeneral = async () => {
    try {
      setSaving(true);
      saveSettings({ pollInterval, retryMax, alertEmail, webhookUrl });
      toast.success(t('common.saveSuccess'));
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
    finally { setSaving(false); }
  };

  const handleResetAll = () => {
    localStorage.removeItem('image_service_overview_layout_v1');
    localStorage.removeItem('image-service-theme');
    localStorage.removeItem('i18nextLng');
    localStorage.removeItem(SETTINGS_KEY);
    setPollInterval(30);
    setRetryMax(3);
    setAlertEmail('');
    setWebhookUrl('');
    setTheme('modern');
    i18n.changeLanguage('th');
    queryClient.invalidateQueries();
    toast.success(t('imageService.settings.resetSuccess'));
  };

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
          iSmart CCTV · {t('imageService.settings.title')}
        </p>
        <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.settings.title')}</h1>
        <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.settings.subtitle')}</p>
      </div>



      {/* Notification */}
      <div className={`${themeConfig.card} rounded-lg p-6 mb-5`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-cyan-500/10">
            <Bell size={18} className="text-cyan-400" />
          </div>
          <div>
            <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.settings.notifications')}</h3>
            <p className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.settings.notificationsDesc')}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('ui.imageServiceSettings.email')}{' '}{t('imageService.settings.alertEmail')}</label>
            <input value={alertEmail} onChange={e => setAlertEmail(e.target.value)}
              placeholder="admin@example.com"
              className={`w-full px-4 py-2.5 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`} />
          </div>
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('ui.imageServiceSettings.webhookUrl')}</label>
            <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.example.com/alerts"
              className={`w-full px-4 py-2.5 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`} />
          </div>
        </div>
      </div>

      {/* Processing */}
      <div className={`${themeConfig.card} rounded-lg p-6 mb-5`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Server size={18} className="text-amber-400" />
          </div>
          <div>
            <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.settings.processing')}</h3>
            <p className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.settings.processingDesc')}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.settings.pollInterval')}</label>
            <input type="number" value={pollInterval} onChange={e => setPollInterval(parseInt(e.target.value) || 30)}
              min={5} max={300}
              className={`w-full px-4 py-2.5 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`} />
          </div>
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.settings.retryMax')}</label>
            <input type="number" value={retryMax} onChange={e => setRetryMax(parseInt(e.target.value) || 3)}
              min={0} max={10}
              className={`w-full px-4 py-2.5 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`} />
          </div>
        </div>
      </div>

      {/* System Info */}
      <div className={`${themeConfig.card} rounded-lg p-6 mb-5`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-blue-500/10">
            <Database size={18} className="text-blue-400" />
          </div>
          <div>
            <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.settings.systemInfo')}</h3>
            <p className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.settings.systemInfoDesc')}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className={themeConfig.text.secondary}>{t('imageService.settings.totalImages')}:</span>
            <span className={`ml-2 font-medium ${themeConfig.text.primary}`}>{overview?.totalImages?.toLocaleString() ?? '—'}</span>
          </div>
          <div>
            <span className={themeConfig.text.secondary}>{t('imageService.settings.activeCameras')}:</span>
            <span className={`ml-2 font-medium ${themeConfig.text.primary}`}>{overview?.activeCameras ?? '—'}</span>
          </div>
          <div>
            <span className={themeConfig.text.secondary}>{t('imageService.settings.totalAlerts')}:</span>
            <span className={`ml-2 font-medium ${themeConfig.text.primary}`}>{alertsArr.length}</span>
          </div>
          <div>
            <span className={themeConfig.text.secondary}>{t('ui.imageServiceSettings.apiKey')}</span>
            <span className={`ml-2 font-mono text-xs ${themeConfig.text.primary}`}>
              {showApiKey ? 'sk-••••••••••••••••' : '••••••••••••••••'}
              <button onClick={() => setShowApiKey(!showApiKey)} className="ml-1 align-middle">
                {showApiKey ? <EyeOff size={13} className="text-gray-400" /> : <Eye size={13} className="text-gray-400" />}
              </button>
            </span>
          </div>
        </div>
      </div>

      {/* Alert Rules */}
      <div className={`${themeConfig.card} rounded-lg p-6 mb-5`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10">
              <MessageCircle size={18} className="text-green-400" />
            </div>
            <div>
              <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.settings.alertRules')}</h3>
              <p className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.settings.alertRulesDesc')}</p>
            </div>
          </div>
          <Button onClick={openNewRule} size="sm">
            <Plus size={14} className="mr-1" /> {t('imageService.settings.addRule')}
          </Button>
        </div>
        {rulesArr.length === 0 ? (
          <p className={`text-sm italic ${themeConfig.text.secondary}`}>{t('common.noData')}</p>
        ) : (
          <div className="space-y-2">
            {rulesArr.map((rule: any) => (
              <div key={rule.id} className={`flex items-center justify-between px-4 py-3 rounded-md ${themeConfig.card}`}>
                <div className="flex-1">
                  <div className={`text-sm font-medium ${themeConfig.text.primary}`}>{rule.name}</div>
                  <div className={`text-xs ${themeConfig.text.secondary}`}>
                    {t(`imageService.settings.alertTypes.${rule.alertType}`, rule.alertType)} · {(rule.notificationChannels as string[] ?? []).join(', ') || t('common.noData')} · {t('imageService.settings.cooldown')}: {rule.cooldownMinutes}m
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {rule.enabled ? (
                    <span className={`text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400`}>{t('common.active')}</span>
                  ) : (
                    <span className={`text-xs px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-400`}>{t('common.disabled')}</span>
                  )}
                  <button onClick={() => openEditRule(rule)} title={t('common.edit')} className="p-1 rounded hover:bg-cyan-500/10 text-cyan-400">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => setRuleToDelete(rule)} title={t('common.delete')} className="p-1 rounded hover:bg-red-500/10 text-red-400">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Alert Rule Modal */}
      <Modal isOpen={ruleModal.open} onClose={() => setRuleModal({ open: false })} title={ruleModal.editing ? t('imageService.settings.editRule', 'Edit Rule') : t('imageService.settings.addRule')}>
        <div className="space-y-4">
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('common.name')}</label>
            <input value={ruleForm.name} onChange={e => setRuleForm(f => ({ ...f, name: e.target.value }))}
              className={`w-full px-4 py-2.5 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`} />
          </div>
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.settings.alertType')}</label>
            <SearchableSelect
              options={ALERT_TYPE_OPTIONS}
              value={ruleForm.alertType}
              onChange={(v: string) => setRuleForm(f => ({ ...f, alertType: v }))}
              placeholder={t('common.select')}
            />
          </div>
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.settings.notificationChannels')}</label>
            <div className="space-y-2">
              {CHANNEL_OPTIONS.map(ch => (
                <label key={ch.value} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={ruleForm.channels.includes(ch.value)}
                    onChange={e => setRuleForm(f => ({
                      ...f, channels: e.target.checked ? [...f.channels, ch.value] : f.channels.filter(c => c !== ch.value),
                    }))}
                    className="rounded border-gray-600 text-cyan-500 focus:ring-cyan-500/50" />
                  <span className={`text-sm ${themeConfig.text.primary}`}>{ch.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.settings.cooldownMinutes')}</label>
            <input type="number" value={ruleForm.cooldown} onChange={e => setRuleForm(f => ({ ...f, cooldown: parseInt(e.target.value) || 60 }))}
              min={0} max={1440}
              className={`w-full px-4 py-2.5 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={ruleForm.enabled}
              onChange={e => setRuleForm(f => ({ ...f, enabled: e.target.checked }))}
              className="rounded border-gray-600 text-cyan-500 focus:ring-cyan-500/50" />
            <span className={`text-sm ${themeConfig.text.primary}`}>{t('imageService.settings.ruleEnabled')}</span>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setRuleModal({ open: false })}>{t('common.cancel')}</Button>
            <Button onClick={handleSaveRule} disabled={!ruleForm.name || !ruleForm.alertType}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      {/* Deleting a rule silently switches off notifications for that alert type, so it
          gets a confirmation rather than firing straight off a single click. */}
      <Modal isOpen={!!ruleToDelete} onClose={() => setRuleToDelete(null)} title={t('common.deleteConfirm')}>
        <div className="space-y-4">
          <p className={`text-sm ${themeConfig.text.primary}`}>
            {t('imageService.settings.ruleDeleteConfirm', { name: ruleToDelete?.name ?? '' })}
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setRuleToDelete(null)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => { deleteRuleMutation.mutate(ruleToDelete.id); setRuleToDelete(null); }}
              className="bg-red-500/80 hover:bg-red-500 text-white"
            >
              {t('common.delete')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSaveGeneral} disabled={saving}>
          <Save size={16} className="mr-1.5" />
          {saving ? t('common.saving') : t('common.save')}
        </Button>
        <Button variant="secondary" onClick={() => queryClient.invalidateQueries()}>
          <RefreshCw size={16} className="mr-1.5" />
          {t('imageService.settings.refreshData')}
        </Button>
        <Button variant="secondary" onClick={handleResetAll} className="text-red-400 border-red-500/30 hover:bg-red-500/10 ml-auto">
          <RotateCcw size={16} className="mr-1.5" />
          {t('imageService.settings.resetAll')}
        </Button>
      </div>
    </div>
  );
}
