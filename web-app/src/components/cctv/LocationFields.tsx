import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { imageServiceApi } from '@/services/imageServiceApi';
import { SearchableSelect } from '@/components/ui';

export function useSitesWithZones() {
  return useQuery<any[]>({
    queryKey: ['cctv-sites'],
    queryFn: () => imageServiceApi.getSites(),
    staleTime: 30_000,
  });
}

/** Site, then a zone of that site. Both lists are managed on the sites page. */
export function LocationFields({ siteId, zoneId, onChange, labelClass = 'block text-sm font-medium mb-1.5' }: {
  siteId: string;
  zoneId: string;
  onChange: (next: { siteId: string; zoneId: string }) => void;
  labelClass?: string;
}) {
  const { t } = useTranslation();
  const { data: sites = [] } = useSitesWithZones();
  const zones: any[] = sites.find((s) => s.id === siteId)?.zones ?? [];
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <div className="flex items-center justify-between">
          <label className={labelClass}>{t('ui.location.site')}</label>
          <Link to="/cctv/sites" className="text-xs text-cyan-400 hover:text-cyan-300 mb-1.5">{t('ui.location.manage')}</Link>
        </div>
        <SearchableSelect
          value={siteId}
          onChange={(v) => onChange({ siteId: v, zoneId: '' })}
          options={[{ value: '', label: t('ui.location.none') }, ...sites.map((s) => ({ value: s.id, label: s.name }))]}
        />
      </div>
      <div>
        <label className={labelClass}>{t('ui.location.zone')}</label>
        <SearchableSelect
          value={zoneId}
          onChange={(v) => onChange({ siteId, zoneId: v })}
          options={[{ value: '', label: t('ui.location.none') }, ...zones.map((z) => ({ value: z.id, label: z.name }))]}
        />
      </div>
    </div>
  );
}
