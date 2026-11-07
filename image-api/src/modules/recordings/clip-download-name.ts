/** The name a downloaded clip is saved under: its title, made safe for a file system. */
export function clipDownloadName(title: string | null | undefined, fallback: string): string {
  const safe = (title ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 150).trim();
  return safe ? `${safe}.mp4` : fallback;
}
