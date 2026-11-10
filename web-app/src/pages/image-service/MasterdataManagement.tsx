import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { hasPermission, MASTERDATA_LINKS } from '@/App';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { Plus, Trash2, Pencil, CheckCircle, XCircle } from 'lucide-react';

// Set up as pages of their own before; now tabs here, loaded when opened.
const CameraGroups = lazy(() => import('@/pages/cctv/CameraGroups'));
const CameraTemplates = lazy(() => import('@/pages/image-service/CameraTemplates'));
const ImageServiceRetention = lazy(() => import('@/pages/image-service/ImageServiceRetention'));
const PAGE_TABS: Record<string, (props: { embedded?: boolean }) => JSX.Element> = {
  '/cctv/camera-groups': (p) => <CameraGroups {...p} />,
  '/cctv/camera-templates': (p) => <CameraTemplates {...p} />,
  '/cctv/retention': (p) => <ImageServiceRetention {...p} />,
};
/** The tab key of each of those pages in ?tab=, e.g. camera-groups. */
export const pageTabKey = (path: string) => path.replace('/cctv/', '');

/** Lists whose codes the system acts on (same as the API's FIXED_CODES): names and order only. */
const FIXED_CODE_TABS = new Set(['camera_status']);
import { Button, Modal } from '@/components/ui';

type TabType = 'camera_status' | 'incident_reason' | 'incident_root_cause' | 'incident_resolution' | 'camera_type' | 'device_brand' | 'device_channel_count' | 'device_type' | 'camera_brand' | 'alert_level';

