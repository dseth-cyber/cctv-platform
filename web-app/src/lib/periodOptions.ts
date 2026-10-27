// Shared period-selector options for Overview + Executive — kept identical across both
// pages per user request (2026-08-06). `value` is what's sent to getTrends() and friends:
// 'today' triggers hourly bucketing server-side; every other value is a plain '<N>d'
// string the backend parses directly (see processing-logs.service.ts resolveGranularity),
// so adding/removing an option here needs no backend changes.
export interface PeriodOption {
  value: string;
  days: number;
  labelKey: string;
  fallback: string;
}

export const PERIOD_OPTIONS: PeriodOption[] = [
  { value: 'today', days: 1, labelKey: 'imageService.trends.period.today', fallback: 'วันนี้' }, // dropdown label stays plain "วันนี้" — no "(hourly)" suffix, per user request
  { value: '7d', days: 7, labelKey: 'imageService.trends.period.7d', fallback: '7 วัน' },
  { value: '14d', days: 14, labelKey: 'imageService.trends.period.14d', fallback: '14 วัน' },
  { value: '30d', days: 30, labelKey: 'imageService.trends.period.1m', fallback: '1 เดือน' },
  { value: '60d', days: 60, labelKey: 'imageService.trends.period.2m', fallback: '2 เดือน' },
  { value: '90d', days: 90, labelKey: 'imageService.trends.period.3m', fallback: '3 เดือน' },
  { value: '120d', days: 120, labelKey: 'imageService.trends.period.4m', fallback: '4 เดือน' },
  { value: '150d', days: 150, labelKey: 'imageService.trends.period.5m', fallback: '5 เดือน' },
  { value: '180d', days: 180, labelKey: 'imageService.trends.period.6m', fallback: '6 เดือน' },
  { value: '210d', days: 210, labelKey: 'imageService.trends.period.7m', fallback: '7 เดือน' },
  { value: '240d', days: 240, labelKey: 'imageService.trends.period.8m', fallback: '8 เดือน' },
  { value: '270d', days: 270, labelKey: 'imageService.trends.period.9m', fallback: '9 เดือน' },
  { value: '300d', days: 300, labelKey: 'imageService.trends.period.10m', fallback: '10 เดือน' },
  { value: '330d', days: 330, labelKey: 'imageService.trends.period.11m', fallback: '11 เดือน' },
  { value: '365d', days: 365, labelKey: 'imageService.trends.period.1y', fallback: '1 ปี' },
  { value: '730d', days: 730, labelKey: 'imageService.trends.period.2y', fallback: '2 ปี' },
  { value: '1095d', days: 1095, labelKey: 'imageService.trends.period.3y', fallback: '3 ปี' },
  { value: '1460d', days: 1460, labelKey: 'imageService.trends.period.4y', fallback: '4 ปี' },
  { value: '1825d', days: 1825, labelKey: 'imageService.trends.period.5y', fallback: '5 ปี' },
];

export function periodDays(value: string): number {
  return PERIOD_OPTIONS.find((o) => o.value === value)?.days ?? 7;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Formats a dailyBreakdown bucket's `date` (always a full ISO timestamp from getTrends —
// see processing-logs.service.ts, every granularity keys its buckets the same way) into a
// short chart-axis label matching its bucketUnit. Calendar-oriented buckets (day/week/
// month/year) read with UTC getters so the label can't shift a day depending on the
// viewer's local timezone offset — only 'hour' (literally about time-of-day) uses local
// wall-clock time.
export function formatBucketLabel(dateStr: string, bucketUnit: string | undefined): string {
  const d = new Date(dateStr);
  if (bucketUnit === 'hour') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (bucketUnit === 'week') {
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  if (bucketUnit === 'month') {
    return `${MONTH_ABBR[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
  }
  if (bucketUnit === 'year') {
    return String(d.getUTCFullYear());
  }
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; // day
}
