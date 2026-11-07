export interface InventorySlice {
  /** The list's code, or NO_VALUE for records with nothing set. */
  key: string;
  label: string;
  /** Short enough for a chart axis. */
  short: string;
  count: number;
  percent: number;
  kind: 'value' | 'none' | 'other';
  /** Position in the master data list, so a value keeps its colour whatever the counts do. */
  colorSlot: number;
}

export const NO_VALUE = 'none';
const MAX_VALUES = 5;
const SHORT_LENGTH = 12;

const shorten = (label: string) => (label.length > SHORT_LENGTH ? `${label.slice(0, SHORT_LENGTH - 1)}…` : label);

/** Counts values into at most five named slices, then "not specified" and "other". */
export function buildInventorySlices(
  values: Array<string | null | undefined>,
  options: Array<{ value: string; label: string }>,
  labels: { none: string; other: string },
): InventorySlice[] {
  const counts = new Map<string, number>();
  const originalCase = new Map<string, string>();
  let none = 0;
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) {
      none += 1;
      continue;
    }
    const key = value.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!originalCase.has(key)) originalCase.set(key, value);
  }
  const total = values.length;
  const percent = (count: number) => (total > 0 ? Math.round((count / total) * 100) : 0);
  const slot = (key: string) => {
    const index = options.findIndex((o) => o.value.toLowerCase() === key);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || slot(a[0]) - slot(b[0]));
  const slices: InventorySlice[] = sorted.slice(0, MAX_VALUES).map(([key, count]) => {
    const option = options.find((o) => o.value.toLowerCase() === key);
    const label = option?.label ?? (originalCase.get(key) as string);
    return { key: option?.value ?? (originalCase.get(key) as string), label, short: shorten(label), count, percent: percent(count), kind: 'value', colorSlot: slot(key) };
  });
  if (none > 0) {
    slices.push({ key: NO_VALUE, label: labels.none, short: shorten(labels.none), count: none, percent: percent(none), kind: 'none', colorSlot: -1 });
  }
  const rest = sorted.slice(MAX_VALUES).reduce((sum, [, count]) => sum + count, 0);
  if (rest > 0) {
    slices.push({ key: 'other', label: labels.other, short: shorten(labels.other), count: rest, percent: percent(rest), kind: 'other', colorSlot: -1 });
  }
  return slices;
}
