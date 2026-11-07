/**
 * The name offered for a new clip: code-channel-date_time. The camera's own code wins over its recorder's,
 * and with neither set the name stays the plain Clip_date_time.
 */
export function defaultClipTitle(
  camera: { shortCode?: string | null; channelNumber?: number | null; device?: { shortCode?: string | null } | null } | null | undefined,
  date: string,
  time: string,
): string {
  const code = camera?.shortCode?.trim() || camera?.device?.shortCode?.trim();
  if (!code) return `Clip_${date}_${time}`;
  const channel = camera?.channelNumber != null ? `Ch${camera.channelNumber}-` : '';
  return `${code}-${channel}${date}_${time}`;
}

/** What a code may contain, so it is also safe in a file name. */
export const cleanShortCode = (value: string) => value.replace(/[^\p{L}\p{N}\p{M}_-]/gu, '').slice(0, 20);
