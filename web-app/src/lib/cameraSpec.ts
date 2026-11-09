/** What a recorder reports about one camera channel (stored as cameras.spec by the device health round). */
export interface StreamSpec {
  codec: string | null;
  width: number | null;
  height: number | null;
  /** 0 is Hikvision's "full frame rate". */
  fps: number | null;
  bitrateKbps: number | null;
  rateControl: string | null;
  smartCodec: boolean;
}

export interface CameraSpec {
  main?: StreamSpec;
  sub?: StreamSpec;
  signal?: string | null;
  ipCamera?: {
    model: string | null;
    serialNumber: string | null;
    firmwareVersion: string | null;
    ipAddress: string | null;
    protocol: string | null;
    passwordStatus?: string | null;
  };
}

/** "1080p", "4K", "720p", or the plain size when it has no common name. */
export function resolutionName(width: number | null | undefined, height: number | null | undefined): string | null {
  if (!width || !height) return null;
  const named: Record<string, string> = {
    '3840x2160': '4K', '2560x1440': '4MP', '2688x1520': '4MP', '3072x2048': '6MP', '2592x1944': '5MP',
    '1920x1080': '1080p', '1280x720': '720p',
  };
  return named[`${width}x${height}`] ?? `${width}×${height}`;
}

/** The analog signal as a person reads it: "1080p 25fps", "PAL", or null for no signal. */
export function signalName(signal: string | null | undefined): { text: string; sd: boolean; none: boolean } | null {
  if (!signal) return null;
  const s = signal.trim();
  if (/no\s*video/i.test(s)) return { text: s, sd: false, none: true };
  if (/^(pal|ntsc)$/i.test(s)) return { text: s.toUpperCase(), sd: true, none: false };
  const lines = s.match(/(\d{3,4})P/i)?.[1];
  const fps = s.match(/P(\d{2})\s*$/i)?.[1];
  if (lines) return { text: `${lines}p${fps ? ` ${fps}fps` : ''}`, sd: Number(lines) < 720, none: false };
  return { text: s, sd: false, none: false };
}

/** Lines of the analog signal (1080 for "1920*1080(1080P)P25" or "1080P25"); PAL is 576, NTSC 480. */
function signalLines(signal: string | null | undefined): number | null {
  if (!signal) return null;
  if (/^pal$/i.test(signal.trim())) return 576;
  if (/^ntsc$/i.test(signal.trim())) return 480;
  const lines = signal.match(/(\d{3,4})P/i)?.[1];
  return lines ? Number(lines) : null;
}

export type SpecNote = 'no_signal' | 'sd_analog' | 'recorded_below_camera' | 'smart_codec' | 'weak_password';

/** What is worth a person's attention in this camera's spec. Not alerts: settings and hardware to know about. */
export function specNotes(spec: CameraSpec | null | undefined): SpecNote[] {
  if (!spec) return [];
  const notes: SpecNote[] = [];
  const signal = signalName(spec.signal);
  if (signal?.none) notes.push('no_signal');
  else if (signal?.sd) notes.push('sd_analog');
  const lines = signalLines(spec.signal);
  if (!signal?.none && lines && spec.main?.height && spec.main.height < lines) notes.push('recorded_below_camera');
  if (spec.main?.smartCodec) notes.push('smart_codec');
  if (/weak|risk/i.test(spec.ipCamera?.passwordStatus ?? '')) notes.push('weak_password');
  return notes;
}
