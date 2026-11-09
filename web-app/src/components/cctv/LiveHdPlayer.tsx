import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, RefreshCw } from 'lucide-react';
import { imageServiceApi } from '@/services/imageServiceApi';
import { WhepPlayer, type WhepPlayerProps } from './WhepPlayer';

/** No HD picture by then: the recorder sends whole frames too far apart (Smart Codec / H.265+) to wait on. */
export const HD_GIVE_UP_MS = 40_000;

/**
 * Live HD that never leaves the screen black. A recorder can start its main stream only at a whole frame, and with
 * Smart Codec those come every 20-30 s. So the sub stream, which starts in about a second, shows first; the main
 * stream loads out of sight and takes over at its first picture. Without HD in 40 s the sub stream stays, saying why.
 */
export function LiveHdPlayer({ cameraId, ...props }: WhepPlayerProps & { cameraId: string }) {
  const { t } = useTranslation();
  const wantsPreview = props.streamProfile !== 'sub' && !!props.hasSubStream;
  const [subUrl, setSubUrl] = useState<string | null>(null);
  const [hdReady, setHdReady] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setSubUrl(null);
    setHdReady(false);
    setGaveUp(false);
    if (!wantsPreview) return;
    let gone = false;
    imageServiceApi.getCameraStream(cameraId, { profile: 'sub' })
      .then((s: any) => { if (!gone && s?.webrtcWhepUrl && s.profile !== 'main') setSubUrl(s.webrtcWhepUrl); })
      .catch(() => {});
    return () => { gone = true; };
  }, [cameraId, props.streamUrl, wantsPreview]);

  useEffect(() => {
    if (!wantsPreview || hdReady) return;
    const timer = setTimeout(() => setGaveUp(true), HD_GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [wantsPreview, hdReady, attempt]);

  if (!wantsPreview) return <WhepPlayer {...props} />;

  // Without a sub stream to show, HD shows as it comes, as before.
  const previewing = !!subUrl && !hdReady;
  return (
    <div data-live-hd={hdReady ? 'hd' : gaveUp ? 'gave-up' : subUrl ? 'preview' : 'waiting'} className={`relative ${props.className ?? ''}`}>
      {previewing && (
        <WhepPlayer
          {...props}
          key={subUrl}
          streamUrl={subUrl}
          streamProfile="sub"
          className="w-full h-full"
          onFatalError={undefined}
          onFirstFrame={undefined}
        />
      )}
      {!(previewing && gaveUp) && (
        <div className={previewing ? 'absolute inset-0 opacity-0 pointer-events-none' : 'absolute inset-0'} aria-hidden={previewing}>
          <WhepPlayer
            {...props}
            key={`${props.streamUrl}#${attempt}`}
            className="w-full h-full"
            onFirstFrame={() => {
              setHdReady(true);
              props.onFirstFrame?.();
            }}
          />
        </div>
      )}
      {previewing && (
        <div data-live-hd-note className="absolute top-2 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-2 py-1 rounded bg-slate-950/85 border border-slate-700 text-[11px] text-slate-200">
          {gaveUp ? (
            <>
              <span>{t('ui.liveHd.gaveUp')}</span>
              <button
                type="button"
                onClick={() => { setGaveUp(false); setAttempt((n) => n + 1); }}
                className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
              >
                <RefreshCw className="w-3 h-3" />
                {t('ui.liveHd.retry')}
              </button>
            </>
          ) : (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>{t('ui.liveHd.loading')}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Live for one camera from its id alone: asks the server for a signed stream address first (MediaMTX refuses one without). */
export function CameraLivePlayer({ cameraId, cameraName, className }: { cameraId: string; cameraName?: string; className?: string }) {
  const { t } = useTranslation();
  const [stream, setStream] = useState<{ url: string; hasSub: boolean; profile: 'main' | 'sub' } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let gone = false;
    setStream(null);
    setFailed(false);
    imageServiceApi.getCameraStream(cameraId)
      .then((s: any) => {
        if (gone) return;
        if (!s?.webrtcWhepUrl) { setFailed(true); return; }
        setStream({ url: s.webrtcWhepUrl, hasSub: Boolean(s.hasSubStream), profile: s.profile === 'sub' ? 'sub' : 'main' });
      })
      .catch(() => { if (!gone) setFailed(true); });
    return () => { gone = true; };
  }, [cameraId]);
  if (!stream) {
    return (
      <div data-camera-live={failed ? 'failed' : 'loading'} className={`flex items-center justify-center text-xs text-slate-400 ${className ?? ''}`}>
        {failed ? t('ui.liveHd.noStream') : <Loader2 className="w-5 h-5 animate-spin" />}
      </div>
    );
  }
  return (
    <LiveHdPlayer cameraId={cameraId} streamUrl={stream.url} cameraName={cameraName} streamProfile={stream.profile} hasSubStream={stream.hasSub} className={className ?? 'w-full h-full'} />
  );
}
