import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { Save, RotateCcw, RefreshCw, Settings, Database, Server, Bell, Upload, Info, Zap } from 'lucide-react';
import { Button } from '@/components/ui';
import { Modal } from '@/components/ui';

// JSON settings come back parsed; String() would turn them into "[object Object]" on the next save.
const toFormValue = (value: unknown) =>
  value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');

const CATEGORIES: { key: string; icon: any; labelKey: string; color: string }[] = [
  { key: 'general', icon: Settings, labelKey: 'imageService.systemConfig.categoryGeneral', color: 'text-gray-400 bg-gray-500/10' },
  { key: 'retention', icon: Database, labelKey: 'imageService.systemConfig.categoryRetention', color: 'text-blue-400 bg-blue-500/10' },
  { key: 'alert', icon: Bell, labelKey: 'imageService.systemConfig.categoryAlert', color: 'text-red-400 bg-red-500/10' },
  { key: 'storage', icon: Server, labelKey: 'imageService.systemConfig.categoryStorageLimit', color: 'text-teal-400 bg-teal-500/10' },
  { key: 'automation', icon: Zap, labelKey: 'imageService.systemConfig.categoryAutomation', color: 'text-cyan-400 bg-cyan-500/10' },
];

export default function SystemConfigPage() {
  const { t } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<Record<string, any>>({});

  const { data: configs, isLoading } = useQuery({
    queryKey: ['system-config'],
    queryFn: () => imageServiceApi.getSystemConfigs(),
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (configs) {
      const init: Record<string, string> = {};
      for (const [key, cfg] of Object.entries(configs)) {
        init[key] = toFormValue((cfg as any).value);
      }
      setValues(init);
    }
  }, [configs]);

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, string>) => imageServiceApi.updateSystemConfigs(data),
    onSuccess: () => {
      toast.success(t('common.saveSuccess'));
      setProblems({});
      queryClient.invalidateQueries({ queryKey: ['system-config'] });
      queryClient.invalidateQueries({ queryKey: ['system-branding'] });
    },
    onError: (e: any) => {
      const list = e?.response?.data?.details?.problems;
      if (Array.isArray(list)) {
        setProblems(Object.fromEntries(list.map((p: any) => [p.key, p])));
        toast.error(t('imageService.systemConfig.problems.summary', { count: list.length }));
      } else if (!e?._handled) toast.error(t('common.error'));
    },
  });

  const handleSave = () => {
    // Only what was edited, so one setting cannot overwrite another with a stale copy.
    const changed = Object.fromEntries(
      Object.entries(values).filter(([key, value]) => value !== toFormValue((configs as any)?.[key]?.value)),
    );
    if (Object.keys(changed).length === 0) {
      toast.success(t('imageService.systemConfig.problems.noChanges'));
      return;
    }
    setSaving(true);
    saveMutation.mutate(changed, { onSettled: () => setSaving(false) });
  };

  const handleReset = () => {
    if (configs) {
      const reset: Record<string, string> = {};
      for (const [key, cfg] of Object.entries(configs)) {
        reset[key] = toFormValue((cfg as any).value);
      }
      setValues(reset);
      setProblems({});
    }
  };

  const inputClass = `w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`;

  const grouped: Record<string, [string, any][]> = {};
  if (configs) {
    for (const [key, cfg] of Object.entries(configs)) {
      const cat = (cfg as any).category ?? 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push([key, cfg]);
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
          iSmart CCTV · {t('imageService.systemConfig.title')}
        </p>
        <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.systemConfig.title')}</h1>
        <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>
          {t('imageService.systemConfig.subtitle')}
        </p>
      </div>

      {isLoading ? (
        <div className={`${themeConfig.card} rounded-lg p-8 text-center text-sm ${themeConfig.text.secondary}`}>{t('common.loading')}</div>
      ) : (
        <>
          {/* General category — always rendered */}
          <div className={`${themeConfig.card} rounded-lg p-6 mb-5`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg text-cyan-400 bg-cyan-500/10">
                <Info size={18} />
              </div>
              <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.systemConfig.categoryAbout')}</h3>
            </div>
            <div className="space-y-4">
              {/* Logo */}
              <div>
                <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.systemConfig.logo')}</label>
                <div className="flex items-center gap-4">
                  {values.system_logo && (
                    <img src={values.system_logo} alt={t('ui.systemConfigPage.logo')} className="h-14 w-14 rounded-lg object-contain border border-white/20 bg-white/10" />
                  )}
                  <label className="cursor-pointer">
                    <div className="flex items-center gap-2 px-4 py-2 rounded-md text-sm border border-white/30 bg-white/10 text-white hover:bg-white/20 transition-colors">
                      <Upload size={14} />
                      {values.system_logo ? t('imageService.systemConfig.changeLogo') : t('imageService.systemConfig.uploadLogo')}
                    </div>
                    <input type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => setValues(v => ({ ...v, system_logo: reader.result as string }));
                        reader.readAsDataURL(file);
                      }} />
                  </label>
                  {values.system_logo && (
                    <button onClick={() => setValues(v => ({ ...v, system_logo: '' }))}
                      className="text-xs text-red-400 hover:text-red-300">{t('common.remove')}</button>
                  )}
                </div>
                <p className={`text-xs mt-1 ${themeConfig.text.secondary}`}>{t('imageService.systemConfig.logoHint')}</p>
              </div>

              {/* Program Name */}
              <div>
                <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.systemConfig.programName')}</label>
                <input value={values.system_name ?? ''} onChange={e => setValues(v => ({ ...v, system_name: e.target.value }))}
                  className={inputClass} placeholder="iSmart CCTV" />
              </div>

              {/* Program Description */}
              <div>
                <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.systemConfig.programDescription')}</label>
                <input value={values.system_description ?? ''} onChange={e => setValues(v => ({ ...v, system_description: e.target.value }))}
                  className={inputClass} placeholder="Enterprise CCTV Management System" />
              </div>

              {/* Program Version */}
              <div>
                <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.systemConfig.programVersion')}</label>
                <input value={values.system_version ?? ''} onChange={e => setValues(v => ({ ...v, system_version: e.target.value }))}
                  className={inputClass} placeholder="1.0.0" />
              </div>

              {/* Copyright */}
              <div>
                <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.systemConfig.copyright')}</label>
                <textarea value={values.system_copyright ?? ''} onChange={e => setValues(v => ({ ...v, system_copyright: e.target.value }))}
                  className={`${inputClass} min-h-[60px]`} placeholder="© 2026 Chiotron. All rights reserved." rows={2} />
              </div>

            </div>
          </div>

          {CATEGORIES.filter(c => c.key !== 'general').map(cat => {
            const items = grouped[cat.key];
            if (!items || items.length === 0) return null;
            const Icon = cat.icon;
            return (
              <div key={cat.key} className={`${themeConfig.card} rounded-lg p-6 mb-5`}>
                <div className="flex items-center gap-3 mb-4">
                  <div className={`p-2 rounded-lg ${cat.color}`}>
                    <Icon size={18} />
                  </div>
                  <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t(cat.labelKey)}</h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {items.map(([key, cfg]) => {
                    const labelKey = `imageService.systemConfig.labels.${key}`;
                    const descKey = `imageService.systemConfig.descriptions.${key}`;
                    const translatedLabel = t(labelKey) !== labelKey ? t(labelKey) : key.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                    const translatedDesc = t(descKey) !== descKey ? t(descKey) : (cfg as any).description;
                    const { min, max } = cfg as any;
                    const problem = problems[key];
                    const problemText = problem && t(`imageService.systemConfig.problems.${problem.reason}`, {
                      min: problem.min,
                      max: problem.max,
                      other: problem.other && t(`imageService.systemConfig.labels.${problem.other}`),
                    });
                    if ((cfg as any).valueType === 'boolean') {
                      const checked = values[key] === 'true';
                      return (
                        <div key={key} className="flex items-start gap-3">
                          <input type="checkbox" checked={checked}
                            onChange={e => setValues(v => ({ ...v, [key]: e.target.checked ? 'true' : 'false' }))}
                            className="w-4 h-4 mt-0.5 rounded accent-cyan-500 flex-shrink-0" />
                          <div>
                            <label className={`block text-sm font-medium ${themeConfig.text.primary}`}>{translatedLabel}</label>
                            <p className={`text-xs mt-0.5 ${themeConfig.text.secondary}`}>{translatedDesc}</p>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={key}>
                        <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                          {translatedLabel}
                        </label>
                        <input type={(cfg as any).valueType === 'number' ? 'number' : 'text'}
                          min={min} max={max}
                          value={values[key] ?? ''}
                          onChange={e => {
                            setValues(v => ({ ...v, [key]: e.target.value }));
                            setProblems(({ [key]: _fixed, ...rest }) => rest);
                          }}
                          className={`${inputClass} ${problem ? '!border-red-500' : ''}`} />
                        <p className={`text-xs mt-0.5 ${themeConfig.text.secondary}`}>
                          {translatedDesc}
                          {min !== undefined && ` ${t('imageService.systemConfig.problems.rangeHint', { min, max })}`}
                        </p>
                        {problemText && <p className="text-xs mt-0.5 text-red-400">{problemText}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving}>
              <Save size={16} className="mr-1.5" />
              {saving ? t('common.saving') : t('common.save')}
            </Button>
            <Button variant="secondary" onClick={handleReset}>
              <RotateCcw size={16} className="mr-1.5" />
              {t('imageService.systemConfig.reset')}
            </Button>
            <Button variant="secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ['system-config'] })}>
              <RefreshCw size={16} className="mr-1.5" />
              {t('imageService.systemConfig.refresh')}
            </Button>
          </div>
        </>
      )}

    </div>
  );
}
