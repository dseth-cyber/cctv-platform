import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  RefreshCw,
  Maximize,
  Camera as CameraIcon,
  Volume2,
  VolumeX,
  AlertCircle,
  Signal,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Compass,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { SecurityWatermark } from './SecurityWatermark';


import { useTranslation } from 'react-i18next';
interface WhepPlayerProps {
  streamUrl: string; // e.g. /mediamtx/webrtc/streamPath/whep or full URL
  cameraName?: string;
  autoPlay?: boolean;
  muted?: boolean;
  className?: string;
  streamProfile?: 'main' | 'sub';
  hasSubStream?: boolean;
  iceServers?: RTCIceServer[];
  onToggleProfile?: (nextProfile: 'main' | 'sub') => void;
  onSnapshot?: (dataUrl: string) => void;
}

export const WhepPlayer: React.FC<WhepPlayerProps> = ({
  streamUrl,
  cameraName = 'Live Camera',
  autoPlay = true,
  muted = true,
  className = '',
  streamProfile = 'main',
  hasSubStream = false,
  iceServers,
  onToggleProfile,
  onSnapshot,
}) => {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const resourceUrlRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<any>(null);

  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isMuted, setIsMuted] = useState(muted);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [, setIsFullscreen] = useState(false);

  // Digital PTZ state
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showPtzPad, setShowPtzPad] = useState(false);

  // Normalize streamUrl to browser relative or absolute
  const resolveWhepUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      try {
        const parsed = new URL(url);
        if (parsed.port === '8889') {
          return `/mediamtx/webrtc${parsed.pathname}`;
        }
      } catch {
        // use as-is
      }
    }
    return url;
  };

  const startStream = useCallback(async () => {
    if (!streamUrl) return;

    setStatus('connecting');
    setErrorMessage('');

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Cleanup existing
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    try {
      const resolvedIceServers: RTCIceServer[] = iceServers || (window as any).__CCTV_ICE_SERVERS__ || [];
      const pc = new RTCPeerConnection({
        iceServers: resolvedIceServers,
      });
      pcRef.current = pc;

      // Listen for incoming audio/video tracks
      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          setStatus('connected');
          reconnectAttemptsRef.current = 0;
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setStatus('connected');
          reconnectAttemptsRef.current = 0;
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          if (reconnectAttemptsRef.current < 5) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 8000);
            reconnectAttemptsRef.current += 1;
            setStatus('connecting');
            reconnectTimeoutRef.current = setTimeout(() => {
              startStream();
            }, delay);
          } else {
            setStatus('error');
            setErrorMessage(t('ui.whepPlayer.streamConnectionLostReconnectionFailed'));
          }
        }
      };

      // Add transceivers to signal we only receive
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const targetUrl = resolveWhepUrl(streamUrl);

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      });

      if (!response.ok) {
        throw new Error(t('ui.whepPlayer.mediaMTXWhepReturnedHttp', { status: response.status }));
      }

      // Read location header if provided (RFC 8835)
      const location = response.headers.get('Location');
      if (location) {
        resourceUrlRef.current = new URL(location, targetUrl).toString();
      }

      const answerSdp = await response.text();
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerSdp }));
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err.message || t('ui.whepPlayer.failedToStartWebRTCStream'));
    }
  }, [streamUrl]);

  const stopStream = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    // Attempt to delete WHEP resource
    if (resourceUrlRef.current) {
      fetch(resourceUrlRef.current, { method: 'DELETE' }).catch(() => {});
      resourceUrlRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setStatus('idle');
  }, []);

  useEffect(() => {
    if (autoPlay && streamUrl) {
      startStream();
    }
    return () => {
      stopStream();
    };
  }, [streamUrl, autoPlay, startStream, stopStream]);

  const handleTogglePlay = () => {
    if (status === 'connected' || status === 'connecting') {
      stopStream();
      setIsPlaying(false);
    } else {
      startStream();
      setIsPlaying(true);
    }
  };

  const handleCaptureSnapshot = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      if (onSnapshot) {
        onSnapshot(dataUrl);
      } else {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${cameraName.replace(/\s+/g, '_')}_${Date.now()}.jpg`;
        a.click();
      }
    }
  };

  const handleToggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // PTZ helpers
  const handleZoomIn = () => {
    setZoom((z) => Math.min(4, +(z + 0.5).toFixed(1)));
  };

  const handleZoomOut = () => {
    setZoom((z) => {
      const next = Math.max(1, +(z - 0.5).toFixed(1));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleResetPtz = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleNudgePan = (dx: number, dy: number) => {
    if (zoom <= 1) return;
    setPan((p) => {
      const maxOffset = (zoom - 1) * 150;
      return {
        x: Math.max(-maxOffset, Math.min(maxOffset, p.x + dx)),
        y: Math.max(-maxOffset, Math.min(maxOffset, p.y + dy)),
      };
    });
  };

  // Drag to pan
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      const maxOffset = (zoom - 1) * 150;
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      setPan({
        x: Math.max(-maxOffset, Math.min(maxOffset, newX)),
        y: Math.max(-maxOffset, Math.min(maxOffset, newY)),
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.deltaY < 0) {
      setZoom((z) => Math.min(4, +(z + 0.2).toFixed(1)));
    } else {
      setZoom((z) => {
        const next = Math.max(1, +(z - 0.2).toFixed(1));
        if (next === 1) setPan({ x: 0, y: 0 });
        return next;
      });
    }
  };

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      className={`relative group bg-slate-950 rounded-lg overflow-hidden border border-slate-800 select-none ${className}`}
      style={{ aspectRatio: '16 / 9' }}
    >
      {/* Video Viewport Container with PTZ transform */}
      <div
        className={`w-full h-full overflow-hidden flex items-center justify-center ${
          zoom > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleResetPtz}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isMuted}
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transformOrigin: 'center center',
            transition: isDragging ? 'none' : 'transform 0.15s ease-out',
          }}
          className="w-full h-full object-contain bg-black pointer-events-none"
        />
      </div>

      {/* Dynamic Anti-Screen-Capture Watermark Overlay [ENH-04] */}
      <SecurityWatermark />

      {/* Top Overlay Badge */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none z-10">
        <div className="flex items-center gap-2 bg-slate-900/80 backdrop-blur-md px-2.5 py-1 rounded-md border border-slate-700/50">
          <div
            className={`w-2 h-2 rounded-full ${
              status === 'connected'
                ? 'bg-emerald-500 animate-pulse'
                : status === 'connecting'
                ? 'bg-amber-500 animate-ping'
                : 'bg-rose-500'
            }`}
          />
          <span className="text-xs font-semibold text-slate-200 truncate max-w-[160px] sm:max-w-[220px]">
            {cameraName}
          </span>
        </div>

        <div className="flex items-center gap-1.5 pointer-events-auto">
          {/* Zoom Level Indicator */}
          {zoom > 1 && (
            <button
              onClick={handleResetPtz}
              className="flex items-center gap-1 bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 px-2 py-0.5 rounded text-[10px] font-mono hover:bg-cyan-900 transition"
              title={t('ui.whepPlayer.clickToResetZoom')}
            >
              <span>{zoom}x</span>
              <RotateCcw className="w-2.5 h-2.5" />
            </button>
          )}

          {/* Stream Profile Switcher (Main / Sub) */}
          {hasSubStream && onToggleProfile && (
            <button
              onClick={() => onToggleProfile(streamProfile === 'main' ? 'sub' : 'main')}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold uppercase border transition ${
                streamProfile === 'main'
                  ? 'bg-slate-800 text-cyan-300 border-cyan-500/50 hover:bg-slate-700'
                  : 'bg-amber-950/80 text-amber-300 border-amber-500/50 hover:bg-amber-900'
              }`}
              title={t('ui.whepPlayer.switchTo', { v0: streamProfile === 'main' ? 'Sub Stream (SD)' : 'Main Stream (HD)' })}
            >
              {streamProfile === 'main' ? 'HD' : 'SD'}
            </button>
          )}

          {/* Live Indicator */}
          {status === 'connected' && (
            <div className="flex items-center gap-1.5 bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 px-2 py-0.5 rounded text-[10px] font-mono font-medium">
              <Signal className="w-3 h-3" />
              <span>{t('ui.whepPlayer.live')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Floating PTZ D-Pad Overlay (when toggled) */}
      {showPtzPad && (
        <div className="absolute top-12 right-2 bg-slate-900/90 backdrop-blur-md border border-slate-700 p-2 rounded-xl shadow-2xl z-30 flex flex-col items-center gap-1">
          <div className="text-[10px] font-semibold text-slate-300 flex items-center gap-1 mb-0.5">
            <Compass className="w-3 h-3 text-cyan-400" />
            <span>{t('ui.whepPlayer.digitalZoomPan')}</span>
          </div>
          <span className="text-[9px] text-slate-400 mb-1.5 text-center leading-tight">
            {t('ui.whepPlayer.browserSideOnlyHwPtzRequires')}
          </span>

          {/* Directional Pad */}
          <div className="grid grid-cols-3 gap-1 w-24 h-24">
            <div />
            <button
              onClick={() => handleNudgePan(0, 30)}
              disabled={zoom <= 1}
              className="flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 transition"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <div />

            <button
              onClick={() => handleNudgePan(30, 0)}
              disabled={zoom <= 1}
              className="flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleResetPtz}
              className="flex items-center justify-center rounded bg-cyan-900/50 hover:bg-cyan-800 text-cyan-300 text-[10px] font-bold font-mono transition"
              title={t('ui.whepPlayer.resetZoomPan')}
            >
              {zoom}x
            </button>
            <button
              onClick={() => handleNudgePan(-30, 0)}
              disabled={zoom <= 1}
              className="flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <div />
            <button
              onClick={() => handleNudgePan(0, -30)}
              disabled={zoom <= 1}
              className="flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 transition"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            <div />
          </div>

          {/* Zoom in/out buttons */}
          <div className="flex items-center gap-1 w-full mt-1">
            <button
              onClick={handleZoomIn}
              disabled={zoom >= 4}
              className="flex-1 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 text-xs flex items-center justify-center gap-1 transition"
            >
              <ZoomIn className="w-3 h-3 text-cyan-400" />
              <span>+</span>
            </button>
            <button
              onClick={handleZoomOut}
              disabled={zoom <= 1}
              className="flex-1 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 text-xs flex items-center justify-center gap-1 transition"
            >
              <ZoomOut className="w-3 h-3 text-cyan-400" />
              <span>-</span>
            </button>
          </div>
        </div>
      )}

      {/* State Indicators */}
      {status === 'connecting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/70 backdrop-blur-sm z-20 text-slate-300">
          <RefreshCw className="w-8 h-8 animate-spin text-cyan-400 mb-2" />
          <p className="text-xs font-medium">{t('ui.whepPlayer.connectingWebRTCStream')}</p>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-sm z-20 text-rose-400 p-4 text-center">
          <AlertCircle className="w-7 h-7 mb-1.5" />
          <p className="text-xs font-semibold text-slate-200">{t('ui.whepPlayer.unableToPlayWebRTCStream')}</p>
          <p className="text-[10px] text-slate-400 mt-0.5 max-w-[280px]">
            {errorMessage || t('ui.whepPlayer.cameraOfflineOrRtspUnavailable')}
          </p>
          <div className="flex items-center gap-2 mt-2.5">
            <button
              onClick={startStream}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-md border border-slate-700 transition"
            >
              <RefreshCw className="w-3 h-3" />
              <span>{t('ui.whepPlayer.retry')}</span>
            </button>
            {hasSubStream && onToggleProfile && (
              <button
                onClick={() => onToggleProfile(streamProfile === 'main' ? 'sub' : 'main')}
                className="flex items-center gap-1 px-2.5 py-1 bg-cyan-900/60 hover:bg-cyan-800 text-cyan-300 text-xs rounded-md border border-cyan-700 transition font-medium"
              >
                <span>{t('ui.whepPlayer.switchTo2')}{' '}{streamProfile === 'main' ? t('ui.whepPlayer.subStreamH') : t('ui.whepPlayer.mainStream')}</span>
              </button>
            )}
          </div>
          <p className="text-[9px] text-slate-400 mt-2 max-w-[260px] leading-tight font-mono">
            {t('ui.whepPlayer.codecRecommendationH264OrH')}
          </p>
        </div>
      )}

      {status === 'idle' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 z-20 text-slate-400">
          <button
            onClick={startStream}
            className="p-3.5 bg-cyan-600/90 hover:bg-cyan-500 text-white rounded-full transition shadow-lg shadow-cyan-950/50"
          >
            <Play className="w-6 h-6 fill-current" />
          </button>
          <p className="text-xs mt-2 text-slate-400">{t('ui.whepPlayer.clickToStartLiveStream')}</p>
        </div>
      )}

      {/* Bottom Controls Bar (Visible on Hover) */}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-slate-950/90 via-slate-950/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-between text-slate-200 z-10">
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={handleTogglePlay}
            className="p-1.5 hover:bg-slate-800/80 rounded transition text-slate-300 hover:text-white"
            title={isPlaying ? t('ui.whepPlayer.stop') : t('ui.whepPlayer.play')}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-1.5 hover:bg-slate-800/80 rounded transition text-slate-300 hover:text-white"
            title={isMuted ? t('ui.whepPlayer.unmute') : t('ui.whepPlayer.mute')}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button
            onClick={startStream}
            className="p-1.5 hover:bg-slate-800/80 rounded transition text-slate-300 hover:text-white"
            title={t('ui.whepPlayer.reconnect')}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* Digital PTZ Toggle */}
          <button
            onClick={() => setShowPtzPad(!showPtzPad)}
            className={`p-1.5 rounded transition ${
              showPtzPad || zoom > 1
                ? 'bg-cyan-600/80 text-white'
                : 'hover:bg-slate-800/80 text-slate-300 hover:text-white'
            }`}
            title={t('ui.whepPlayer.digitalZoomPanControlsBrowserSide')}
          >
            <Compass className="w-4 h-4" />
          </button>
          <button
            onClick={handleCaptureSnapshot}
            className="p-1.5 hover:bg-slate-800/80 rounded transition text-slate-300 hover:text-white"
            title={t('ui.whepPlayer.takeSnapshot')}
          >
            <CameraIcon className="w-4 h-4" />
          </button>
          <button
            onClick={handleToggleFullscreen}
            className="p-1.5 hover:bg-slate-800/80 rounded transition text-slate-300 hover:text-white"
            title={t('ui.whepPlayer.fullscreen')}
          >
            <Maximize className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
