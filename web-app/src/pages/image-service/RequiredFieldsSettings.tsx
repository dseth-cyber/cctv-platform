import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { hasPermission } from '@/App';
import { imageServiceApi } from '@/services/imageServiceApi';
import { Button } from '@/components/ui';
import { Save, Check, ClipboardCheck } from 'lucide-react';
import { REQUIRED_FIELD_CATALOG, catalogFieldsFor } from '@/config/requiredFieldsCatalog';

export default function RequiredFieldsSettings() {
  const { t } = useTranslation();
  const { themeConfig, theme } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canSave = hasPermission(user, 'system-config:update');

  const [activeEntity, setActiveEntity] = useState(REQUIRED_FIELD_CATALOG[0]?.entity ?? '');
  // Only user-selectable (non-always) selections are stored here; alwaysRequired
  // fields are treated as checked implicitly.
  const [config, setConfig] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['required-fields'],
    queryFn: () => imageServiceApi.getRequiredFields(),
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (data) setConfig(JSON.parse(JSON.stringify(data)));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, string[]>) => imageServiceApi.updateRequiredFields(payload),
    onSuccess: () => {
      toast.success(t('imageService.requiredFields.saveSuccess'));
      queryClient.invalidateQueries({ queryKey: ['required-fields'] });
    },
    onError: (e: any) => { if (!e?._handled) toast.error(t('common.error')); },
  });

  const active = REQUIRED_FIELD_CATALOG.find(c => c.entity === activeEntity)!;

  const isChecked = (entity: string, key: string, always?: boolean) =>
    always || (config[entity] ?? []).includes(key);

  const toggleField = (entity: string, key: string) => {
    setConfig(prev => {
      const cur = prev[entity] ?? [];
      const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key];
      return { ...prev, [entity]: next };
    });
  };

  const setFields = (entity: string, keys: string[], selected: boolean) => {
    setConfig(prev => {
      const cur = new Set(prev[entity] ?? []);
      if (selected) keys.forEach(k => cur.add(k));
      else keys.forEach(k => cur.delete(k));
      return { ...prev, [entity]: Array.from(cur) };
    });
  };

  // Selected count / total per entity (includes always-required fields).
  const entityCounts = useMemo(() => {
    const map: Record<string, { selected: number; total: number }> = {};
    for (const e of REQUIRED_FIELD_CATALOG) {
      const fields = catalogFieldsFor(e.entity);
      const selected = fields.filter(fd => isChecked(e.entity, fd.key, fd.alwaysRequired)).length;
      map[e.entity] = { selected, total: fields.length };
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const handleSave = () => {
    setSaving(true);
    saveMutation.mutate(config, { onSettled: () => setSaving(false) });
  };

  const tabCount = entityCounts[activeEntity] ?? { selected: 0, total: 0 };
  const allTabSelectable = catalogFieldsFor(activeEntity).filter(fd => !fd.alwaysRequired).map(fd => fd.key);
  const allTabSelected = allTabSelectable.every(k => (config[activeEntity] ?? []).includes(k));

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
            Image Service · {t('imageService.requiredFields.title')}
          </p>
          <h1 className={`text-2xl font-bold flex items-center gap-2 ${themeConfig.text.primary}`}>
            <ClipboardCheck size={22} className="text-cyan-400" />
            {t('imageService.requiredFields.title')}
          </h1>
          <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>
            {t('imageService.requiredFields.subtitle')}
          </p>
        </div>
        {canSave && (
          <Button onClick={handleSave} disabled={saving || isLoading}>
            <Save size={16} className="mr-1.5" />
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className={`${themeConfig.card} rounded-lg p-8 text-center text-sm ${themeConfig.text.secondary}`}>
          {t('common.loading')}
        </div>
      ) : (
        <>
          {/* Entity tab bar */}
          <div className="flex flex-wrap gap-2 mb-5">
            {REQUIRED_FIELD_CATALOG.map(e => {
              const c = entityCounts[e.entity] ?? { selected: 0, total: 0 };
              const activeTab = e.entity === activeEntity;
              return (
                <button key={e.entity} onClick={() => setActiveEntity(e.entity)}
                  className={`px-3.5 py-2 rounded-lg text-sm font-medium border transition-all flex items-center gap-2 ${activeTab
                    ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
                    : `border-white/10 hover:border-white/20 hover:bg-white/5 ${themeConfig.text.secondary}`}`}>
                  {t(e.labelKey)}
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${activeTab ? 'bg-cyan-500/20 text-cyan-200' : 'bg-white/10'}`}>
                    {c.selected} / {c.total}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Active tab content */}
          <div className={`${themeConfig.card} rounded-lg p-6`}>
            <div className={`flex items-center justify-between mb-5 pb-3 border-b ${theme === 'light' ? 'border-gray-200' : 'border-white/[0.08]'}`}>
              <h3 className={`text-base font-semibold ${themeConfig.text.primary}`}>{t(active.labelKey)}</h3>
              <div className="flex items-center gap-3">
                <span className={`text-xs ${themeConfig.text.secondary}`}>
                  {tabCount.selected} / {tabCount.total} {t('imageService.requiredFields.selectAll')}
                </span>
                <button
                  onClick={() => setFields(activeEntity, allTabSelectable, !allTabSelected)}
                  className="px-2.5 py-1 rounded-md text-xs font-medium border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 transition-colors">
                  {allTabSelected ? t('imageService.requiredFields.clearAll') : t('imageService.requiredFields.selectAll')}
                </button>
              </div>
            </div>

            <div className="space-y-6">
              {active.groups.map((group, gi) => {
                const groupSelectable = group.fields.filter(fd => !fd.alwaysRequired).map(fd => fd.key);
                const groupAllSelected = groupSelectable.length > 0 && groupSelectable.every(k => (config[activeEntity] ?? []).includes(k));
                return (
                  <div key={gi}>
                    <div className="flex items-center justify-between mb-2.5">
                      <h4 className={`text-sm font-semibold uppercase tracking-wide ${themeConfig.text.secondary}`}>
                        {t(group.labelKey)}
                      </h4>
                      {groupSelectable.length > 0 && (
                        <button
                          onClick={() => setFields(activeEntity, groupSelectable, !groupAllSelected)}
                          className={`text-xs font-medium hover:underline ${groupAllSelected ? 'text-amber-400' : 'text-cyan-400'}`}>
                          {groupAllSelected ? t('imageService.requiredFields.clearAll') : t('imageService.requiredFields.selectAll')}
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                      {group.fields.map(fd => {
                        const checked = isChecked(activeEntity, fd.key, fd.alwaysRequired);
                        const disabled = !!fd.alwaysRequired;
                        return (
                          <button key={fd.key} type="button"
                            disabled={disabled}
                            onClick={() => !disabled && toggleField(activeEntity, fd.key)}
                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left border transition-all ${checked
                              ? 'border-cyan-500/50 bg-cyan-500/10'
                              : theme === 'light' ? 'border-gray-200 hover:border-gray-300 hover:bg-gray-50' : 'border-white/10 hover:border-white/20 hover:bg-white/5'} ${disabled ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
                            title={disabled ? t('imageService.requiredFields.alwaysRequired') : ''}>
                            <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border ${checked ? 'bg-cyan-500 border-cyan-500' : theme === 'light' ? 'border-gray-300' : 'border-white/30'}`}>
                              {checked && <Check size={12} className="text-white" />}
                            </span>
                            <span className={checked ? (theme === 'light' ? 'text-cyan-800' : 'text-cyan-100') : themeConfig.text.primary}>
                              {t(fd.labelKey)}
                              {fd.alwaysRequired && <span className="text-red-400 ml-1">*</span>}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {canSave && (
            <div className="flex items-center gap-3 mt-5">
              <Button onClick={handleSave} disabled={saving || isLoading}>
                <Save size={16} className="mr-1.5" />
                {saving ? t('common.saving') : t('common.save')}
              </Button>
              <p className={`text-xs ${themeConfig.text.secondary}`}>
                {t('imageService.requiredFields.alwaysRequiredHint')}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
