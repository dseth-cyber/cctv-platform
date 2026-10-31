import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { toBangkokDateAndTimeString, isoToBangkokDaySeconds, bangkokDaySecondsToIso } from '@/utils/dateUtils';
import {
  Play,
  Pause,
  RotateCcw,
  FastForward,
  Rewind,
  Calendar,
  Clock,
  Shield,
  ShieldAlert,
  Download,
  Share2,
  Film,
  AlertTriangle,
  Radio,
  Sliders,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Volume2,
  VolumeX,
  Layers,
  Sparkles,
  Info,
  CheckCircle2,
  XCircle,
  FileVideo,
  Database,
  RefreshCw,
} from 'lucide-react';
import { SecurityWatermark } from '@/components/cctv/SecurityWatermark';


interface ContinuousBlock {
  startTime: string;
  endTime: string;
  durationSeconds: number;
}

interface GapItem {
  startTime: string;
  endTime: string;
  durationSeconds: number;
  reason: string;
}

interface IncidentMarker {
  id: string;
  incidentNumber: string;
  startTime: string;
  endTime: string;
  reason: string;
  severity: string;
  description: string;
}

interface TimelineData {
  cameraId: string;
  cameraName: string;
  date: string;
  timezone: string;
  totalRecordedSeconds: number;
  totalRecordedBytes: number;
  segmentsCount: number;
  continuousBlocks: ContinuousBlock[];
  gaps: GapItem[];
  incidents: IncidentMarker[];
}