const TABS: { key: TabType; labelKey: string }[] = [
  { key: 'camera_type', labelKey: 'imageService.masterdataManagement.tabCameraType' },
  { key: 'camera_brand', labelKey: 'imageService.masterdataManagement.tabCameraBrand' },
  { key: 'device_type', labelKey: 'imageService.masterdataManagement.tabDeviceType' },
  { key: 'device_brand', labelKey: 'imageService.masterdataManagement.tabDeviceBrand' },
  { key: 'device_channel_count', labelKey: 'imageService.masterdataManagement.tabChannelCount' },
  { key: 'alert_level', labelKey: 'imageService.masterdataManagement.tabAlertLevel' },
  { key: 'camera_status', labelKey: 'imageService.masterdataManagement.tabCameraStatus' },
  { key: 'incident_reason', labelKey: 'imageService.masterdataManagement.tabIncidentReason' },
  { key: 'incident_root_cause', labelKey: 'imageService.masterdataManagement.tabIncidentRootCause' },
  { key: 'incident_resolution', labelKey: 'imageService.masterdataManagement.tabIncidentResolution' },
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

  const { user } = useAuth();
  const canReadLists = hasPermission(user, 'masterdata:read');
  const links = MASTERDATA_LINKS.filter((l) => hasPermission(user, l.permission));
  const [searchParams, setSearchParams] = useSearchParams();
  // One bar of tabs: the lists (?type=) and the pages that used to open on their own (?tab=).
  const listTabs = canReadLists ? TABS : [];
  const wantedPage = links.find((l) => pageTabKey(l.path) === searchParams.get('tab'));
  const wantedList = listTabs.find((tb) => tb.key === searchParams.get('type'));
  const pageTab = wantedPage ? wantedPage.path : (!wantedList && listTabs.length === 0 ? links[0]?.path ?? null : null);
  const activeTab: TabType = wantedList?.key ?? 'camera_type';
  const setActiveTab = (key: TabType) => setSearchParams({ type: key }, { replace: true });
  const openPageTab = (path: string) => setSearchParams({ tab: pageTabKey(path) }, { replace: true });
  const [modal, setModal] = useState<{ open: boolean; editing?: any }>({ open: false });
  const [form, setForm] = useState<Record<string, any>>({ code: '', nameTh: '', nameEn: '', nameCn: '', nameMm: '', nameJp: '', description: '', sortOrder: 0, isActive: true, isDefault: false, mainStreamPattern: '', subStreamPattern: '', defaultRtspPort: '', defaultHttpPort: '', alertDelay: '', incidentDelay: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['masterdata', activeTab],
    queryFn: () => imageServiceApi.getMasterdata({ type: activeTab }),
    staleTime: 1000 * 30,
    enabled: canReadLists,
  });

  const items: any[] = (data as any)?.data ?? [];

  const saveErrorText = (e: any) => {
    const details = e?.response?.data?.details;
    if (details?.code) {
      return t(`imageService.masterdataManagement.error_${details.code}`, { uses: details.uses, defaultValue: e?.response?.data?.message });
    }
    return e?.response?.data?.message || t('common.error');
  };

  const createMutation = useMutation({
    // Invalidate queries so default value updates immediately on cameras form too
    mutationFn: (d: any) => imageServiceApi.createMasterdata(d),
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ['masterdata'] }); 
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
      toast.success(t('common.saveSuccess')); 
      setModal({ open: false }); 
    },
    onError: (e: any) => { if (!e?._handled) toast.error(saveErrorText(e)); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => imageServiceApi.updateMasterdata(id, data),
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ['masterdata'] }); 
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
      toast.success(t('common.saveSuccess')); 
      setModal({ open: false }); 
    },
    onError: (e: any) => { if (!e?._handled) toast.error(saveErrorText(e)); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.deleteMasterdata(id),
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ['masterdata'] }); 
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
      toast.success(t('common.saveSuccess')); 
    },
    onError: (e: any) => { if (!e?._handled) toast.error(saveErrorText(e)); },
  });

  const openNew = () => {
    setForm({ code: '', nameTh: '', nameEn: '', nameCn: '', nameMm: '', nameJp: '', description: '', sortOrder: 0, isActive: true, isDefault: false, mainStreamPattern: '', subStreamPattern: '', defaultRtspPort: '', defaultHttpPort: '', alertDelay: '', incidentDelay: '' });
    setModal({ open: true, editing: undefined });
  };

  const openEdit = (item: any) => {
    setForm({ code: item.code, nameTh: item.nameTh ?? '', nameEn: item.nameEn ?? '', nameCn: item.nameCn ?? '', nameMm: item.nameMm ?? '', nameJp: item.nameJp ?? '', description: item.description ?? '', sortOrder: item.sortOrder, isActive: item.isActive, isDefault: !!item.isDefault, mainStreamPattern: item.config?.mainStreamPattern ?? '', subStreamPattern: item.config?.subStreamPattern ?? '', defaultRtspPort: item.config?.defaultRtspPort ?? '', defaultHttpPort: item.config?.defaultHttpPort ?? '', alertDelay: item.config?.alertDelayMinutes ?? '', incidentDelay: item.config?.incidentDelayMinutes ?? '' });
    setModal({ open: true, editing: item });
  };

  const handleSave = () => {
    const { mainStreamPattern, subStreamPattern, defaultRtspPort, defaultHttpPort, alertDelay, incidentDelay, ...fields } = form;
    const payload: Record<string, any> = { ...fields, type: activeTab, sortOrder: parseInt(form.sortOrder) || 0 };
    if (activeTab === 'device_brand') {
      payload.config = mainStreamPattern || subStreamPattern
        ? { mainStreamPattern: mainStreamPattern.trim(), subStreamPattern: subStreamPattern.trim(), defaultRtspPort: parseInt(defaultRtspPort) || 554, defaultHttpPort: parseInt(defaultHttpPort) || 80 }
        : null;
    }
    if (activeTab === 'alert_level') {
      const minutes = (value: unknown) => (value === '' || value === null ? null : Number(value));
      payload.config = { alertDelayMinutes: minutes(alertDelay), incidentDelayMinutes: minutes(incidentDelay) };
    }
    if (modal.editing) {
      updateMutation.mutate({ id: modal.editing.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const delayText = (minutes: unknown) => {
    if (typeof minutes !== 'number') return t('imageService.masterdataManagement.levelNever');
    return minutes === 0 ? t('imageService.masterdataManagement.levelAtOnce') : t('imageService.masterdataManagement.levelMinutes', { n: minutes });
  };

  const inputClass = `w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`;

  return (
    <div className="p-6">
      <div className="mb-6">
        <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>iSmart CCTV · {t('imageService.masterdataManagement.title')}</p>
        <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.title')}</h1>
        <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.masterdataManagement.subtitle')}</p>
      </div>

      <div data-masterdata-tabs className={`flex flex-wrap gap-1 mb-5 px-1 py-1 rounded-lg ${themeConfig.card}`}>
        {listTabs.map(tab => (
          <button key={tab.key} data-md-tab={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${!pageTab && activeTab === tab.key ? 'bg-cyan-500/15 text-cyan-300' : `${themeConfig.text.secondary} hover:text-white`}`}>
            {t(tab.labelKey)}
          </button>
        ))}
        {listTabs.length > 0 && links.length > 0 && <span className="w-px self-stretch my-1 mx-1 bg-white/10" />}
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <button key={link.path} data-md-tab={pageTabKey(link.path)} onClick={() => openPageTab(link.path)}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition-colors ${pageTab === link.path ? 'bg-cyan-500/15 text-cyan-300' : `${themeConfig.text.secondary} hover:text-white`}`}>
              <Icon size={15} /> {t(`imageService.${link.labelKey}`)}
            </button>
          );
        })}
      </div>

      {pageTab && PAGE_TABS[pageTab] && (
        <Suspense fallback={<div className={`text-sm ${themeConfig.text.secondary}`}>{t('common.loading')}</div>}>
          <div data-md-page={pageTabKey(pageTab)}>{PAGE_TABS[pageTab]({ embedded: true })}</div>
        </Suspense>
      )}

      {canReadLists && !pageTab && (<>

      {FIXED_CODE_TABS.has(activeTab) && (
        <p data-fixed-codes className={`mb-3 text-xs ${themeConfig.text.secondary}`}>{t('imageService.masterdataManagement.fixedCodes')}</p>
      )}
      {(activeTab === 'camera_type' || activeTab === 'device_brand' || activeTab === 'device_channel_count' || activeTab === 'alert_level') && (
        <p className={`mb-3 text-xs ${themeConfig.text.secondary}`}>{t(`imageService.masterdataManagement.hint_${activeTab}`)}</p>
      )}

      <div className={`${themeConfig.card} rounded-lg overflow-hidden`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <span className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t(TABS.find(t => t.key === activeTab)?.labelKey ?? 'imageService.masterdataManagement.tabCameraStatus')}</span>
          {!FIXED_CODE_TABS.has(activeTab) && <Button onClick={openNew} size="sm"><Plus size={14} className="mr-1" /> {t('imageService.masterdataManagement.add')}</Button>}
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
                    {activeTab === 'alert_level' && (
                      <div data-level-summary={item.code} className={`mt-1 font-sans font-normal text-xs ${themeConfig.text.secondary}`}>
                        {t('imageService.masterdataManagement.levelSummary', { alert: delayText(item.config?.alertDelayMinutes), incident: delayText(item.config?.incidentDelayMinutes) })}
                      </div>
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
                      {!FIXED_CODE_TABS.has(activeTab) && (
                        <button onClick={() => deleteMutation.mutate(item.id)} className="p-1.5 rounded-md hover:bg-red-500/10 text-red-400 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      </>)}

      <Modal isOpen={modal.open} onClose={() => setModal({ open: false })}
        title={modal.editing ? t('imageService.masterdataManagement.edit') : t('imageService.masterdataManagement.add')}>
        <div className="space-y-4">
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.formCode')}</label>
            <input value={form.code} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, code: e.target.value }))}
              disabled={FIXED_CODE_TABS.has(activeTab)}
              className={`${inputClass} disabled:opacity-60`} placeholder="unique_code" />
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
          {activeTab === 'device_brand' && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-white/10">
              <p className={`col-span-2 text-xs ${themeConfig.text.secondary}`}>{t('imageService.masterdataManagement.brandPatternHelp')}</p>
              <div className="col-span-2">
                <label className={`block text-sm font-medium mb-1 ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.brandMainPattern')}</label>
                <input value={form.mainStreamPattern} onChange={e => setForm(f => ({ ...f, mainStreamPattern: e.target.value }))} placeholder="/Streaming/Channels/{channel}01" className={`${inputClass} font-mono`} />
              </div>
              <div className="col-span-2">
                <label className={`block text-sm font-medium mb-1 ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.brandSubPattern')}</label>
                <input value={form.subStreamPattern} onChange={e => setForm(f => ({ ...f, subStreamPattern: e.target.value }))} placeholder="/Streaming/Channels/{channel}02" className={`${inputClass} font-mono`} />
              </div>
              <div>
                <label className={`block text-sm font-medium mb-1 ${themeConfig.text.primary}`}>RTSP port</label>
                <input type="number" min={1} max={65535} value={form.defaultRtspPort} onChange={e => setForm(f => ({ ...f, defaultRtspPort: e.target.value }))} placeholder="554" className={inputClass} />
              </div>
              <div>
                <label className={`block text-sm font-medium mb-1 ${themeConfig.text.primary}`}>HTTP port</label>
                <input type="number" min={1} max={65535} value={form.defaultHttpPort} onChange={e => setForm(f => ({ ...f, defaultHttpPort: e.target.value }))} placeholder="80" className={inputClass} />
              </div>
            </div>
          )}
          {activeTab === 'alert_level' && (
            <div data-level-form className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-white/10">
              <p className={`col-span-2 text-xs ${themeConfig.text.secondary}`}>{t('imageService.masterdataManagement.levelHelp')}</p>
              <div>
                <label className={`block text-sm font-medium mb-1 ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.levelAlertDelay')}</label>
                <input type="number" min={0} max={1440} data-level-alert value={form.alertDelay} onChange={e => setForm(f => ({ ...f, alertDelay: e.target.value }))} placeholder={t('imageService.masterdataManagement.levelNever')} className={inputClass} />
              </div>
              <div>
                <label className={`block text-sm font-medium mb-1 ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.levelIncidentDelay')}</label>
                <input type="number" min={0} max={1440} data-level-incident value={form.incidentDelay} onChange={e => setForm(f => ({ ...f, incidentDelay: e.target.value }))} placeholder={t('imageService.masterdataManagement.levelNever')} className={inputClass} />
              </div>
              <label className="col-span-2 flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.isDefault} onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))} className="rounded border-gray-600 text-cyan-500 focus:ring-cyan-500/50" />
                <span className={`text-sm ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.levelIsDefault')}</span>
              </label>
            </div>
          )}
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
                  disabled={FIXED_CODE_TABS.has(activeTab)}
                  onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                  className="rounded border-gray-600 text-cyan-500 focus:ring-cyan-500/50" />
                <span className={`text-sm ${themeConfig.text.primary}`}>{t('imageService.masterdataManagement.formActive')}</span>
              </label>
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
