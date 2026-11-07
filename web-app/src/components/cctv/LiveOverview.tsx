import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ImageIcon, Radio } from 'lucide-react';
import { imageServiceApi } from '@/services/imageServiceApi';
import { camerasToStream, chooseLiveCameras } from '@/lib/liveAllocation';
import { favoritesFirst } from '@/lib/cameraFilter';
import { useCameraFavorites } from '@/hooks/useCameraFavorites';
import { CameraQuickActions } from '@/components/cctv/CameraQuickActions';
import { WhepPlayer } from './WhepPlayer';
import { SecurityWatermark } from './SecurityWatermark';

const POLL_MS = 5_000;
const VISIBLE_DEBOUNCE_MS = 300;
const LIMIT_RETRY_MS = 30_000;
const FAILED_RETRY_MS = 60_000;
const MAX_IDS_PER_REQUEST = 500;
const IMAGE_LOADS_AT_ONCE = 6;

interface SnapshotStatus {
  state: 'ok' | 'waiting' | 'no_source' | 'auth_failed' | 'unreachable' | 'failed';
  capturedAt: number | null;
}

interface TileProps {
  camera: any;
  streamUrl: string | null;
  isLive: boolean;
  isChoosing: boolean;
  isWaiting: boolean;
  isFavorite: boolean;
  status?: SnapshotStatus;
  imageUrl?: string;
  now: number;
  staleSeconds: number;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onStreamFailed: (id: string) => void;
  onFocus?: (camera: any) => void;
}


const Tile = React.memo(function Tile({ camera, streamUrl, isLive, isChoosing, isWaiting, isFavorite, status, imageUrl, now, staleSeconds, onOpen, onClose, onToggleFavorite, onStreamFailed, onFocus }: TileProps) {
  const { t } = useTranslation();
  const ageSeconds = status?.capturedAt ? Math.max(0, Math.round((now - status.capturedAt) / 1000)) : null;
  const isStale = ageSeconds !== null && ageSeconds > staleSeconds;
  const age = ageSeconds === null ? '' : ageSeconds < 90
    ? t('ui.liveGrid.overview.ageSeconds', { n: ageSeconds })
    : t('ui.liveGrid.overview.ageMinutes', { n: Math.round(ageSeconds / 60) });
  // When the health check knows why a camera is down, that says more than a failed image.
  const knownReason = camera.operationalStatus === 'offline' && camera.operationalReason && camera.operationalReason !== 'status_set' ? t(`imageService.cameras.offlineReason.${camera.operationalReason}`) : null;
  // The recorder knows the channel has no picture, while its still is only a black frame.
  const noVideo = !isLive && camera.operationalStatus === 'offline' && camera.operationalReason === 'no_signal';
  const problem = status && status.state !== 'ok' && status.state !== 'waiting' ? knownReason ?? t(`ui.liveGrid.overview.state.${status.state}`) : null;

  return (
    <div data-camera-id={camera.id} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('[data-no-focus]')) onFocus?.(camera); }} className={`relative aspect-video ${isWaiting ? 'ring-2 ring-cyan-400 ' : ''}rounded-lg overflow-hidden bg-slate-900 border-2 group ${isLive ? 'border-emerald-500' : 'border-amber-400'}`}>
      {isLive && streamUrl ? (
        <WhepPlayer streamUrl={streamUrl} cameraName={camera.name} streamProfile="sub" className="w-full h-full" onFatalError={() => onStreamFailed(camera.id)} onCancelLive={() => onClose(camera.id)} cancelLiveTitle={t('ui.liveGrid.overview.backToStill')} cancelLiveHighlight={isChoosing} />
      ) : (
        <button type="button" onClick={() => onOpen(camera.id)} title={t('ui.liveGrid.overview.clickForLive')} className="block w-full h-full">
          {imageUrl ? (
            <img src={imageUrl} alt={camera.name} className={`w-full h-full object-contain ${isStale ? 'opacity-60' : ''}`} draggable={false} />
          ) : (
            <span className="flex flex-col items-center justify-center h-full gap-1 text-slate-500 text-[11px] px-2 text-center">
              {problem ? <AlertCircle className="w-5 h-5 text-amber-400" /> : <ImageIcon className="w-5 h-5" />}
              {problem ?? t('ui.liveGrid.overview.state.waiting')}
            </span>
          )}
        </button>
      )}

      {noVideo && (
        <div data-no-video title={t('imageService.cameras.offlineReason.no_signal')} className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="px-3 py-1 rounded bg-slate-950/85 border border-slate-500 text-slate-100 text-sm font-bold tracking-widest">NO VIDEO</span>
        </div>
      )}

      {!isLive && (
        <div className="absolute bottom-1 left-1 right-1 flex items-end justify-between gap-1 pointer-events-none text-[10px]">
          <span className="px-1.5 py-0.5 rounded bg-slate-950/85 text-slate-200 truncate">{camera.name}</span>
          {ageSeconds !== null && (
            <span className={`px-1.5 py-0.5 rounded shrink-0 ${isStale || problem ? 'bg-amber-500/90 text-slate-950 font-semibold' : 'bg-slate-950/85 text-slate-300'}`}>
              {problem && imageUrl ? `${problem} · ` : ''}{t('ui.liveGrid.overview.badgeStill', { age })}
            </span>
          )}
        </div>
      )}

      <div className={`absolute right-1 flex items-center gap-1 z-30 ${isLive ? 'top-9' : 'top-1'}`}>
        <CameraQuickActions cameraId={camera.id} deviceId={camera.deviceId} isFavorite={isFavorite} onToggleFavorite={onToggleFavorite} />
      </div>
    </div>
  );
});

