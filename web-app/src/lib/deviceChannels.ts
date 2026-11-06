const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export const isValidIPv4 = (value: string) => IPV4.test(value.trim());

/** The address of a clone until someone types the real one: it cannot be saved like this. */
export const cloneIpPlaceholder = (ip: string | null | undefined) => (ip ?? '').replace(/\.[^.]*$/, '.xxx');

/** "DVR A Copy", then "DVR A Copy 2", and so on. */
export function uniqueCopyName(name: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  const first = `${name} Copy`;
  if (!used.has(first.toLowerCase())) return first;
  for (let n = 2; ; n++) {
    const next = `${name} Copy ${n}`;
    if (!used.has(next.toLowerCase())) return next;
  }
}

/** [1,2,3,5] reads as "1-3, 5". */
export function formatChannelRanges(channels: number[]): string {
  const sorted = [...channels].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(sorted[i] === start ? String(start) : `${start}-${sorted[i]}`);
  }
  return parts.join(', ');
}

export interface SpareRow {
  device: any;
  total: number;
  inUse: number;
  spare: number[];
}

/** Channels of each recorder with no camera in use, most spare first. A broken camera is in use, not spare. */
export function spareChannels(devices: any[]): SpareRow[] {
  return devices
    .map((device) => {
      const total = Number(device.totalChannels) || 0;
      const on = new Set<number>((device.enabledChannels ?? []).filter((ch: number) => ch <= total));
      const spare = Array.from({ length: total }, (_, i) => i + 1).filter((ch) => !on.has(ch));
      return { device, total, inUse: on.size, spare };
    })
    .filter((row) => row.spare.length > 0)
    .sort((a, b) => b.spare.length - a.spare.length || String(a.device.name).localeCompare(String(b.device.name)));
}

/** How many spare channels per key, largest first. */
export function countSpareBy(rows: SpareRow[], keyOf: (row: SpareRow) => string): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(keyOf(row), (counts.get(keyOf(row)) ?? 0) + row.spare.length);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