export const CctvPlayback: React.FC = () => {
  const { t } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL parameters or defaults
  const initialCameraId = searchParams.get('cameraId') || '';
  const initialDate = searchParams.get('date') || toBangkokDateAndTimeString(new Date()).date;
  const initialTime = searchParams.get('time') || '';

  const [selectedCameraId, setSelectedCameraId] = useState<string>(initialCameraId);
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(() => {
    if (initialTime) {
      const parts = initialTime.split(':').map(Number);
      if (parts.length >= 2) return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);
    }
    // Default to 12:00:00 (noon)
    return 12 * 3600;
  });

  const [zoomLevel, setZoomLevel] = useState<'24h' | '12h' | '4h' | '1h'>('24h');
  const [zoomOffsetSec, setZoomOffsetSec] = useState<number>(0);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState<boolean>(false);
  const [hoverTimeSec, setHoverTimeSec] = useState<number | null>(null);

  // Export form state
  const [clipTitle, setClipTitle] = useState<string>('');
  const [preBufferSec, setPreBufferSec] = useState<number>(30);
  const [postBufferSec, setPostBufferSec] = useState<number>(60);
  const [legalHoldChecked, setLegalHoldChecked] = useState<boolean>(false);
  const [selectedIncidentForClip, setSelectedIncidentForClip] = useState<IncidentMarker | null>(null);

  const timelineTrackRef = useRef<HTMLDivElement>(null);

  // Real playback: a chunk of recorded video served by the MediaMTX playback server.
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playback, setPlayback] = useState<{ url: string; startSec: number; durationSeconds: number } | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isLoadingPlayback, setIsLoadingPlayback] = useState(false);
  // Set when the video element itself moved the playhead, so the seek effect does not reload.
  const videoDrivenRef = useRef(false);

  // Fetch all cameras for selector
  const { data: camerasData } = useQuery({
    queryKey: ['cctv-playback-cameras'],
    queryFn: () => imageServiceApi.getCameras({ limit: 200 }),
  });

  // GET /cameras returns a plain array (other CCTV pages read it the same way).
  const cameras: any[] = Array.isArray(camerasData) ? camerasData : (camerasData?.items ?? []);

  // Auto-select first camera if none selected
  useEffect(() => {
    if (!selectedCameraId && cameras.length > 0) {
      setSelectedCameraId(cameras[0].id);
    }
  }, [cameras, selectedCameraId]);

  // Sync selected camera and date to search params
  useEffect(() => {
    if (selectedCameraId) {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('cameraId', selectedCameraId);
        next.set('date', selectedDate);
        return next;
      }, { replace: true });
    }
  }, [selectedCameraId, selectedDate, setSearchParams]);

  // Fetch timeline availability
  const { data: timelineData, isLoading: isTimelineLoading } = useQuery<TimelineData>({
    queryKey: ['cctv-recording-timeline', selectedCameraId, selectedDate],
    queryFn: () => imageServiceApi.getRecordingTimeline(selectedCameraId, selectedDate),
    enabled: !!selectedCameraId,
    staleTime: 1000 * 30,
  });

  // Fetch exported clips
  const { data: clipsData, refetch: refetchClips } = useQuery({
    queryKey: ['cctv-recording-clips', selectedCameraId],
    queryFn: () => imageServiceApi.getRecordingClips({ cameraId: selectedCameraId }),
    enabled: !!selectedCameraId,
  });

  const clips = clipsData?.items ?? [];

  const startPlayback = useCallback(async (atSec: number) => {
    if (!selectedCameraId) return;
    setIsLoadingPlayback(true);
    setPlaybackError(null);
    try {
      const res = await imageServiceApi.getPlaybackStream(selectedCameraId, bangkokDaySecondsToIso(selectedDate, atSec), 300);
      setPlayback({ url: res.playbackUrl, startSec: isoToBangkokDaySeconds(res.start), durationSeconds: res.durationSeconds });
      setIsPlaying(true);
    } catch (err: any) {
      setPlayback(null);
      setIsPlaying(false);
      setPlaybackError(err?.response?.data?.message || t('ui.cctvPlayback.noRecordingDataAtThisTime'));
    } finally {
      setIsLoadingPlayback(false);
    }
  }, [selectedCameraId, selectedDate, t]);

  const handleTogglePlay = () => {
    const video = videoRef.current;
    if (isPlaying) {
      video?.pause();
      setIsPlaying(false);
      return;
    }
    if (video && playback && currentTimeSec >= playback.startSec && currentTimeSec < playback.startSec + playback.durationSeconds) {
      video.currentTime = currentTimeSec - playback.startSec;
      video.play().then(() => setIsPlaying(true)).catch(() => startPlayback(currentTimeSec));
      return;
    }
    startPlayback(currentTimeSec);
  };

  // A new camera or day invalidates the loaded chunk.
  useEffect(() => {
    setPlayback(null);
    setIsPlaying(false);
    setPlaybackError(null);
  }, [selectedCameraId, selectedDate]);

  // User seeks (buttons, timeline, incident jumps) move the video or load the chunk for that time.
  useEffect(() => {
    if (videoDrivenRef.current) {
      videoDrivenRef.current = false;
      return;
    }
    if (isDraggingPlayhead) return;
    const video = videoRef.current;
    if (video && playback && currentTimeSec >= playback.startSec && currentTimeSec < playback.startSec + playback.durationSeconds) {
      video.currentTime = currentTimeSec - playback.startSec;
    } else if (isPlaying) {
      startPlayback(currentTimeSec);
    } else {
      setPlayback(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTimeSec, isDraggingPlayhead]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed, playback]);

  // Helper to convert seconds into HH:mm:ss
  const formatSeconds = (sec: number) => {
    const s = Math.max(0, Math.min(86399, Math.floor(sec)));
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const second = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${second}`;
  };

  // Convert ISO string to seconds from start of target day (Asia/Bangkok timezone)
  const isoToDaySeconds = useCallback((isoStr: string) => {
    return isoToBangkokDaySeconds(isoStr);
  }, []);

  // Check if current playhead is in recorded block or in a gap
  const currentStatus = useMemo(() => {
    if (!timelineData) return { isRecorded: false, incident: null, gap: null };

    // Check incidents
    const currentIncident = timelineData.incidents.find(inc => {
      const s = isoToDaySeconds(inc.startTime);
      const e = isoToDaySeconds(inc.endTime);
      return currentTimeSec >= s && currentTimeSec <= e;
    });

    // Check continuous blocks
    const inBlock = timelineData.continuousBlocks.some(block => {
      const s = isoToDaySeconds(block.startTime);
      const e = isoToDaySeconds(block.endTime);
      return currentTimeSec >= s && currentTimeSec <= e;
    });

    // Check gaps
    const inGap = timelineData.gaps.find(gap => {
      const s = isoToDaySeconds(gap.startTime);
      const e = isoToDaySeconds(gap.endTime);
      return currentTimeSec >= s && currentTimeSec <= e;
    });

    return {
      isRecorded: inBlock,
      incident: currentIncident || null,
      gap: inGap || null,
    };
  }, [timelineData, currentTimeSec, isoToDaySeconds]);

  // Zoom parameters
  const windowDurationSec = useMemo(() => {
    switch (zoomLevel) {
      case '1h': return 3600;
      case '4h': return 14400;
      case '12h': return 43200;
      case '24h':
      default: return 86400;
    }
  }, [zoomLevel]);

  // Adjust zoom offset to keep currentTimeSec visible
  useEffect(() => {
    if (currentTimeSec < zoomOffsetSec) {
      setZoomOffsetSec(Math.max(0, currentTimeSec - windowDurationSec * 0.1));
    } else if (currentTimeSec > zoomOffsetSec + windowDurationSec) {
      setZoomOffsetSec(Math.min(86400 - windowDurationSec, currentTimeSec - windowDurationSec * 0.9));
    }
  }, [currentTimeSec, zoomOffsetSec, windowDurationSec]);

  // Handle timeline track scrubbing
  const handleTimelineScrub = useCallback((clientX: number) => {
    if (!timelineTrackRef.current) return;
    const rect = timelineTrackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetSec = Math.round(zoomOffsetSec + ratio * windowDurationSec);
    setCurrentTimeSec(Math.max(0, Math.min(86399, targetSec)));
  }, [zoomOffsetSec, windowDurationSec]);

  const handleMouseDownTrack = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDraggingPlayhead(true);
    handleTimelineScrub(e.clientX);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingPlayhead) {
        handleTimelineScrub(e.clientX);
      }
      if (timelineTrackRef.current) {
        const rect = timelineTrackRef.current.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          const ratio = (e.clientX - rect.left) / rect.width;
          setHoverTimeSec(Math.round(zoomOffsetSec + ratio * windowDurationSec));
        } else {
          setHoverTimeSec(null);
        }
      }
    };

    const handleMouseUp = () => {
      setIsDraggingPlayhead(false);
    };

    if (isDraggingPlayhead) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingPlayhead, handleTimelineScrub, zoomOffsetSec, windowDurationSec]);

  // Export Clip mutation
  const exportClipMutation = useMutation({
    mutationFn: (data: any) => imageServiceApi.exportRecordingClip(data),
    onSuccess: (result: any) => {
      toast.success(
        result.hasPreBuffer
          ? t('ui.cctvPlayback.eventClipExportedPreBufferComplete')
          : t('ui.cctvPlayback.eventClipExportedNoteNoPre')
      );
      setIsExportModalOpen(false);
      refetchClips();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || t('ui.cctvPlayback.failedToExportClip'));
    },
  });

  // Toggle Legal Hold mutation
  const toggleLegalHoldMutation = useMutation({
    mutationFn: ({ clipId, hold }: { clipId: string; hold: boolean }) =>
      imageServiceApi.toggleClipLegalHold(clipId, hold),
    onSuccess: () => {
      toast.success(t('ui.cctvPlayback.legalHoldUpdated'));
      refetchClips();
    },
  });

  const handleOpenExportModal = (incident?: IncidentMarker) => {
    if (incident) {
      setSelectedIncidentForClip(incident);
      setClipTitle(`Evidence Clip - ${incident.incidentNumber} (${incident.reason})`);
      const incSec = isoToDaySeconds(incident.startTime);
      setCurrentTimeSec(incSec);
    } else {
      setSelectedIncidentForClip(null);
      setClipTitle(`Clip_${selectedDate}_${formatSeconds(currentTimeSec).replace(/:/g, '')}`);
    }
    setIsExportModalOpen(true);
  };

  const handleConfirmExport = () => {
    if (!selectedCameraId) return;
    // The playhead is the event instant; the server adds the pre/post buffers around it.
    const eventIso = bangkokDaySecondsToIso(selectedDate, currentTimeSec);

    exportClipMutation.mutate({
      cameraId: selectedCameraId,
      incidentId: selectedIncidentForClip?.id,
      title: clipTitle,
      startTime: eventIso,
      endTime: eventIso,
      preBufferSeconds: preBufferSec,
      postBufferSeconds: postBufferSec,
      legalHold: legalHoldChecked,
    });
  };

  const selectedCamera = cameras.find((c: any) => c.id === selectedCameraId);

  // Jump to next/prev incident
  const handleJumpIncident = (direction: 'prev' | 'next') => {
    if (!timelineData || timelineData.incidents.length === 0) return;
    const times = timelineData.incidents.map(inc => isoToDaySeconds(inc.startTime)).sort((a, b) => a - b);
    if (direction === 'next') {
      const nextTime = times.find(t => t > currentTimeSec + 2);
      if (nextTime !== undefined) setCurrentTimeSec(nextTime);
      else setCurrentTimeSec(times[0]);
    } else {
      const prevTime = [...times].reverse().find(t => t < currentTimeSec - 2);
      if (prevTime !== undefined) setCurrentTimeSec(prevTime);
      else setCurrentTimeSec(times[times.length - 1]);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Top Controls Header */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/60 backdrop-blur-md flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <Film size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white">
                {t('ui.cctvPlayback.cctvPlaybackScrubberTimeline')}
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                {t('ui.cctvPlayback.phase4DirectFMP4Remux')}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 flex items-center gap-1" title={t('ui.cctvPlayback.timezoneDisplayEnforcedToAsiaBangkok')}>
                <Clock size={10} />
                <span>{t('ui.cctvPlayback.asiaBangkokUtc')}</span>
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {t('ui.cctvPlayback.reviewTheLast24HoursOf')}
            </p>
          </div>
        </div>

        {/* Camera Selector & Date Filter */}
        <div className="flex items-center gap-3">
          {/* Camera Picker */}
          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
            <span className="text-xs text-slate-400 font-medium">{t('ui.cctvPlayback.camera')}</span>
            <select
              value={selectedCameraId}
              onChange={(e) => setSelectedCameraId(e.target.value)}
              className="bg-transparent text-sm font-semibold text-white focus:outline-none cursor-pointer"
            >
              {cameras.map((c: any) => (
                <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                  {c.name} {c.site?.name ? `(${c.site.name})` : ''}{' '}{t('ui.cctvPlayback.ch')}{c.channelNumber || 1}
                </option>
              ))}
            </select>
          </div>

          {/* Date Picker */}
          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
            <Calendar size={14} className="text-cyan-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-sm text-white focus:outline-none cursor-pointer"
            />
          </div>

          {/* Quick Date Jump */}
          <button
            onClick={() => setSelectedDate(toBangkokDateAndTimeString(new Date()).date)}
            className={`px-2.5 py-1.5 text-xs rounded-lg font-medium transition-all ${
              selectedDate === toBangkokDateAndTimeString(new Date()).date
                ? 'bg-cyan-500 text-slate-950 font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {t('ui.cctvPlayback.today')}
          </button>

          {/* Live Switch Button */}
          <Link
            to="/cctv/live-grid"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-all"
          >
            <Radio size={14} className="animate-pulse" />
            <span>{t('ui.cctvPlayback.switchToLive')}</span>
          </Link>
        </div>
      </div>

      {/* Main Playback Area */}
      <div className="flex-1 p-6 flex flex-col gap-5 max-w-[1700px] w-full mx-auto">
        {/* Video Player Box & Status Viewport */}
        <div className="relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl aspect-video max-h-[540px] flex items-center justify-center group">
          {/* Dynamic Anti-Screen-Capture Watermark Overlay [ENH-04] */}
          <SecurityWatermark />

          {playback && (
            <video
              key={playback.url}
              ref={videoRef}
              src={playback.url}
              autoPlay
              muted
              playsInline
              className="absolute inset-0 w-full h-full object-contain bg-black"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                v.playbackRate = playbackSpeed;
                if (currentTimeSec > playback.startSec && currentTimeSec < playback.startSec + playback.durationSeconds) {
                  v.currentTime = currentTimeSec - playback.startSec;
                }
              }}
              onTimeUpdate={(e) => {
                const next = Math.min(86399, playback.startSec + e.currentTarget.currentTime);
                if (next !== currentTimeSec) {
                  videoDrivenRef.current = true;
                  setCurrentTimeSec(next);
                }
              }}
              onPause={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
              onEnded={() => startPlayback(playback.startSec + playback.durationSeconds)}
              onError={() => {
                setIsPlaying(false);
                setPlaybackError(t('ui.cctvPlayback.playbackLoadFailed'));
              }}
            />
          )}

          {!playback && (
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/40 via-slate-950/80 to-slate-950 flex items-center justify-center">
            {playbackError ? (
              <div className="text-center p-6 space-y-2">
                <XCircle size={44} className="mx-auto text-rose-500/80 mb-2" />
                <h3 className="text-base font-semibold text-slate-200">{playbackError}</h3>
              </div>
            ) : currentStatus.isRecorded ? (
              <div className="text-center space-y-3">
                <div className="inline-flex p-4 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 mb-2">
                  <FileVideo size={48} className={isLoadingPlayback ? 'animate-pulse text-cyan-400' : 'text-slate-500'} />
                </div>
                <div className="text-lg font-bold text-white tracking-wide">
                  {selectedCamera?.name || t('ui.cctvPlayback.cameraFeed')}
                </div>
                <div className="text-xs text-slate-400">
                  {isLoadingPlayback ? t('ui.cctvPlayback.loadingRecording') : t('ui.cctvPlayback.pressPlayToWatchRecording')}
                </div>
              </div>
            ) : (
              <div className="text-center p-6 space-y-2">
                <XCircle size={44} className="mx-auto text-amber-500/80 mb-2" />
                <h3 className="text-base font-semibold text-slate-200">
                  {currentStatus.gap ? t('ui.cctvPlayback.noRecordingInThisPeriodData') : t('ui.cctvPlayback.noRecordingDataAtThisTime')}
                </h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  {currentStatus.gap?.reason || t('ui.cctvPlayback.theDeviceMayBeOffThe')}
                </p>
              </div>
            )}
          </div>
          )}

          {/* Top Video HUD Info */}
          <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
            <div className="flex items-center gap-2 bg-slate-950/80 backdrop-blur-md px-3.5 py-1.5 rounded-xl border border-white/10 text-xs font-mono">
              <span className="font-bold text-cyan-400">{selectedCamera?.name || 'CH-01'}</span>
              <span className="text-slate-500">|</span>
              <span className="text-white font-semibold">
                {selectedDate} {formatSeconds(currentTimeSec)}
              </span>
              <span className="text-slate-500">|</span>
              <span className="text-slate-300">{t('ui.cctvPlayback.asiaBangkokUtc')}</span>
            </div>

            <div className="flex items-center gap-2">
              {currentStatus.incident && (
                <div className="flex items-center gap-2 bg-rose-950/90 border border-rose-500/50 text-rose-300 px-3.5 py-1.5 rounded-xl text-xs font-semibold animate-pulse">
                  <AlertTriangle size={15} />
                  <span>{currentStatus.incident.incidentNumber}: {currentStatus.incident.reason}</span>
                </div>
              )}

              <div className="bg-slate-950/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-xs text-slate-300 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span className="font-mono uppercase">{isPlaying ? t('ui.cctvPlayback.playingX', { playbackSpeed }) : 'PAUSED'}</span>
              </div>
            </div>
          </div>

          {/* Incident Alert Banner at Bottom of Video if inside an incident */}
          {currentStatus.incident && (
            <div className="absolute bottom-4 left-4 right-4 bg-rose-950/90 backdrop-blur-md border border-rose-500/40 rounded-xl p-3 flex items-center justify-between shadow-lg">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400">
                  <ShieldAlert size={20} />
                </div>
                <div>
                  <div className="text-xs font-bold text-rose-200">
                    {t('ui.cctvPlayback.eventDetected')}{' '}{currentStatus.incident.reason} ({currentStatus.incident.incidentNumber})
                  </div>
                  <div className="text-[11px] text-rose-300/80">
                    {currentStatus.incident.description || t('ui.cctvPlayback.signalAnomalyOrSecurityEvent')}
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleOpenExportModal(currentStatus.incident!)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-500 hover:bg-rose-400 text-slate-950 transition-all flex items-center gap-1.5 shadow-md"
              >
                <Download size={14} />
                <span>{t('ui.cctvPlayback.exportEvidenceClipNow')}</span>
              </button>
            </div>
          )}
        </div>

        {/* Transport Controls Bar */}
        <div className="bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 p-4 flex flex-wrap items-center justify-between gap-4">
          {/* Left: Playback controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentTimeSec(prev => Math.max(0, prev - 60))}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all"
              title={t('ui.cctvPlayback.n1Min')}
            >
              <Rewind size={16} />
            </button>
            <button
              onClick={() => setCurrentTimeSec(prev => Math.max(0, prev - 10))}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all text-xs font-bold"
              title={t('ui.cctvPlayback.n10S')}
            >
              -10s
            </button>

            {/* Play / Pause Toggle */}
            <button
              onClick={handleTogglePlay}
              disabled={isLoadingPlayback}
              className={`p-3 rounded-xl font-bold transition-all flex items-center justify-center ${
                isPlaying
                  ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                  : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
              }`}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} className="translate-x-0.5" />}
            </button>

            <button
              onClick={() => setCurrentTimeSec(prev => Math.min(86399, prev + 10))}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all text-xs font-bold"
              title={t('ui.cctvPlayback.n10S2')}
            >
              +10s
            </button>
            <button
              onClick={() => setCurrentTimeSec(prev => Math.min(86399, prev + 60))}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all"
              title={t('ui.cctvPlayback.n1Min2')}
            >
              <FastForward size={16} />
            </button>

            <div className="h-6 w-px bg-slate-800 mx-1" />

            {/* Incident Jump Buttons */}
            <button
              onClick={() => handleJumpIncident('prev')}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1"
              title={t('ui.cctvPlayback.jumpToPreviousEvent')}
            >
              <ChevronLeft size={14} />
              <span>{t('ui.cctvPlayback.prevEvent')}</span>
            </button>
            <button
              onClick={() => handleJumpIncident('next')}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1"
              title={t('ui.cctvPlayback.jumpToNextEvent')}
            >
              <span>{t('ui.cctvPlayback.nextEvent')}</span>
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Center: Current Scrubbed Time Badge */}
          <div className="flex items-center gap-3">
            <div className="bg-slate-950 border border-slate-800 px-4 py-2 rounded-xl text-center">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">{t('ui.cctvPlayback.playbackTime')}</span>
              <span className="font-mono text-base font-bold text-cyan-400">
                {formatSeconds(currentTimeSec)}
              </span>
            </div>
          </div>

          {/* Right: Speed dropdown & Export Button */}
          <div className="flex items-center gap-3">
            {/* Speed Selector */}
            <div className="flex items-center gap-1.5 bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs">
              <span className="text-slate-400">{t('ui.cctvPlayback.speed')}</span>
              <select
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                className="bg-transparent font-bold text-cyan-400 focus:outline-none cursor-pointer"
              >
                <option value={0.5} className="bg-slate-900 text-white">0.5x</option>
                <option value={1} className="bg-slate-900 text-white">{t('ui.cctvPlayback.n10xNormal')}</option>
                <option value={2} className="bg-slate-900 text-white">2.0x</option>
                <option value={4} className="bg-slate-900 text-white">4.0x</option>
                <option value={8} className="bg-slate-900 text-white">8.0x</option>
                <option value={16} className="bg-slate-900 text-white">16.0x</option>
              </select>
            </div>

            {/* Export Clip Button */}
            <button
              onClick={() => handleOpenExportModal()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-all shadow-md shadow-cyan-500/20"
            >
              <Download size={15} />
              <span>{t('ui.cctvPlayback.exportClip')}</span>
            </button>
          </div>
        </div>

        {/* 24-Hour Scrubber Timeline Box */}
        <div className="bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 p-5 space-y-4">
          {/* Timeline Header & Zoom selector */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Clock size={16} className="text-cyan-400" />
                <span>{t('ui.cctvPlayback.n24HourScrubberTimeline')}</span>
              </h3>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-emerald-500 inline-block" />
                  <span>{t('ui.cctvPlayback.continuousRecording')}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-rose-500 inline-block" />
                  <span>{t('ui.cctvPlayback.incidentDetected')}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-slate-800 border border-slate-700 inline-block" />
                  <span>{t('ui.cctvPlayback.signalGap')}</span>
                </span>
              </div>
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-xl border border-slate-700 text-xs">
              {(['24h', '12h', '4h', '1h'] as const).map(z => (
                <button
                  key={z}
                  onClick={() => {
                    setZoomLevel(z);
                    if (z === '24h') setZoomOffsetSec(0);
                  }}
                  className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                    zoomLevel === z ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {z.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Interactive Timeline Track */}
          <div className="relative pt-6 pb-2 select-none">
            {/* Hour Ruler */}
            <div className="flex justify-between text-[10px] font-mono text-slate-400 mb-2 px-1">
              {Array.from({ length: 9 }).map((_, idx) => {
                const hourSec = zoomOffsetSec + (windowDurationSec / 8) * idx;
                return (
                  <span key={idx} className="relative">
                    {formatSeconds(hourSec).slice(0, 5)}
                    <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-px h-1.5 bg-slate-700" />
                  </span>
                );
              })}
            </div>

            {/* The Main Track Container */}
            <div
              ref={timelineTrackRef}
              onMouseDown={handleMouseDownTrack}
              className="relative h-14 bg-slate-950 rounded-xl border border-slate-800 overflow-hidden cursor-crosshair group shadow-inner"
            >
              {/* Background Data Gaps Indicator */}
              <div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,#090d16,#090d16_10px,#0f172a_10px,#0f172a_20px)] opacity-50" />

              {/* Continuous Recorded Segments (Emerald Blocks) */}
              {timelineData?.continuousBlocks.map((block, idx) => {
                const s = isoToDaySeconds(block.startTime);
                const e = isoToDaySeconds(block.endTime);

                // Check visibility inside window
                if (e < zoomOffsetSec || s > zoomOffsetSec + windowDurationSec) return null;

                const leftPct = Math.max(0, ((s - zoomOffsetSec) / windowDurationSec) * 100);
                const rightPct = Math.min(100, ((e - zoomOffsetSec) / windowDurationSec) * 100);
                const widthPct = Math.max(0.5, rightPct - leftPct);

                return (
                  <div
                    key={idx}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    className="absolute top-1 bottom-1 bg-gradient-to-r from-emerald-600/90 to-teal-500/90 rounded-md shadow-sm border border-emerald-400/30 group-hover:opacity-90 transition-opacity"
                    title={t('ui.cctvPlayback.continuousMin', { v0: formatSeconds(s), v1: formatSeconds(e), v2: Math.round(block.durationSeconds / 60) })}
                  />
                );
              })}

              {/* Incident Badges / Flags (Glowing Red Markers) */}
              {timelineData?.incidents.map((inc) => {
                const s = isoToDaySeconds(inc.startTime);
                const e = isoToDaySeconds(inc.endTime);

                if (e < zoomOffsetSec || s > zoomOffsetSec + windowDurationSec) return null;

                const leftPct = Math.max(0, ((s - zoomOffsetSec) / windowDurationSec) * 100);
                const widthPct = Math.max(1.2, ((Math.max(s + 60, e) - zoomOffsetSec) / windowDurationSec) * 100 - leftPct);

                return (
                  <div
                    key={inc.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCurrentTimeSec(s);
                    }}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    className="absolute top-0 bottom-0 bg-rose-500/80 border-x border-rose-300 z-10 cursor-pointer hover:bg-rose-400 flex items-center justify-center transition-all"
                    title={t('ui.cctvPlayback.eventAt', { incidentNumber: inc.incidentNumber, reason: inc.reason, v2: formatSeconds(s) })}
                  >
                    <AlertTriangle size={12} className="text-white drop-shadow" />
                  </div>
                );
              })}

              {/* Hover Preview Line */}
              {hoverTimeSec !== null && (
                <div
                  style={{ left: `${((hoverTimeSec - zoomOffsetSec) / windowDurationSec) * 100}%` }}
                  className="absolute top-0 bottom-0 w-px bg-white/40 pointer-events-none z-20"
                >
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-800 text-[10px] font-mono text-white px-1.5 py-0.5 rounded shadow border border-slate-700 pointer-events-none">
                    {formatSeconds(hoverTimeSec)}
                  </div>
                </div>
              )}

              {/* Active Playhead Cursor (Red/Cyan Line) */}
              <div
                style={{ left: `${((currentTimeSec - zoomOffsetSec) / windowDurationSec) * 100}%` }}
                className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 z-30 pointer-events-none shadow-[0_0_12px_rgba(6,182,212,0.8)]"
              >
                {/* Playhead Handle Top */}
                <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-cyan-400 border-2 border-slate-950 shadow-md" />
              </div>
            </div>
          </div>
        </div>

        {/* Exported Evidence Clips & Archive Table */}
        <div className="bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield size={18} className="text-cyan-400" />
              <h3 className="text-sm font-bold text-white">
                {t('ui.cctvPlayback.evidenceArchiveLegalHold')}
              </h3>
            </div>
            <span className="text-xs text-slate-400">
              {t('ui.cctvPlayback.totalClips')}{' '}{clips.length}{' '}{t('ui.cctvPlayback.itemsStoredOnMediaStorage')}
            </span>
          </div>

          {clips.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs">
              {t('ui.cctvPlayback.noEvidenceClipsForThisCamera')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
                    <th className="py-2.5 px-3">{t('ui.cctvPlayback.evidenceClipTitle')}</th>
                    <th className="py-2.5 px-3">{t('ui.cctvPlayback.eventWindow')}</th>
                    <th className="py-2.5 px-3">{t('ui.cctvPlayback.duration')}</th>
                    <th className="py-2.5 px-3">{t('ui.cctvPlayback.preBufferStatus')}</th>
                    <th className="py-2.5 px-3">{t('ui.cctvPlayback.fileSize')}</th>
                    <th className="py-2.5 px-3">{t('ui.cctvPlayback.legalHold')}</th>
                    <th className="py-2.5 px-3 text-right">{t('ui.cctvPlayback.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {clips.map((clip: any) => (
                    <tr key={clip.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-3 font-semibold text-white">
                        <div className="flex items-center gap-2">
                          <Film size={14} className="text-cyan-400 flex-shrink-0" />
                          <span>{clip.title}</span>
                        </div>
                        {clip.incident && (
                          <span className="text-[10px] text-rose-400 font-normal block mt-0.5">
                            {t('ui.cctvPlayback.linkedTo')}{' '}{clip.incident.incidentNumber} ({clip.incident.reason})
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-300">
                        {new Date(clip.startTime).toLocaleTimeString('th-TH')} -{' '}
                        {new Date(clip.endTime).toLocaleTimeString('th-TH')}
                      </td>
                      <td className="py-3 px-3 font-semibold text-slate-200">
                        {Math.round(clip.durationSeconds)}{' '}{t('ui.cctvPlayback.s')}
                      </td>
                      <td className="py-3 px-3">
                        {clip.hasPreBuffer ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                            <CheckCircle2 size={11} />
                            {t('ui.cctvPlayback.preBuffer')}{clip.preBufferSeconds}{t('ui.cctvPlayback.sComplete')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 border border-amber-500/20 text-amber-400">
                            <Info size={11} />
                            {t('ui.cctvPlayback.noPreBuffer')}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-400">
                        {clip.fileSizeBytes ? t('ui.cctvPlayback.mb', { v0: (Number(clip.fileSizeBytes) / (1024 * 1024)).toFixed(1) }) : '-'}
                      </td>
                      <td className="py-3 px-3">
                        <button
                          onClick={() => toggleLegalHoldMutation.mutate({ clipId: clip.id, hold: !clip.legalHold })}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                            clip.legalHold
                              ? 'bg-purple-500/20 border border-purple-500/40 text-purple-300'
                              : 'bg-slate-800 text-slate-400 hover:text-white'
                          }`}
                          title={t('ui.cctvPlayback.legalHoldStopsTheRetentionPolicy')}
                        >
                          <Shield size={12} />
                          <span>{clip.legalHold ? t('ui.cctvPlayback.legalHoldOn') : t('ui.cctvPlayback.releaseHold')}</span>
                        </button>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <a
                          href={clip.downloadUrl || '#'}
                          download
                          onClick={(e) => {
                            if (!clip.downloadUrl) {
                              e.preventDefault();
                              toast.info(t('ui.cctvPlayback.mp4FileIsReadyOnThe'));
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-400 transition-all"
                        >
                          <Download size={13} />
                          <span>{t('ui.cctvPlayback.download')}</span>
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Export Clip Modal Dialog */}
      {isExportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Film size={20} className="text-cyan-400" />
                <h3 className="text-base font-bold text-white">{t('ui.cctvPlayback.exportEventClip')}</h3>
              </div>
              <button
                onClick={() => setIsExportModalOpen(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-semibold">{t('ui.cctvPlayback.evidenceClipTitle2')}</label>
                <input
                  type="text"
                  value={clipTitle}
                  onChange={(e) => setClipTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">{t('ui.cctvPlayback.preBufferBeforeEvent')}</label>
                  <select
                    value={preBufferSec}
                    onChange={(e) => setPreBufferSec(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value={10}>{t('ui.cctvPlayback.n10Seconds')}</option>
                    <option value={30}>{t('ui.cctvPlayback.n30SecondsRecommended')}</option>
                    <option value={60}>{t('ui.cctvPlayback.n60Seconds')}</option>
                    <option value={120}>{t('ui.cctvPlayback.n120Seconds')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">{t('ui.cctvPlayback.postBufferAfterEvent')}</label>
                  <select
                    value={postBufferSec}
                    onChange={(e) => setPostBufferSec(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value={30}>{t('ui.cctvPlayback.n30Seconds')}</option>
                    <option value={60}>{t('ui.cctvPlayback.n60SecondsRecommended')}</option>
                    <option value={120}>{t('ui.cctvPlayback.n120Seconds')}</option>
                    <option value={300}>{t('ui.cctvPlayback.n5Minutes')}</option>
                  </select>
                </div>
              </div>

              {/* Pre-buffer rolling storage policy banner */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 space-y-1">
                <div className="flex items-center gap-1.5 text-cyan-400 font-semibold">
                  <Info size={14} />
                  <span>{t('ui.cctvPlayback.rollingBufferCheck')}</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  {t('ui.cctvPlayback.thePreEventWindowIsTaken')}{' '}<span className="text-amber-400">{t('ui.cctvPlayback.noPreBuffer2')}</span>{' '}{t('ui.cctvPlayback.asRequired')}
                </p>
              </div>

              {/* Legal Hold Checkbox */}
              <label className="flex items-start gap-2.5 cursor-pointer p-3 rounded-xl bg-purple-950/20 border border-purple-500/20 hover:bg-purple-950/30 transition-all">
                <input
                  type="checkbox"
                  checked={legalHoldChecked}
                  onChange={(e) => setLegalHoldChecked(e.target.checked)}
                  className="mt-0.5 rounded border-slate-700 text-purple-500 focus:ring-0"
                />
                <div>
                  <div className="font-semibold text-purple-300">{t('ui.cctvPlayback.enableLegalHoldPermanentProtection')}</div>
                  <div className="text-[11px] text-purple-400/80">
                    {t('ui.cctvPlayback.preventsTheRetentionSweeperFromRemoving')}
                  </div>
                </div>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmExport}
                disabled={exportClipMutation.isPending}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-all flex items-center gap-1.5 shadow-lg shadow-cyan-500/20"
              >
                {exportClipMutation.isPending ? t('ui.cctvPlayback.processingClip') : t('ui.cctvPlayback.confirmExportClip')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CctvPlayback;
