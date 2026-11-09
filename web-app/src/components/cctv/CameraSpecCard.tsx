import { useTranslation } from 'react-i18next';
import { AlertTriangle, Cpu } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { formatDateTime } from '@/utils/dateUtils';
import { resolutionName, signalName, specNotes, type CameraSpec, type StreamSpec } from '@/lib/cameraSpec';

/** What the recorder reports about this camera: both streams, the signal coming in, and the IP camera itself. */
export function CameraSpecCard({ spec, readAt }: { spec: CameraSpec | null | undefined; readAt?: string | null }) {
  const { t, i18n } = useTranslation();
  const { themeConfig } = useTheme();
  const k = (key: string, opts?: Record<string, unknown>): string => String(t(`ui.cameraSpec.${key}`, opts as any));

  const stream = (s: StreamSpec | undefined) => {
    if (!s) return '—';
    const parts = [
      // "1080p (1920×1080)", but a size with no common name only once.
      [resolutionName(s.width, s.height), s.width && s.height && resolutionName(s.width, s.height) !== `${s.width}×${s.height}` ? `(${s.width}×${s.height})` : null].filter(Boolean).join(' '),
      s.codec,
      s.fps === 0 ? k('fullFps') : s.fps ? `${s.fps} fps` : null,
      s.bitrateKbps ? `${k(/cbr/i.test(s.rateControl ?? '') ? 'bitrateFixed' : 'bitrateMax')} ${s.bitrateKbps} Kbps` : null,
      s.smartCodec ? 'H.265+/Smart Codec' : null,
    ].filter(Boolean);
    return parts.join(' · ');
  };
  const signal = signalName(spec?.signal);
  const notes = specNotes(spec);
  const row = (label: string, value: string | null | undefined, attr?: string) => (
    <>
      <dt className={themeConfig.text.secondary}>{label}</dt>
      <dd data-spec={attr} className={themeConfig.text.primary}>{value || '—'}</dd>
    </>
  );

  return (
    <div data-camera-spec className={`p-4 rounded-xl border ${themeConfig.card} mb-6`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className={`text-sm font-semibold flex items-center gap-1.5 ${themeConfig.text.primary}`}>
          <Cpu size={15} className="text-cyan-400" />
          {k('title')}
        </h3>
        {readAt && <span className={`text-xs ${themeConfig.text.secondary}`}>{k('readAt', { time: formatDateTime(readAt, i18n.language) })}</span>}
      </div>
      {!spec ? (
        <p className={`text-sm ${themeConfig.text.secondary}`}>{k('none')}</p>
      ) : (
        <>
          {notes.length > 0 && (
            <div className="space-y-1 mb-3">
              {notes.map((n) => (
                <p key={n} data-spec-note={n} className="flex items-start gap-1.5 text-xs text-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {k(`note.${n}`)}
                </p>
              ))}
            </div>
          )}
          <dl className="grid grid-cols-1 sm:grid-cols-[12rem_1fr] gap-y-2 gap-x-4 text-sm">
            {row(k('main'), stream(spec.main), 'main')}
            {row(k('sub'), stream(spec.sub), 'sub')}
            {spec.signal !== undefined && row(k('signal'), signal ? (signal.none ? k('noSignal') : signal.sd ? `${signal.text} (${k('sdAnalog')})` : signal.text) : null, 'signal')}
            {spec.ipCamera && (
              <>
                {row(k('ipModel'), spec.ipCamera.model, 'ip-model')}
                {row(k('ipSerial'), spec.ipCamera.serialNumber)}
                {row(k('ipFirmware'), spec.ipCamera.firmwareVersion)}
                {row(k('ipAddress'), [spec.ipCamera.ipAddress, spec.ipCamera.protocol].filter(Boolean).join(' · '))}
                {row(k('ipPassword'), spec.ipCamera.passwordStatus)}
              </>
            )}
          </dl>
        </>
      )}
    </div>
  );
}

/** The short form for a list: "1080p", "960×576 · PAL", or "—". */
export function cameraResolutionText(spec: CameraSpec | null | undefined, noSignal: string): string {
  if (!spec) return '—';
  const signal = signalName(spec.signal);
  if (signal?.none) return noSignal;
  const main = resolutionName(spec.main?.width, spec.main?.height);
  if (!main) return signal?.text ?? '—';
  return signal?.sd ? `${main} · ${signal.text}` : main;
}
