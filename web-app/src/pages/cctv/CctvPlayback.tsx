import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { toBangkokDateAndTimeString, isoToBangkokDaySeconds } from '@/utils/dateUtils';
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

  // Fetch all cameras for selector
  const { data: camerasData } = useQuery({
    queryKey: ['cctv-playback-cameras'],
    queryFn: () => imageServiceApi.getCameras({ limit: 200 }),
  });

  const cameras = camerasData?.items ?? [];

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
  const { data: timelineData, isLoading: isTimelineLoading, refetch: refetchTimeline } = useQuery<TimelineData>({
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

  // Playback timer ticker simulation
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setCurrentTimeSec(prev => {
        const next = prev + playbackSpeed;
        if (next >= 86399) {
          setIsPlaying(false);
          return 86399;
        }
        return next;
      });
    }, 1000 / (playbackSpeed > 4 ? 4 : 1));

    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed]);

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
          ? 'ส่งออกคลิปเหตุการณ์สำเร็จ (Pre-buffer สมบูรณ์)'
          : 'ส่งออกคลิปเหตุการณ์สำเร็จ (หมายเหตุ: ไม่มีข้อมูล Pre-buffer ใน Rolling Storage)'
      );
      setIsExportModalOpen(false);
      refetchClips();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'ไม่สามารถส่งออกคลิปได้');
    },
  });

  // Toggle Legal Hold mutation
  const toggleLegalHoldMutation = useMutation({
    mutationFn: ({ clipId, hold }: { clipId: string; hold: boolean }) =>
      imageServiceApi.toggleClipLegalHold(clipId, hold),
    onSuccess: () => {
      toast.success('อัปเดตนโยบาย Legal Hold เรียบร้อย');
      refetchClips();
    },
  });

  // Seed Dev Timeline mutation
  const seedDevMutation = useMutation({
    mutationFn: () => imageServiceApi.seedDevRecordings(selectedCameraId, selectedDate),
    onSuccess: (res: any) => {
      toast.success(`สร้างข้อมูลจำลองการบันทึกสำเร็จ (${res.count} ช่วงเวลา)`);
      refetchTimeline();
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
    const startIso = new Date(`${selectedDate}T${formatSeconds(currentTimeSec)}.000Z`).toISOString();
    const endSec = Math.min(86399, currentTimeSec + postBufferSec);
    const endIso = new Date(`${selectedDate}T${formatSeconds(endSec)}.000Z`).toISOString();

    exportClipMutation.mutate({
      cameraId: selectedCameraId,
      incidentId: selectedIncidentForClip?.id,
      title: clipTitle,
      startTime: startIso,
      endTime: endIso,
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
                CCTV Playback & Scrubber Timeline
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                Phase 4: Direct fMP4 Remux
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 flex items-center gap-1" title="Timezone display enforced to Asia/Bangkok (UTC+7)">
                <Clock size={10} />
                <span>Asia/Bangkok (UTC+7)</span>
              </span>
            </div>
            <p className="text-xs text-slate-400">
              ระบบตรวจสอบวิดีโอย้อนหลัง 24 ชั่วโมง แยกบันทึกจากโหนดมีเดียแบบ Pass-through ไม่กิน CPU API กลาง
            </p>
          </div>
        </div>

        {/* Camera Selector & Date Filter */}
        <div className="flex items-center gap-3">
          {/* Camera Picker */}
          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
            <span className="text-xs text-slate-400 font-medium">กล้อง:</span>
            <select
              value={selectedCameraId}
              onChange={(e) => setSelectedCameraId(e.target.value)}
              className="bg-transparent text-sm font-semibold text-white focus:outline-none cursor-pointer"
            >
              {cameras.map((c: any) => (
                <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                  {c.name} {c.site?.name ? `(${c.site.name})` : ''} - CH{c.channelNumber || 1}
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
            วันนี้
          </button>

          {/* Live Switch Button */}
          <Link
            to="/image-service/live-grid"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-all"
          >
            <Radio size={14} className="animate-pulse" />
            <span>สลับไปดูสด (Live)</span>
          </Link>
        </div>
      </div>

      {/* Main Playback Area */}
      <div className="flex-1 p-6 flex flex-col gap-5 max-w-[1700px] w-full mx-auto">
        {/* Video Player Box & Status Viewport */}
        <div className="relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl aspect-video max-h-[540px] flex items-center justify-center group">
          {/* Video Placeholder / Canvas simulation */}
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/40 via-slate-950/80 to-slate-950 flex items-center justify-center">
            {currentStatus.isRecorded ? (
              <div className="text-center space-y-3">
                <div className="inline-flex p-4 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 mb-2">
                  <FileVideo size={48} className={isPlaying ? 'animate-pulse text-cyan-400' : 'text-slate-500'} />
                </div>
                <div className="text-lg font-bold text-white tracking-wide">
                  {selectedCamera?.name || 'Camera Feed'}
                </div>
                <div className="text-xs text-slate-400 flex items-center justify-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-ping" />
                  <span>Media Node Playback Stream (fMP4 Remuxed Segment)</span>
                  <span className="text-slate-600">•</span>
                  <span>1080p @ 25fps</span>
                </div>
              </div>
            ) : (
              <div className="text-center p-6 space-y-2">
                <XCircle size={44} className="mx-auto text-amber-500/80 mb-2" />
                <h3 className="text-base font-semibold text-slate-200">
                  {currentStatus.gap ? 'ช่วงเวลานี้ไม่มีสัญญาณบันทึก (Data Gap)' : 'ไม่มีข้อมูลการบันทึกในเวลานี้'}
                </h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  {currentStatus.gap?.reason || 'อุปกรณ์อาจปิดเครื่อง ขาดการเชื่อมต่อสาย LAN หรือกล้องถูกตั้งเป็นโหมดบำรุงรักษา'}
                </p>
                <button
                  onClick={() => seedDevMutation.mutate()}
                  disabled={seedDevMutation.isPending}
                  className="mt-3 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 transition-all"
                >
                  {seedDevMutation.isPending ? 'กำลังสร้างข้อมูล...' : '⚡ จำลองข้อมูลบันทึก Dev (Auto-Seed)'}
                </button>
              </div>
            )}
          </div>

          {/* Top Video HUD Info */}
          <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
            <div className="flex items-center gap-2 bg-slate-950/80 backdrop-blur-md px-3.5 py-1.5 rounded-xl border border-white/10 text-xs font-mono">
              <span className="font-bold text-cyan-400">{selectedCamera?.name || 'CH-01'}</span>
              <span className="text-slate-500">|</span>
              <span className="text-white font-semibold">
                {selectedDate} {formatSeconds(currentTimeSec)}
              </span>
              <span className="text-slate-500">|</span>
              <span className="text-slate-300">Asia/Bangkok (UTC+7)</span>
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
                <span className="font-mono uppercase">{isPlaying ? `PLAYING ${playbackSpeed}x` : 'PAUSED'}</span>
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
                    ตรวจพบเหตุการณ์: {currentStatus.incident.reason} ({currentStatus.incident.incidentNumber})
                  </div>
                  <div className="text-[11px] text-rose-300/80">
                    {currentStatus.incident.description || 'เกิดเหตุสัญญาณผิดปกติหรือเหตุการณ์ด้านความปลอดภัย'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleOpenExportModal(currentStatus.incident!)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-500 hover:bg-rose-400 text-slate-950 transition-all flex items-center gap-1.5 shadow-md"
              >
                <Download size={14} />
                <span>ตัดคลิปหลักฐานทันที</span>
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
              title="-1 นาที"
            >
              <Rewind size={16} />
            </button>
            <button
              onClick={() => setCurrentTimeSec(prev => Math.max(0, prev - 10))}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all text-xs font-bold"
              title="-10 วินาที"
            >
              -10s
            </button>

            {/* Play / Pause Toggle */}
            <button
              onClick={() => setIsPlaying(v => !v)}
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
              title="+10 วินาที"
            >
              +10s
            </button>
            <button
              onClick={() => setCurrentTimeSec(prev => Math.min(86399, prev + 60))}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all"
              title="+1 นาที"
            >
              <FastForward size={16} />
            </button>

            <div className="h-6 w-px bg-slate-800 mx-1" />

            {/* Incident Jump Buttons */}
            <button
              onClick={() => handleJumpIncident('prev')}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1"
              title="กระโดดไปเหตุการณ์ก่อนหน้า"
            >
              <ChevronLeft size={14} />
              <span>เหตุการณ์ก่อน</span>
            </button>
            <button
              onClick={() => handleJumpIncident('next')}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1"
              title="กระโดดไปเหตุการณ์ถัดไป"
            >
              <span>เหตุการณ์ถัดไป</span>
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Center: Current Scrubbed Time Badge */}
          <div className="flex items-center gap-3">
            <div className="bg-slate-950 border border-slate-800 px-4 py-2 rounded-xl text-center">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">เวลาที่กำลังเล่น</span>
              <span className="font-mono text-base font-bold text-cyan-400">
                {formatSeconds(currentTimeSec)}
              </span>
            </div>
          </div>

          {/* Right: Speed dropdown & Export Button */}
          <div className="flex items-center gap-3">
            {/* Speed Selector */}
            <div className="flex items-center gap-1.5 bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs">
              <span className="text-slate-400">ความเร็ว:</span>
              <select
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                className="bg-transparent font-bold text-cyan-400 focus:outline-none cursor-pointer"
              >
                <option value={0.5} className="bg-slate-900 text-white">0.5x</option>
                <option value={1} className="bg-slate-900 text-white">1.0x (ปกติ)</option>
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
              <span>ตัดคลิปหลักฐาน (Export Clip)</span>
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
                <span>24-Hour Scrubber Timeline</span>
              </h3>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-emerald-500 inline-block" />
                  <span>บันทึกปกติ (Continuous)</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-rose-500 inline-block" />
                  <span>ตรวจพบ Incident</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-slate-800 border border-slate-700 inline-block" />
                  <span>สัญญาณขาด (Gap)</span>
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
                    title={`บันทึกต่อเนื่อง: ${formatSeconds(s)} - ${formatSeconds(e)} (${Math.round(block.durationSeconds / 60)} นาที)`}
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
                    title={`เหตุการณ์: ${inc.incidentNumber} (${inc.reason}) เวลา ${formatSeconds(s)}`}
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
                คลังคลิปเหตุการณ์และหลักฐาน (Evidence Archive & Legal Hold)
              </h3>
            </div>
            <span className="text-xs text-slate-400">
              คลิปทั้งหมด {clips.length} รายการ (จัดเก็บบน Media Storage)
            </span>
          </div>

          {clips.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs">
              ยังไม่มีการตัดคลิปหลักฐานสำหรับกล้องนี้ ท่านสามารถคลิก "ตัดคลิปหลักฐาน (Export Clip)" ด้านบนเพื่อเริ่มจัดเก็บ
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
                    <th className="py-2.5 px-3">ชื่อคลิปหลักฐาน</th>
                    <th className="py-2.5 px-3">ช่วงเวลาเหตุการณ์</th>
                    <th className="py-2.5 px-3">ความยาว</th>
                    <th className="py-2.5 px-3">สถานะ Pre-Buffer</th>
                    <th className="py-2.5 px-3">ขนาดไฟล์</th>
                    <th className="py-2.5 px-3">Legal Hold</th>
                    <th className="py-2.5 px-3 text-right">การจัดการ</th>
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
                            เชื่อมกับ {clip.incident.incidentNumber} ({clip.incident.reason})
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-300">
                        {new Date(clip.startTime).toLocaleTimeString('th-TH')} -{' '}
                        {new Date(clip.endTime).toLocaleTimeString('th-TH')}
                      </td>
                      <td className="py-3 px-3 font-semibold text-slate-200">
                        {Math.round(clip.durationSeconds)} วินาที
                      </td>
                      <td className="py-3 px-3">
                        {clip.hasPreBuffer ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                            <CheckCircle2 size={11} />
                            Pre-Buffer ({clip.preBufferSeconds}s) ครบ
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 border border-amber-500/20 text-amber-400">
                            <Info size={11} />
                            ไม่มีช่วงก่อนเหตุ (No Pre-buffer)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-400">
                        {clip.fileSizeBytes ? `${(Number(clip.fileSizeBytes) / (1024 * 1024)).toFixed(1)} MB` : '-'}
                      </td>
                      <td className="py-3 px-3">
                        <button
                          onClick={() => toggleLegalHoldMutation.mutate({ clipId: clip.id, hold: !clip.legalHold })}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                            clip.legalHold
                              ? 'bg-purple-500/20 border border-purple-500/40 text-purple-300'
                              : 'bg-slate-800 text-slate-400 hover:text-white'
                          }`}
                          title="Legal Hold ป้องกันไม่ให้นโยบาย Retention ลบคลิปอัตโนมัติ"
                        >
                          <Shield size={12} />
                          <span>{clip.legalHold ? 'Legal Hold เปิด' : 'ปิด Hold'}</span>
                        </button>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <a
                          href={clip.downloadUrl || '#'}
                          download
                          onClick={(e) => {
                            if (!clip.downloadUrl) {
                              e.preventDefault();
                              toast.info('ระบบจัดเตรียมไฟล์ MP4 บนมีเดียโหนดเรียบร้อย');
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-400 transition-all"
                        >
                          <Download size={13} />
                          <span>ดาวน์โหลด</span>
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
                <h3 className="text-base font-bold text-white">ตัดคลิปวิดีโอหลักฐาน (Export Event Clip)</h3>
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
                <label className="block text-slate-400 mb-1 font-semibold">ชื่อคลิปหลักฐาน:</label>
                <input
                  type="text"
                  value={clipTitle}
                  onChange={(e) => setClipTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Pre-Buffer (ก่อนเกิดเหตุ):</label>
                  <select
                    value={preBufferSec}
                    onChange={(e) => setPreBufferSec(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value={10}>10 วินาที</option>
                    <option value={30}>30 วินาที (แนะนำ)</option>
                    <option value={60}>60 วินาที</option>
                    <option value={120}>120 วินาที</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Post-Buffer (หลังเกิดเหตุ):</label>
                  <select
                    value={postBufferSec}
                    onChange={(e) => setPostBufferSec(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value={30}>30 วินาที</option>
                    <option value={60}>60 วินาที (แนะนำ)</option>
                    <option value={120}>120 วินาที</option>
                    <option value={300}>5 นาที</option>
                  </select>
                </div>
              </div>

              {/* Pre-buffer rolling storage policy banner */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 space-y-1">
                <div className="flex items-center gap-1.5 text-cyan-400 font-semibold">
                  <Info size={14} />
                  <span>เกณฑ์ตรวจสอบ Rolling Buffer:</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  ระบบจะดึงช่วงเวลาก่อนเกิดเหตุจาก Rolling Buffer บน Media Node อัตโนมัติ หากไม่มีไฟล์ก่อนเกิดเหตุ
                  ระบบจะบันทึกสถานะว่า <span className="text-amber-400">"ไม่มีช่วงก่อนเหตุ (No Pre-buffer)"</span> ตามข้อกำหนด
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
                  <div className="font-semibold text-purple-300">เปิดใช้งาน Legal Hold (คุ้มครองถาวร)</div>
                  <div className="text-[11px] text-purple-400/80">
                    ป้องกันไม่ให้ระบบหมุนเวียนลบไฟล์อัตโนมัติ (Retention Sweeper) ลบคลิปนี้จนกว่าผู้มีอำนาจจะปลดออก
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
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmExport}
                disabled={exportClipMutation.isPending}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-all flex items-center gap-1.5 shadow-lg shadow-cyan-500/20"
              >
                {exportClipMutation.isPending ? 'กำลังประมวลผลคลิป...' : 'ยืนยันและส่งออกคลิป'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CctvPlayback;
