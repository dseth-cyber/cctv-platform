import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SearchableSelect } from '@/components/ui';
import { useTheme } from '@/contexts/ThemeContext';
import { imageServiceApi } from '@/services/imageServiceApi';

export interface CameraScopeValue {
  all?: boolean;
  siteIds?: string[];
  zoneIds?: string[];
  deviceIds?: string[];
  groupIds?: string[];
}

/** Which cameras a role or a person may see: everything, or the places, recorders and groups chosen here. */
export function CameraScopeFields({ value, onChange, hint }: { value: CameraScopeValue; onChange: (next: CameraScopeValue) => void; hint: string }) {
  const { t } = useTranslation();
  const { themeConfig } = useTheme();
  const { data: sites = [] } = useQuery<any[]>({ queryKey: ['scope-sites'], queryFn: () => imageServiceApi.getSites() });
  const { data: devices = [] } = useQuery<any[]>({ queryKey: ['scope-devices'], queryFn: () => imageServiceApi.getDevices() });
  const { data: groups = [] } = useQuery<any[]>({ queryKey: ['scope-groups'], queryFn: () => imageServiceApi.getCameraGroups() });

  const zones = useMemo(
    () => (sites as any[]).flatMap((site) => (site.zones ?? []).map((zone: any) => ({ value: zone.id, label: `${site.name} / ${zone.name}` }))),
    [sites],
  );
  const lists: Array<{ key: 'siteIds' | 'zoneIds' | 'deviceIds' | 'groupIds'; options: Array<{ value: string; label: string }> }> = [
    { key: 'siteIds', options: (sites as any[]).map((s) => ({ value: s.id, label: s.name })) },
    { key: 'zoneIds', options: zones },
    { key: 'deviceIds', options: (devices as any[]).map((d) => ({ value: d.id, label: d.name })) },
    { key: 'groupIds', options: (groups as any[]).map((g) => ({ value: g.id, label: g.name })) },
  ];

  return (
    <div data-camera-scope className="space-y-3 p-3 rounded-lg border border-white/10">
      <p className={`text-sm font-medium ${themeConfig.text.primary}`}>{t('ui.cameraScope.title')}</p>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" data-scope-all checked={!!value.all} onChange={(e) => onChange({ ...value, all: e.target.checked })} className="rounded border-gray-600 text-cyan-500 focus:ring-cyan-500/50" />
        <span className={`text-sm ${themeConfig.text.primary}`}>{t('ui.cameraScope.all')}</span>
      </label>
      {!value.all && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {lists.map(({ key, options }) => (
            <div key={key} data-scope-list={key}>
              <label className={`block text-xs font-medium mb-1 ${themeConfig.text.secondary}`}>{t(`ui.cameraScope.${key}`)}</label>
              <SearchableSelect
                isMulti
                selectedValues={value[key] ?? []}
                onMultiChange={(next) => onChange({ ...value, [key]: next })}
                options={options}
                placeholder={t('ui.cameraScope.none')}
                countLabel={(n) => t('ui.cameraScope.chosen', { n })}
              />
            </div>
          ))}
        </div>
      )}
      <p className={`text-xs ${themeConfig.text.secondary}`}>{value.all ? t('ui.cameraScope.allHint') : hint}</p>
    </div>
  );
}
