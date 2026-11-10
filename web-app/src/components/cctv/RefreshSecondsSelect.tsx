import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { imageServiceApi } from '@/services/imageServiceApi';

/** Choices only, within the server's 10-600 s, so nothing invalid can be picked. */
export const REFRESH_CHOICES = [10, 15, 30, 60, 120, 300, 600];

/** The system's still-image refresh, shared with the live overview's query. */
export function useSystemRefreshSeconds(): number | null {
  const { data } = useQuery<any>({ queryKey: ['snapshot-settings'], queryFn: () => imageServiceApi.getSnapshotSettings(), staleTime: 60_000 });
  return data?.refreshSeconds ?? null;
}

/**
 * Still-image refresh for one level (camera, group or DVR/NVR). Empty follows the next level up:
 * camera > group > DVR/NVR > system. `level` says which levels sit above, for the empty choice's text.
 */
export function RefreshSecondsSelect({ value, onChange, level, className, extraOptions = [], dataAttr }: {
  value: string;
  onChange: (value: string) => void;
  level: 'camera' | 'group' | 'device';
  className?: string;
  /** e.g. "no change" for bulk edit; shown first. */
  extraOptions?: Array<{ value: string; label: string }>;
  dataAttr?: string;
}) {
  const { t } = useTranslation();
  const system = useSystemRefreshSeconds();
  const inherit = t(`ui.snapshotRefresh.inherit_${level}`, { n: system ?? '?' });
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className} {...(dataAttr ? { [dataAttr]: '' } : {})}>
      {extraOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      <option value="">{inherit}</option>
      {/* A value set elsewhere (API, older choice list) stays shown, so saving the form for another change keeps it. */}
      {[...new Set([...REFRESH_CHOICES, ...(/^\d+$/.test(value) ? [Number(value)] : [])])].sort((a, b) => a - b)
        .map((n) => <option key={n} value={String(n)}>{t('ui.snapshotRefresh.every', { n })}</option>)}
    </select>
  );
}

/** Form value ('' or '30') to what the API takes (null or 30). */
export const refreshToApi = (v: string): number | null => (v === '' ? null : Number(v));
/** API value to form value. */
export const refreshToForm = (v: number | null | undefined): string => (v ? String(v) : '');
