import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useSitesWithZones } from '@/components/cctv/LocationFields';

/** Reads ?site= and ?zone= for a page opened from a place, and shows them with a way to clear them. */
export function usePlaceParams() {
  const [params] = useSearchParams();
  return { siteId: params.get('site') || undefined, zoneId: params.get('zone') || undefined };
}

export function PlaceFilterChip() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { data: sites = [] } = useSitesWithZones();
  const siteId = params.get('site');
  const zoneId = params.get('zone');
  if (!siteId && !zoneId) return null;
  const site = sites.find((s: any) => s.id === siteId);
  const zone = sites.flatMap((s: any) => s.zones ?? []).find((z: any) => z.id === zoneId);
  return (
    <button
      type="button"
      onClick={() => setParams({})}
      title={t('ui.location.clearFilter')}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/15 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/25"
    >
      <span>{[site?.name, zone?.name].filter(Boolean).join(' / ') || '—'}</span>
      <X size={12} />
    </button>
  );
}