/**
 * Every camera at once: still images refreshed by the server for what is on screen, live video for as
 * many as the quota allows. Nothing is fetched for tiles off screen or while the tab is hidden.
 */
export function LiveOverview({ cameras, onFocusCamera }: { cameras: any[]; onFocusCamera?: (camera: any) => void }) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: settings } = useQuery<any>({
    queryKey: ['snapshot-settings'],
    queryFn: () => imageServiceApi.getSnapshotSettings(),
    staleTime: 60_000,
  });
  const { favorites, toggleFavorite: handleToggleFavorite } = useCameraFavorites();
  const quota: number = settings?.maxStreamsPerUser ?? 16;
  const staleSeconds: number = settings?.staleSeconds ?? 120;

  // Starred first; order is otherwise what the filter gave.
  const ordered = useMemo(
    () => favoritesFirst(cameras, favorites),
    [cameras, favorites],
  );
  const orderKey = ordered.map((c) => c.id).join(',');

  const [visible, setVisible] = useState<string[]>([]);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [pinned, setPinned] = useState<string[]>([]);
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set());
  const [streams, setStreams] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, SnapshotStatus>>({});
  const [images, setImages] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const [behind, setBehind] = useState(false);
  const [refreshSeconds, setRefreshSeconds] = useState<number | null>(null);
  const [limitUntil, setLimitUntil] = useState(0);
  // Live is full: this camera waits until the person cancels one of the live ones.
  const [waiting, setWaiting] = useState<string | null>(null);
  const [released, setReleased] = useState<string[]>([]);
  // Cameras whose live video would not open: back to stills for a while, and their slot goes to another.
  const [failedUntil, setFailedUntil] = useState<Record<string, number>>({});

  useEffect(() => {
    const onChange = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  // Which tiles are on screen. Debounced: a scroll must not start and stop streams on the way past.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const seen = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.cameraId!;
          if (entry.isIntersecting) seen.add(id);
          else seen.delete(id);
        }
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const order = orderKey.split(',');
          setVisible(order.filter((id) => seen.has(id)));
        }, VISIBLE_DEBOUNCE_MS);
      },
      { root, rootMargin: '100px' },
    );
    root.querySelectorAll('[data-camera-id]').forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [orderKey]);

  // Who is live
  const unavailableKey = cameras
    .filter((c) => c.operationalStatus !== 'online' || !c.rtspUrl || (failedUntil[c.id] ?? 0) > now)
    .map((c) => c.id)
    .join(',');
  const liveRef = useRef(liveIds);
  liveRef.current = liveIds;
  useEffect(() => {
    const atLimit = limitUntil > Date.now();
    const next = chooseLiveCameras({
      cameras: orderKey ? orderKey.split(',') : [],
      visible,
      pinned,
      favorites,
      previous: liveRef.current,
      unavailable: new Set(unavailableKey ? unavailableKey.split(',') : []),
      released: new Set(released),
      // At the system-wide limit, what already plays keeps playing and nothing new starts.
      quota: atLimit ? Math.min(quota, liveRef.current.size) : quota,
    });
    setLiveIds(next);
  }, [orderKey, visible, pinned, favorites, unavailableKey, released, quota, limitUntil]);

  // Stream URLs for what is live and on screen. Scrolling away closes the stream, not the camera's place.
  const streaming = camerasToStream(liveIds, visible, pageVisible);
  const streamingKey = streaming.join(',');
  const streamsRef = useRef(streams);
  streamsRef.current = streams;
  useEffect(() => {
    let cancelled = false;
    const wantedStreams = new Set(streamingKey ? streamingKey.split(',') : []);
    for (const id of wantedStreams) {
      if (streamsRef.current[id]) continue;
      imageServiceApi.getCameraStream(id, { profile: 'sub' }).then(
        (data: any) => {
          if (!cancelled && data?.webrtcWhepUrl) setStreams((prev) => ({ ...prev, [id]: data.webrtcWhepUrl }));
        },
        (err: any) => {
          if (cancelled) return;
          if (err?.response?.data?.details?.code === 'LIVE_LIMIT') setLimitUntil(Date.now() + LIMIT_RETRY_MS);
          setLiveIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        },
      );
    }
    setStreams((prev) => {
      const stale = Object.keys(prev).filter((id) => !wantedStreams.has(id));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      stale.forEach((id) => delete next[id]);
      return next;
    });
    return () => {
      cancelled = true;
    };
  }, [streamingKey]);

  // Still images: tell the server what is on screen, then load whatever is newer than what we hold
  const loaded = useRef<Record<string, number>>({});
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const loading = useRef(new Set<string>());
  const wanted = visible.filter((id) => !liveIds.has(id)).slice(0, MAX_IDS_PER_REQUEST).join(',');
  useEffect(() => {
    if (!pageVisible) return;
    let stopped = false;
    const loadImage = async (id: string, capturedAt: number) => {
      loading.current.add(id);
      try {
        const blob = await imageServiceApi.getSnapshotImage(id);
        if (stopped) return;
        const url = URL.createObjectURL(blob);
        const old = imagesRef.current[id];
        loaded.current[id] = capturedAt;
        setImages((prev) => ({ ...prev, [id]: url }));
        if (old) URL.revokeObjectURL(old);
      } catch {
        // The next round tries again; the tile keeps its last image and its real age.
      } finally {
        loading.current.delete(id);
      }
    };
    const poll = async () => {
      setNow(Date.now());
      if (!wanted) return;
      try {
        const res = await imageServiceApi.requestSnapshots(wanted.split(','));
        if (stopped) return;
        setStatuses((prev) => ({ ...prev, ...res.items }));
        setBehind(Boolean(res.behind));
        setRefreshSeconds(res.refreshSeconds);
        const newer = Object.entries<SnapshotStatus>(res.items).filter(
          ([id, s]) => s.capturedAt && s.capturedAt !== loaded.current[id] && !loading.current.has(id),
        );
        newer.forEach(([id]) => loading.current.add(id));
        const worker = async () => {
          for (let next = newer.shift(); next && !stopped; next = newer.shift()) await loadImage(next[0], next[1].capturedAt!);
        };
        const pending = newer.map(([id]) => id);
        // Whatever a stopped round did not reach can be picked up by the next one.
        void Promise.all(Array.from({ length: IMAGE_LOADS_AT_ONCE }, worker)).finally(() => pending.forEach((id) => loading.current.delete(id)));
      } catch {
        // Server busy or restarting: tiles keep what they show and their age keeps counting.
      }
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [wanted, pageVisible]);

  useEffect(() => () => Object.values(imagesRef.current).forEach((url) => URL.revokeObjectURL(url)), []);

  const liveFull = liveIds.size >= quota;
  const handleOpen = useCallback((id: string) => {
    // Already live, and reconnecting after a scroll.
    if (liveRef.current.has(id)) return;
    if (liveFull) {
      setWaiting(id);
      return;
    }
    setWaiting(null);
    setReleased((prev) => prev.filter((r) => r !== id));
    setPinned((prev) => [id, ...prev.filter((p) => p !== id)]);
  }, [liveFull]);
  const handleStreamFailed = useCallback((id: string) => {
    setFailedUntil((prev) => ({ ...prev, [id]: Date.now() + FAILED_RETRY_MS }));
    setNow(Date.now());
    setPinned((prev) => prev.filter((p) => p !== id));
    setLiveIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);
  const handleClose = useCallback((id: string) => {
    setReleased((prev) => [...prev.filter((r) => r !== id && r !== waiting), id]);
    setPinned((prev) => {
      const kept = prev.filter((p) => p !== id);
      return waiting ? [waiting, ...kept.filter((p) => p !== waiting)] : kept;
    });
    setWaiting(null);
  }, [waiting]);
  const stills = ordered.length - liveIds.size;
  const onScreen = new Set(visible);
  const liveOffScreen = ordered.filter((c) => liveIds.has(c.id) && !onScreen.has(c.id));
  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <div className="px-3 py-1.5 border-b border-slate-800 bg-slate-950 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] shrink-0">
        <span className="flex items-center gap-1 text-emerald-400 font-semibold">
          <Radio className="w-3.5 h-3.5" /> {t('ui.liveGrid.overview.liveCount', { n: liveIds.size, quota })}
        </span>
        {liveOffScreen.length > 0 && <span data-live-off-screen={liveOffScreen.length} className="text-emerald-300">{t('ui.liveGrid.overview.liveOffScreen', { n: liveOffScreen.length })}</span>}
        <span className="text-slate-400">{t('ui.liveGrid.overview.stillCount', { n: stills })}</span>
        {refreshSeconds && <span className="text-slate-500">{t('ui.liveGrid.overview.refreshEvery', { n: refreshSeconds })}</span>}
        <span className="text-slate-500">{t('ui.liveGrid.overview.hint')}</span>
        {behind && <span className="text-amber-400">{t('ui.liveGrid.overview.behind')}</span>}
        {limitUntil > now && <span className="text-amber-400">{t('ui.liveGrid.overview.limitReached')}</span>}
      </div>
      {waiting && (
        <div data-live-waiting className="px-3 py-2 border-b border-cyan-800 bg-cyan-950 flex flex-wrap items-center gap-3 text-xs text-cyan-100 shrink-0">
          <span className="font-semibold">
            {t('ui.liveGrid.overview.liveFullPick', { quota, name: cameras.find((c) => c.id === waiting)?.name ?? '' })}
          </span>
          <button type="button" onClick={() => setWaiting(null)} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-100">
            {t('ui.liveGrid.overview.keepCurrentLive')}
          </button>
          {/* The camera to cancel may be anywhere on the page. */}
          {liveOffScreen.length > 0 && (
            <div data-live-off-screen-list className="w-full flex flex-wrap items-center gap-1.5">
              <span className="text-cyan-300">{t('ui.liveGrid.overview.cancelOffScreen')}</span>
              {liveOffScreen.map((camera) => (
                <button key={camera.id} type="button" data-cancel-live={camera.id} onClick={() => handleClose(camera.id)} className="px-2 py-0.5 rounded bg-emerald-900 hover:bg-rose-900 border border-emerald-600 text-slate-100">
                  {camera.name} ✕
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
        {ordered.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">{t('ui.liveGrid.filter.noMatch')}</p>
        ) : (
          <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
            {ordered.map((camera) => (
              <Tile
                key={camera.id}
                camera={camera}
                isLive={liveIds.has(camera.id)}
                streamUrl={streams[camera.id] ?? null}
                isChoosing={!!waiting}
                isWaiting={waiting === camera.id}
                isFavorite={favorites.has(camera.id)}
                status={statuses[camera.id]}
                imageUrl={images[camera.id]}
                now={now}
                staleSeconds={staleSeconds}
                onOpen={handleOpen}
                onClose={handleClose}
                onToggleFavorite={handleToggleFavorite}
                onStreamFailed={handleStreamFailed}
                onFocus={onFocusCamera}
              />
            ))}
          </div>
        )}
      </div>
      <SecurityWatermark />
    </div>
  );
}
